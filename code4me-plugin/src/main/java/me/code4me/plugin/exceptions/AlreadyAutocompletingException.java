package me.code4me.plugin.exceptions;

public class AlreadyAutocompletingException extends RuntimeException {

    public AlreadyAutocompletingException(String message) {
        super(message);
    }
}
