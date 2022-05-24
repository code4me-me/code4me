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
import org.jetbrains.annotations.NotNull;

import java.util.Map;
import static java.util.Map.entry;

public class Code4MeDocumentListener implements DocumentListener {

    private static final Map<String, Boolean> TRIGGER_POINT_MAP = Map.ofEntries(
            entry(".", false),
            entry("await", true),
            entry("assert", true),
            entry("raise", true),
            entry("del", true),
            entry("lambda", true),
            entry("yield", true),
            entry("return", true),
            entry("while", true),
            entry("for", true),
            entry("if", true),
            entry("elif", true),
            entry("else", true),
            entry("global", true),
            entry("in", true),
            entry("and", true),
            entry("not", true),
            entry("or", true),
            entry("is", true),
            entry("+", false),
            entry("-", false),
            entry("*", false),
            entry("/", false),
            entry("%", false),
            entry("**", false),
            entry("<<", false),
            entry(">>", false),
            entry("&", false),
            entry("|", false),
            entry("^", false),
            entry("=", true),
            entry("==", false),
            entry("!=", false),
            entry("with", true),
            entry(";", false),
            entry(",", false),
            entry("[", false),
            entry("(", false),
            entry("{", false),
            entry("~", false)
    );

    private static final int MAX_TRIGGER_WORD_LENGTH = TRIGGER_POINT_MAP.keySet().stream()
            .mapToInt(String::length)
            .max()
            .orElse(0);

    private final Project project;

    public Code4MeDocumentListener(Project project) {
        this.project = project;
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

        char[] word = new char[MAX_TRIGGER_WORD_LENGTH];
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
            Boolean trailingSpace = TRIGGER_POINT_MAP.get(triggerPoint);
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
