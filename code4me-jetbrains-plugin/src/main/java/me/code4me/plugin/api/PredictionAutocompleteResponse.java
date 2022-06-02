package me.code4me.plugin.api;

public class PredictionAutocompleteResponse extends Code4MeResponse {

    private final String[] predictions;
    private final String verifyToken;
    private final boolean survey;

    public PredictionAutocompleteResponse(String[] predictions, String verifyToken, boolean survey) {
        super(200);
        this.predictions = predictions;
        this.verifyToken = verifyToken;
        this.survey = survey;
    }

    public String[] getPredictions() {
        return predictions;
    }

    public String getVerifyToken() {
        return verifyToken;
    }

    public boolean getSurvey() {
        return survey;
    }
}
