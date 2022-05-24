package me.code4me.plugin.listeners;

import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import me.code4me.plugin.completions.Code4MeCompletionContributor;
import me.code4me.plugin.services.Code4MeTriggerPointsService;
import org.jetbrains.annotations.NotNull;

public class Code4MeDocumentListener implements DocumentListener {

    private final Project project;
    private final Code4MeTriggerPointsService triggerPointsService;

    public Code4MeDocumentListener(Project project) {
        this.project = project;
        this.triggerPointsService = project.getService(Code4MeTriggerPointsService.class);
    }


    @Override
    public void documentChanged(@NotNull DocumentEvent event) {
        Document doc = event.getDocument();
        VirtualFile file = FileDocumentManager.getInstance().getFile(doc);
        if (file == null || !file.isInLocalFileSystem()) return;

        Editor editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
        if (editor == null) return;

        String text = doc.getText();
        if (text.isBlank()) return;

        int offset = editor.getCaretModel().getOffset();
        if (offset >= text.length()) return;

        int offsetPlusOne = offset + 1;
        if (offsetPlusOne < text.length() && text.charAt(offsetPlusOne) != '\n') return;

        char[] word = new char[triggerPointsService.getMaxTriggerPointLength()];
        int i = 0;
        boolean initSpaces = text.charAt(offset) == ' ';
        int spaces = 0;
        int j;
        while (i < word.length && (j = offset - spaces - i) >= 0) {
            char c = text.charAt(j);
            if (c == ' ') {
                if (initSpaces) {
                    spaces++;
                    continue;
                }
                break;
            } else {
                initSpaces = false;
            }

            word[word.length - 1 - i] = c;
            String triggerPoint = new String(word).trim();
            Boolean trailingSpace = triggerPointsService.getTriggerPoint(triggerPoint);
            if (trailingSpace != null && (!trailingSpace || spaces > 0)) {
                Code4MeCompletionContributor.suggestCompletionFromParts(project, editor, doc, offsetPlusOne, new String[] {
                        text.substring(0, offsetPlusOne),
                        text.substring(offsetPlusOne)
                }, triggerPoint);
                break;
            }
            i++;
        }
    }
}
