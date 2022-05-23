package me.code4me.plugin.api;

public class Code4MeCompletionRequest {

    private final String completionToken;
    private final String completion;
    private final String line;

    public Code4MeCompletionRequest(String completionToken, String completion, String line) {
        this.completionToken = completionToken;
        this.completion = completion;
        this.line = line;
    }

    public String getCompletionToken() {
        return completionToken;
    }

    public String getCompletion() {
        return completion;
    }

    public String getLine() {
        return line;
    }
}
