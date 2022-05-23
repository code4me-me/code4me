package me.code4me.plugin.listeners;

import com.intellij.notification.NotificationAction;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.editor.EditorFactory;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectManagerListener;
import me.code4me.plugin.CodeForMeBundle;
import me.code4me.plugin.dialogs.Code4MeDialogWrapper;
import me.code4me.plugin.services.Code4MeSettingsService;
import org.jetbrains.annotations.NotNull;

import java.util.HashMap;
import java.util.Map;

public class Code4MeProjectManagerListener implements ProjectManagerListener {

    private final Map<Project, Code4MeDocumentListener> documentListenerMap = new HashMap<>();

    @Override
    public void projectOpened(@NotNull Project project) {
        NotificationGroupManager.getInstance()
                .getNotificationGroup("Code4Me Notifications")
                .createNotification(
                        CodeForMeBundle.message("project-opened-title"),
                        null,
                        CodeForMeBundle.message("project-opened-content"),
                        NotificationType.INFORMATION
                ).addAction(NotificationAction.createSimple(
                        CodeForMeBundle.message("project-opened-settings-action"),
                        () -> openSettingsDialog(project))
                ).notify(project);
        addDocumentListenerForProject(project);
    }

    private void openSettingsDialog(Project project) {
        Code4MeSettingsService settingsService = project.getService(Code4MeSettingsService.class);
        Code4MeSettingsService.Settings settings = settingsService.getSettings();

        Code4MeDialogWrapper dialog = new Code4MeDialogWrapper();
        dialog.setTriggerPointsSelected(settings.isTriggerPoints());
        if (dialog.showAndGet()) {
            settings.setTriggerPoints(dialog.isTriggerPointsSelected());
            settingsService.save();

            if (dialog.isTriggerPointsSelected()) {
                addDocumentListenerForProject(project);
            } else {
                removeDocumentListenerForProject(project);
            }
        }
    }

    private void addDocumentListenerForProject(Project project) {
        if (!documentListenerMap.containsKey(project)) {
            Code4MeDocumentListener documentListener = new Code4MeDocumentListener(project);
            documentListenerMap.put(project, documentListener);
            EditorFactory.getInstance().getEventMulticaster().addDocumentListener(documentListener, () -> {});
        }
    }

    private void removeDocumentListenerForProject(Project project) {
        Code4MeDocumentListener documentListener = documentListenerMap.remove(project);
        if (documentListener != null) {
            EditorFactory.getInstance().getEventMulticaster().removeDocumentListener(documentListener);
        }
    }

    @Override
    public void projectClosed(@NotNull Project project) {
        removeDocumentListenerForProject(project);
    }
}
