package me.code4me.plugin.api;

import org.jetbrains.annotations.Nullable;

public class Code4MeAutocompleteRequest {

    private static final int MAX_CHARACTERS = 1024;

    private final String[] parts;
    private final @Nullable String triggerPoint;
    private final String language;
    private final String ide;


    private Code4MeAutocompleteRequest(String[] parts, @Nullable String triggerPoint, String language, String ide) {
        this.parts = parts;
        this.triggerPoint = triggerPoint;
        this.language = language;
        this.ide = ide;
    }

    public static Code4MeAutocompleteRequest of(
            String text,
            int offset,
            @Nullable String triggerPoint,
            String language,
            String ide
    ) {
        String leftContext = text.substring(0, offset);
        String rightContext = text.substring(offset);
        String fixedLeftContext = leftContext.substring(Math.max(0, leftContext.length() - MAX_CHARACTERS));
        String fixedRightContext = rightContext.substring(0, Math.min(MAX_CHARACTERS, rightContext.length()));
        return new Code4MeAutocompleteRequest(
                new String[]{
                        fixedLeftContext,
                        fixedRightContext
                },
                triggerPoint,
                language,
                ide
        );
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
