package me.code4me.plugin.listeners;

import com.intellij.notification.NotificationAction;
import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectManagerListener;
import me.code4me.plugin.Code4MeBundle;
import me.code4me.plugin.dialogs.Code4MeDialogWrapper;
import me.code4me.plugin.services.Code4MeDocumentListenerService;
import me.code4me.plugin.services.Code4MeSettingsService;
import org.jetbrains.annotations.NotNull;

public class Code4MeProjectManagerListener implements ProjectManagerListener {



    @Override
    public void projectOpened(@NotNull Project project) {
        NotificationGroupManager.getInstance()
                .getNotificationGroup("Code4Me Notifications")
                .createNotification(
                        Code4MeBundle.message("project-opened-title"),
                        Code4MeBundle.message("project-opened-content"),
                        NotificationType.INFORMATION
                ).addAction(NotificationAction.createSimple(
                        Code4MeBundle.message("project-opened-settings-action"),
                        () -> openSettingsDialog(project))
                ).notify(project);
        project.getService(Code4MeDocumentListenerService.class).addDocumentListenerForProject(project);
    }

    private void openSettingsDialog(Project project) {
        Code4MeSettingsService settingsService = project.getService(Code4MeSettingsService.class);
        Code4MeSettingsService.Settings settings = settingsService.getSettings();

        Code4MeDialogWrapper dialog = new Code4MeDialogWrapper();
        dialog.setTriggerPointsSelected(settings.isTriggerPoints());
        dialog.setStoreContextSelected(settings.isStoreContext());
        if (dialog.showAndGet()) {
            settings.setTriggerPoints(dialog.isTriggerPointsSelected());
            settings.setStoreContext(dialog.isStoreContextSelected());
            settingsService.save();

            Code4MeDocumentListenerService service = project.getService(Code4MeDocumentListenerService.class);
            if (dialog.isTriggerPointsSelected()) {
                service.addDocumentListenerForProject(project);
            } else {
                service.removeDocumentListenerForProject(project);
            }
        }
    }



    @Override
    public void projectClosed(@NotNull Project project) {
        project.getService(Code4MeDocumentListenerService.class).removeDocumentListenerForProject(project);
    }
}
