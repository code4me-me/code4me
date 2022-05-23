package me.code4me.plugin.util;

import com.intellij.openapi.editor.Document;
import com.intellij.openapi.project.Project;
import com.intellij.psi.PsiDocumentManager;
import com.intellij.psi.PsiFile;

public class Code4MeUtil {

    public static String getLanguage(Project project, Document doc) {
        PsiFile psiFile = PsiDocumentManager.getInstance(project).getPsiFile(doc);
        if (psiFile == null) return "unknown";
        return psiFile.getLanguage().getID();
    }
}
