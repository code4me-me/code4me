package me.code4me.plugin.exceptions;

import me.code4me.plugin.api.Code4MeErrorResponse;
import org.jetbrains.annotations.Nullable;

public class ApiServerException extends RuntimeException {

    private @Nullable final Code4MeErrorResponse response;

    private ApiServerException(@Nullable Code4MeErrorResponse response, String message) {
        super(message);
        this.response = response;
    }

    public ApiServerException(Code4MeErrorResponse response) {
        this(response, response.getError());
    }

    public ApiServerException(String message) {
        this(null, message);
    }

    public @Nullable Code4MeErrorResponse getResponse() {
        return response;
    }
}
