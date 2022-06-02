package me.code4me.plugin.api;

public class PredictionVerifyRequest {

    private final String verifyToken;
    private final String chosenPrediction;
    private final String groundTruth;

    public PredictionVerifyRequest(String verifyToken, String chosenPrediction, String groundTruth) {
        this.verifyToken = verifyToken;
        this.chosenPrediction = chosenPrediction;
        this.groundTruth = groundTruth;
    }

    public String getVerifyToken() {
        return verifyToken;
    }

    public String getChosenPrediction() {
        return chosenPrediction;
    }

    public String getGroundTruth() {
        return groundTruth;
    }
}
