package me.code4me.plugin.api;

import org.jetbrains.annotations.Nullable;

public class Code4MeAutocompleteRequest {

    private final String[] parts;
    private final @Nullable String triggerPoint;
    private final String language;
    private final String ide;


    public Code4MeAutocompleteRequest(String[] parts, @Nullable String triggerPoint, String language, String ide) {
        this.parts = parts;
        this.triggerPoint = triggerPoint;
        this.language = language;
        this.ide = ide;
    }

    public String[] getParts() {
        return parts;
    }

    public @Nullable String getTriggerPoint() {
        return triggerPoint;
    }

    public String getLanguage() {
        return language;
    }

    public String getIde() {
        return ide;
    }
}
