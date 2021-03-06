package me.code4me.plugin.completions;

import com.intellij.codeInsight.completion.CodeCompletionHandlerBase;
import com.intellij.codeInsight.completion.CompletionContributor;
import com.intellij.codeInsight.completion.CompletionParameters;
import com.intellij.codeInsight.completion.CompletionProvider;
import com.intellij.codeInsight.completion.CompletionResultSet;
import com.intellij.codeInsight.completion.CompletionType;
import com.intellij.codeInsight.completion.PrioritizedLookupElement;
import com.intellij.codeInsight.hint.HintManager;
import com.intellij.codeInsight.lookup.LookupElement;
import com.intellij.codeInsight.lookup.LookupElementBuilder;
import com.intellij.notification.NotificationAction;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.project.Project;
import com.intellij.util.ProcessingContext;
import com.intellij.patterns.PlatformPatterns;
import me.code4me.plugin.Code4MeIcons;
import me.code4me.plugin.Code4MeBundle;
import me.code4me.plugin.Code4MeScheduledThreadPoolExecutor;
import me.code4me.plugin.api.PredictionAutocompleteRequest;
import me.code4me.plugin.api.PredictionVerifyRequest;
import me.code4me.plugin.api.Code4MeErrorResponse;
import me.code4me.plugin.exceptions.ApiServerException;
import me.code4me.plugin.services.Code4MeApiService;
import me.code4me.plugin.services.Code4MeSettingsService;
import me.code4me.plugin.util.Code4MeUtil;
import org.jetbrains.annotations.NotNull;
import java.awt.EventQueue;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

public class Code4MeCompletionContributor extends CompletionContributor {

    private static final CompletionCache completionCache = new CompletionCache();

    public Code4MeCompletionContributor() {
        extend(CompletionType.BASIC, PlatformPatterns.psiElement(), new Code4MeCompletionProvider());
    }

    public static void suggestCompletion(
            Project project,
            Editor editor,
            Document doc,
            String text,
            int offset,
            String triggerPoint
    ) {
        PredictionAutocompleteRequest request = PredictionAutocompleteRequest.of(
                text,
                offset,
                triggerPoint,
                Code4MeUtil.getLanguage(project, doc),
                "jetbrains",
                project
        );

        project.getService(Code4MeApiService.class).fetchAutoCompletion(project, request).thenAccept(res -> {
            String[] predictions = res.getPredictions();

            Code4MeSettingsService settingsService = project.getService(Code4MeSettingsService.class);
            Code4MeSettingsService.Settings settings = settingsService.getSettings();
            if (!settings.isIgnoringSurvey() && res.isSurvey()) {
                NotificationGroupManager.getInstance()
                        .getNotificationGroup("Code4Me Notifications")
                        .createNotification(
                                Code4MeBundle.message("survey-title"),
                                Code4MeBundle.message("survey-content"),
                                NotificationType.INFORMATION
                        ).addAction(NotificationAction.createSimple(
                                Code4MeBundle.message("survey-redirect-action"),
                                () -> project.getService(Code4MeApiService.class).redirectToCode4MeSurvey(project))
                        ).addAction(NotificationAction.createSimple(
                                Code4MeBundle.message("survey-cancel-action"),
                                () -> {
                                    settings.setIgnoringSurvey(true);
                                    settingsService.save();
                                })
                        ).notify(project);
            }

            EventQueue.invokeLater(() -> {
                if (predictions == null || Arrays.stream(predictions).allMatch(String::isBlank)) {
                    HintManager.getInstance().showInformationHint(
                            editor,
                            Code4MeBundle.message("no-suggestions-available")
                    );
                } else {
                    String verifyToken = res.getVerifyToken();
                    completionCache.setPredictions(predictions);
                    completionCache.setOffset(offset);
                    completionCache.setVerifyToken(verifyToken);
                    completionCache.setTimeoutSupplier(() -> checkCodeChanges(project, verifyToken, null, offset, doc));
                    completionCache.setEmpty(false);

                    ApplicationManager.getApplication().invokeLater(() -> {
                        CodeCompletionHandlerBase handler = CodeCompletionHandlerBase.createHandler(
                                CompletionType.BASIC,
                                false,
                                false,
                                false
                        );
                        handler.invokeCompletion(project, editor, 0, false);
                    }, ModalityState.current());
                }
            });
        }).exceptionally(th -> {
            showError(project, th.getCause());
            return null;
        });
    }

    private static ScheduledFuture<?> checkCodeChanges(
            Project project,
            String verifyToken,
            String chosenPrediction,
            int offset,
            Document doc
    ) {
        AtomicInteger atomicOffset = new AtomicInteger(offset);
        DocumentListener listener = new DocumentListener() {
            @Override
            public void documentChanged(@NotNull DocumentEvent event) {
                if (event.getOffset() < atomicOffset.get()) {
                    atomicOffset.addAndGet(event.getNewLength() - event.getOldLength());
                }
            }
        };
        doc.addDocumentListener(listener);

        return Code4MeScheduledThreadPoolExecutor.getInstance().schedule(() -> {
            doc.removeDocumentListener(listener);
            String[] lines = doc.getText().substring(atomicOffset.get()).split("\n");
            String groundTruth = lines.length == 0 ? "" : lines[0];
            project.getService(Code4MeApiService.class).sendCompletionData(
                    project,
                    new PredictionVerifyRequest(verifyToken, chosenPrediction, groundTruth)
            ).exceptionally(th -> {
                showError(project, th.getCause());
                return null;
            });
        }, 30, TimeUnit.SECONDS);
    }

    private static void showError(Project project, Throwable th) {
        if (th instanceof ApiServerException) {
            Code4MeErrorResponse response = ((ApiServerException) th).getResponse();
            String message = response == null ? th.getMessage() : response.getError();
            EventQueue.invokeLater(() -> NotificationGroupManager.getInstance()
                    .getNotificationGroup("Code4Me Notifications")
                    .createNotification(
                            Code4MeBundle.message("project-opened-title"),
                            message,
                            NotificationType.ERROR
                    ).notify(project));
        }
    }

    private static class Code4MeCompletionProvider extends CompletionProvider<CompletionParameters> {

        @Override
        protected void addCompletions(
                @NotNull CompletionParameters parameters,
                @NotNull ProcessingContext context,
                @NotNull CompletionResultSet result
        ) {
            if (completionCache.isEmpty()) {
                return;
            }

            ScheduledFuture<?> dataRequest = completionCache.getTimeoutSupplier().get();

            // Need to add all elements in one go to avoid split
            ArrayList<LookupElement> elements = new ArrayList<>();
            for (String prediction : completionCache.getPredictions()) {
                elements.add(prioritize(LookupElementBuilder.create(prediction)
                        .withIcon(Code4MeIcons.PLUGIN_ICON)
                        .withInsertHandler((cxt, item) -> {
                            if (!dataRequest.cancel(true)) return;
                            checkCodeChanges(
                                    cxt.getProject(),
                                    completionCache.getVerifyToken(),
                                    prediction,
                                    completionCache.getOffset(),
                                    cxt.getDocument()
                            );
                            String insertion = item.getLookupString();
                            String[] lines = cxt.getDocument().getText().substring(completionCache.getOffset()).split("\n");
                            String line = lines.length == 0 ? "" : lines[0];

                            if (!insertion.equals(line)) {
                                if (line.endsWith(")") || line.endsWith("}") || line.endsWith("]") || line.endsWith(">")) {
                                    cxt.getDocument().deleteString(completionCache.getOffset() + insertion.length(), completionCache.getOffset() + insertion.length() + 1);
                                }
                            }
                        })
                        .withTypeText("Code4Me")
                ));
            }
            result.addAllElements(elements);

            completionCache.setEmpty(true);
        }
    }

    private static LookupElement prioritize(LookupElement element) {
        return PrioritizedLookupElement.withGrouping(
                PrioritizedLookupElement.withExplicitProximity(
                        PrioritizedLookupElement.withPriority(
                                element,
                                Double.MAX_VALUE - 1
                        ),
                        Integer.MAX_VALUE - 1
                ),
                Integer.MAX_VALUE - 1
        );
    }

    private static class CompletionCache {

        private String[] predictions;
        private int offset;
        private String verifyToken;
        private boolean empty;
        private Supplier<ScheduledFuture<?>> timeoutSupplier;

        public CompletionCache() {
            this.predictions = new String[0];
            this.offset = -1;
            this.verifyToken = "";
            this.empty = true;
            this.timeoutSupplier = null;
        }

        public void setPredictions(String[] predictions) {
            this.predictions = predictions;
        }

        public String[] getPredictions() {
            return predictions;
        }

        public void setOffset(int offset) {
            this.offset = offset;
        }

        public int getOffset() {
            return offset;
        }

        public void setVerifyToken(String verifyToken) {
            this.verifyToken = verifyToken;
        }

        public String getVerifyToken() {
            return verifyToken;
        }

        public void setEmpty(boolean empty) {
            this.empty = empty;
        }

        public boolean isEmpty() {
            return empty;
        }

        public void setTimeoutSupplier(Supplier<ScheduledFuture<?>> timeoutSupplier) {
            this.timeoutSupplier = timeoutSupplier;
        }

        public Supplier<ScheduledFuture<?>> getTimeoutSupplier() {
            return timeoutSupplier;
        }
    }
}
