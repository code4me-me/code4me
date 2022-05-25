package me.code4me.plugin.actions;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.editor.CaretModel;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import me.code4me.plugin.completions.Code4MeCompletionContributor;
import org.jetbrains.annotations.NotNull;

public class CodeCompleteAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) return;

        Editor editor = FileEditorManager.getInstance(event.getProject()).getSelectedTextEditor();
        if (editor == null) return;

        Document doc = editor.getDocument();
        String text = doc.getText();
        CaretModel caretModel = editor.getCaretModel();
        int offset = caretModel.getOffset();

        Code4MeCompletionContributor.suggestCompletion(project, editor, doc, text, offset, null);
    }
}
