package me.code4me.plugin.services;

import com.google.gson.Gson;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Code4MeTriggerPointsService {

    private static final Gson gson = new Gson();
    private final Map<String, Boolean> triggerPointMap = new HashMap<>();
    private final int maxTriggerPointLength;
    private final int maxNoSpaceTriggerPointLength;

    public Code4MeTriggerPointsService() throws IOException {
        int maxTriggerPointLength;
        int maxNoSpaceTriggerPointLength;
        try (
                InputStream in = getClass().getResourceAsStream("/triggerPoints.json");
                InputStreamReader reader = new InputStreamReader(Objects.requireNonNull(in))
        ) {
            TriggerPoints points = gson.fromJson(reader, TriggerPoints.class);
            Arrays.stream(points.enforceSpace).forEach(keyword -> triggerPointMap.put(keyword, true));
            Arrays.stream(points.noSpace).forEach(keyword -> triggerPointMap.put(keyword, false));
            maxTriggerPointLength = triggerPointMap.keySet().stream()
                    .mapToInt(String::length)
                    .max()
                    .orElse(0);
            maxNoSpaceTriggerPointLength = triggerPointMap.entrySet().stream()
                    .filter(entry -> Boolean.FALSE.equals(entry.getValue()))
                    .map(Map.Entry::getKey)
                    .mapToInt(String::length)
                    .max()
                    .orElse(0);
        }
        this.maxTriggerPointLength = maxTriggerPointLength;
        this.maxNoSpaceTriggerPointLength = maxNoSpaceTriggerPointLength;
    }

    public Boolean getTriggerPoint(String keyword) {
        return triggerPointMap.get(keyword);
    }

    public int getMaxTriggerPointLength() {
        return maxTriggerPointLength;
    }

    public int getMaxNoSpaceTriggerPointLength() {
        return maxNoSpaceTriggerPointLength;
    }

    private static class TriggerPoints {

        private String[] enforceSpace;
        private String[] noSpace;

        private TriggerPoints(String[] enforceSpace, String[] noSpace) {
            this.enforceSpace = enforceSpace;
            this.noSpace = noSpace;
        }
    }
}
