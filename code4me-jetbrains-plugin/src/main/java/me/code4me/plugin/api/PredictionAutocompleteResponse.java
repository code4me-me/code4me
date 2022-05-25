package me.code4me.plugin.api;

public class PredictionAutocompleteResponse extends Code4MeResponse {

    private final String[] predictions;
    private final String verifyToken;

    public PredictionAutocompleteResponse(String[] predictions, String verifyToken) {
        super(200);
        this.predictions = predictions;
        this.verifyToken = verifyToken;
    }

    public String[] getPredictions() {
        return predictions;
    }

    public String getVerifyToken() {
        return verifyToken;
    }
}
