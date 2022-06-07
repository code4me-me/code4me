package me.code4me.plugin.api;

import org.jetbrains.annotations.Nullable;

public class PredictionAutocompleteRequest {

    private static final int MAX_CHARACTERS = 3992;

    private final String leftContext;
    private final String rightContext;
    private final @Nullable String triggerPoint;
    private final String language;
    private final String ide;


    private PredictionAutocompleteRequest(
            String leftContext,
            String rightContext,
            @Nullable String triggerPoint,
            String language,
            String ide
    ) {
        this.leftContext = leftContext;
        this.rightContext = rightContext;
        this.triggerPoint = triggerPoint;
        this.language = language;
        this.ide = ide;
    }

    public static PredictionAutocompleteRequest of(
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
        return new PredictionAutocompleteRequest(
                fixedLeftContext,
                fixedRightContext,
                triggerPoint,
                language,
                ide
        );
    }

    public String getLeftContext() {
        return leftContext;
    }

    public String getRightContext() {
        return rightContext;
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
