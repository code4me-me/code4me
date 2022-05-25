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
        Code4MeAutocompleteRequest request = Code4MeAutocompleteRequest.of(
                text,
                offset,
                triggerPoint,
                Code4MeUtil.getLanguage(project, doc),
                "jetbrains"
        );

        project.getService(Code4MeApiService.class).fetchAutoCompletion(project, request).thenAccept(res -> {
            String completion = res.getCompletion();
            EventQueue.invokeLater(() -> {
                if (completion == null || completion.isBlank()) {
                    HintManager.getInstance().showInformationHint(editor, "No Code4Me Suggestions available");
                } else {
                    completionCache.setCompletion(completion);
                    completionCache.setOffset(offset);
                    completionCache.setCompletionToken(res.getCompletionToken());
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
            if (completionCache.isEmpty()) {
                return;
            }

            result.addElement(prioritize(LookupElementBuilder.create(completionCache.getCompletion())
                    .withIcon(Code4MeIcons.PLUGIN_ICON)
                    .withInsertHandler((cxt, item) -> {
                        checkCodeChanges(
                                cxt.getProject(),
                                completionCache.getCompletionToken(),
                                completionCache.getCompletion(),
                                completionCache.getOffset(),
                                cxt.getDocument()
                        );
                    })
                    .withTypeText("Code4Me")
            ));
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

        private String completion;
        private int offset;
        private String completionToken;
        private boolean empty;

        public CompletionCache() {
            this.completion = "";
            this.offset = -1;
            this.completionToken = "";
            this.empty = true;
        }

        public void setCompletion(String completion) {
            this.completion = completion;
        }

        public String getCompletion() {
            return completion;
        }

        public void setOffset(int offset) {
            this.offset = offset;
        }

        public int getOffset() {
            return offset;
        }

        public void setCompletionToken(String completionToken) {
            this.completionToken = completionToken;
        }

        public String getCompletionToken() {
            return completionToken;
        }

        public void setEmpty(boolean empty) {
            this.empty = empty;
        }

        public boolean isEmpty() {
            return empty;
        }
    }
}
