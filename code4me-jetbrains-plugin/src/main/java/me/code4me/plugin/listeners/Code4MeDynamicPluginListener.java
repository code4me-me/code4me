package me.code4me.plugin.listeners;

import com.intellij.ide.DataManager;
import com.intellij.ide.plugins.DynamicPluginListener;
import com.intellij.ide.plugins.IdeaPluginDescriptor;
import com.intellij.openapi.actionSystem.CommonDataKeys;
import com.intellij.openapi.project.Project;
import me.code4me.plugin.services.Code4MeDocumentListenerService;
import org.jetbrains.annotations.NotNull;

public class Code4MeDynamicPluginListener implements DynamicPluginListener {

    @Override
    public void pluginLoaded(@NotNull IdeaPluginDescriptor pluginDescriptor) {
        DataManager.getInstance().getDataContextFromFocusAsync().then(dataContext -> {
            Project project = dataContext.getData(CommonDataKeys.PROJECT);
            if (project != null) {
                project.getService(Code4MeDocumentListenerService.class).addDocumentListenerForProject(project);
            }
            return dataContext;
        });
    }
}
