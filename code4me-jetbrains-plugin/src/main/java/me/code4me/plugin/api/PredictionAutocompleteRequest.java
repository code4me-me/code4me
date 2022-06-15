package me.code4me.plugin.api;

import com.intellij.ide.plugins.PluginManagerCore;
import com.intellij.openapi.extensions.PluginId;
import com.intellij.openapi.project.Project;
import me.code4me.plugin.Code4MeBundle;
import me.code4me.plugin.services.Code4MeTriggerPointsService;
import org.jetbrains.annotations.Nullable;

public class PredictionAutocompleteRequest {

    private static final int MAX_CHARACTERS = 3992;

    private final String leftContext;
    private final String rightContext;
    private final String triggerPoint;
    private final String language;
    private final String ide;
    private final boolean keybind;
    private final String pluginVersion;


    private PredictionAutocompleteRequest(
            String leftContext,
            String rightContext,
            String triggerPoint,
            String language,
            String ide,
            boolean keybind
    ) {
        this.leftContext = leftContext;
        this.rightContext = rightContext;
        this.triggerPoint = triggerPoint;
        this.language = language;
        this.ide = ide;
        this.keybind = keybind;
        this.pluginVersion = PluginManagerCore.getPlugin(PluginId.getId("me.code4me.plugin")).getVersion();
    }

    public static PredictionAutocompleteRequest of(
            String text,
            int offset,
            @Nullable String triggerPoint,
            String language,
            String ide,
            Project project
    ) {
        Code4MeTriggerPointsService triggerPointsService = project.getService(Code4MeTriggerPointsService.class);
        String leftContext = text.substring(0, offset);
        String rightContext = text.substring(offset);
        String fixedLeftContext = leftContext.substring(Math.max(0, leftContext.length() - MAX_CHARACTERS));
        String fixedRightContext = rightContext.substring(0, Math.min(MAX_CHARACTERS, rightContext.length()));
        boolean keybind = triggerPoint == null;

        if (keybind) {
            if (fixedLeftContext.contains("\n")) {
                String line = fixedLeftContext.substring(fixedLeftContext.lastIndexOf('\n') + 1).trim();
                if (line.contains(" ")) {
                    String token = line.substring(line.lastIndexOf(' ') + 1);
                    triggerPoint = token;

                    int max = Math.min(triggerPointsService.getMaxNoSpaceTriggerPointLength(), token.length());
                    for (int i = max; i >= 1; i--) {
                        String lastChars = token.substring(token.length() - i);
                        if (Boolean.FALSE.equals(triggerPointsService.getTriggerPoint(lastChars))) {
                            triggerPoint = lastChars;
                            break;
                        }
                    }
                }
            }
        }

        return new PredictionAutocompleteRequest(
                fixedLeftContext,
                fixedRightContext,
                triggerPoint,
                language,
                ide,
                keybind
        );
    }

    public String getLeftContext() {
        return leftContext;
    }

    public String getRightContext() {
        return rightContext;
    }

    public String getTriggerPoint() {
        return triggerPoint;
    }

    public String getLanguage() {
        return language;
    }

    public String getIde() {
        return ide;
    }

    public boolean getKeybind() {
        return keybind;
    }

    public String getPluginVersion() {
        return pluginVersion;
    }
}
