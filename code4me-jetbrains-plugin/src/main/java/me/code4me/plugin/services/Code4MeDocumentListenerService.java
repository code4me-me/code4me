package me.code4me.plugin.services;

import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.project.Project;
import me.code4me.plugin.listeners.Code4MeDocumentListener;

import java.util.HashMap;
import java.util.Map;

public class Code4MeDocumentListenerService {

    private final Map<Project, Code4MeDocumentListener> documentListenerMap = new HashMap<>();

    public void addDocumentListenerForProject(Project project) {
        if (!documentListenerMap.containsKey(project)) {
            Code4MeDocumentListener documentListener = new Code4MeDocumentListener(project);
            documentListenerMap.put(project, documentListener);
            EditorFactory.getInstance().getEventMulticaster().addDocumentListener(documentListener, () -> {});
        }
    }

    public void removeDocumentListenerForProject(Project project) {
        Code4MeDocumentListener documentListener = documentListenerMap.remove(project);
        if (documentListener != null) {
            EditorFactory.getInstance().getEventMulticaster().removeDocumentListener(documentListener);
        }
    }
}
