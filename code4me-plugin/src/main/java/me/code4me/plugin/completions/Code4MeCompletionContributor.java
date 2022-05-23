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
import me.code4me.plugin.CodeForMeBundle;
import me.code4me.plugin.api.Code4MeAutocompleteRequest;
import me.code4me.plugin.api.Code4MeCompletionRequest;
import me.code4me.plugin.api.Code4MeErrorResponse;
import me.code4me.plugin.exceptions.ApiServerException;
import me.code4me.plugin.services.Code4MeApiService;
import me.code4me.plugin.util.Code4MeUtil;
import org.jetbrains.annotations.NotNull;
import java.awt.EventQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public class Code4MeCompletionContributor extends CompletionContributor {

    private static Completion currentCompletion = new Completion("", -1, "");

    public Code4MeCompletionContributor() {
        extend(CompletionType.BASIC, PlatformPatterns.psiElement(), new Code4MeCompletionProvider());
    }

    public static void suggestCompletionFromParts(
            Project project,
            Editor editor,
            Document doc,
            int offset,
            String[] parts,
            String triggerPoint
    ) {
        Code4MeAutocompleteRequest request = new Code4MeAutocompleteRequest(
                parts,
                triggerPoint,
                Code4MeUtil.getLanguage(project, doc)
        );

        project.getService(Code4MeApiService.class).fetchAutoCompletion(project, request).thenAccept(res -> {
            String completion = res.getCompletion();
            EventQueue.invokeLater(() -> {
                if (completion == null || completion.isBlank()) {
                    HintManager.getInstance().showInformationHint(editor, "No Code4Me Suggestions available");
                } else {
                    Code4MeCompletionContributor.currentCompletion = new Completion(
                            completion,
                            offset,
                            res.getCompletionToken()
                    );
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

    private static void checkCodeChanges(Project project, String token, String completion, int offset, Document doc) {
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

        CodeForMeBundle.getExecutorService().schedule(() -> {
            doc.removeDocumentListener(listener);
            String line = doc.getText().substring(atomicOffset.get()).split("\n")[0];
            project.getService(Code4MeApiService.class).sendCompletionData(
                    project,
                    new Code4MeCompletionRequest(token, completion, line)
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
                            CodeForMeBundle.message("project-opened-title"),
                            null,
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
            if (currentCompletion == null
                    || currentCompletion.completion == null
                    || currentCompletion.completion.isEmpty()) {
                return;
            }

            result.addElement(prioritize(LookupElementBuilder.create(currentCompletion.completion)
                    .withIcon(Code4MeIcons.PLUGIN_ICON)
                    .withInsertHandler((cxt, item) -> {
                        checkCodeChanges(
                                cxt.getProject(),
                                currentCompletion.completionToken,
                                currentCompletion.completion,
                                currentCompletion.offset,
                                cxt.getDocument()
                        );
                        currentCompletion = null;
                    })
                    .withTypeText("Code4Me")
            ));
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

    private static class Completion {

        private final String completion;
        private final int offset;
        private final String completionToken;

        public Completion(String completion, int offset, String completionToken) {
            this.completion = completion;
            this.offset = offset;
            this.completionToken = completionToken;
        }
    }
}
