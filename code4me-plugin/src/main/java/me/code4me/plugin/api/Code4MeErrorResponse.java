package me.code4me.plugin.api;

public class Code4MeErrorResponse extends Code4MeResponse {

    private final String error;

    public Code4MeErrorResponse(String error, int statusCode) {
        super(statusCode);
        this.error = error;
    }

    public String getError() {
        return error;
    }

    @Override
    public boolean isError() {
        return true;
    }
}
