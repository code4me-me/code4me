package me.code4me.plugin.api;

public abstract class Code4MeResponse {

    private final int statusCode;
    public Code4MeResponse(int statusCode) {
        this.statusCode = statusCode;
    }

    public int getStatusCode() {
        return statusCode;
    }

    public boolean isError() {
        return false;
    }
}
