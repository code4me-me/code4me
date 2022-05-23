package me.code4me.plugin.api;

public class Code4MeAutocompleteResponse extends Code4MeResponse {

    private final String completion;
    private final String completionToken;

    public Code4MeAutocompleteResponse(String completion, String completionToken) {
        super(200);
        this.completion = completion;
        this.completionToken = completionToken;
    }

    public String getCompletion() {
        return completion;
    }

    public String getCompletionToken() {
        return completionToken;
    }
}
