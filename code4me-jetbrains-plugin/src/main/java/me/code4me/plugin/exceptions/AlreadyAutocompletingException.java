package me.code4me.plugin.exceptions;

import me.code4me.plugin.Code4MeBundle;

public class AlreadyAutocompletingException extends RuntimeException {

    public AlreadyAutocompletingException() {
        super(Code4MeBundle.message("already-auto-completing"));
    }

    public AlreadyAutocompletingException(String message) {
        super(message);
    }
}
