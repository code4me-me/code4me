package me.code4me.plugin.services;

import com.google.gson.Gson;
import com.intellij.credentialStore.CredentialAttributes;
import com.intellij.credentialStore.CredentialAttributesKt;
import com.intellij.ide.passwordSafe.PasswordSafe;

import java.util.UUID;

public class Code4MeSettingsService {

    private static final Gson gson = new Gson();
    private static final String SERVICE_NAME = "Code4MeSettings";
    private static final String SETTINGS_KEY = "Settings";

    private final CredentialAttributes credentialAttributes;
    private final Settings settings;

    public Code4MeSettingsService() {
        this.credentialAttributes = new CredentialAttributes(CredentialAttributesKt.generateServiceName(
                SERVICE_NAME,
                SETTINGS_KEY
        ));

        String settingsJson = PasswordSafe.getInstance().getPassword(credentialAttributes);
        if (settingsJson == null) {
            this.settings = new Settings(generateToken(), true, false, true);
            this.save();
        } else {
            this.settings = gson.fromJson(settingsJson, Settings.class);
            if (this.settings.getUserToken() == null) {
                this.settings.setUserToken(generateToken());
                this.save();
            }
        }
    }

    public Settings getSettings() {
        return settings;
    }

    private String generateToken() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    public void save() {
        PasswordSafe.getInstance().setPassword(credentialAttributes, gson.toJson(settings));
    }

    public static class Settings {

        private String userToken;
        private boolean triggerPoints;
        private Boolean ignoringSurvey;
        private boolean storeContext;

        public Settings(String userToken, boolean triggerPoints, boolean ignoringSurvey, boolean storeContext) {
            this.userToken = userToken;
            this.triggerPoints = triggerPoints;
            this.ignoringSurvey = ignoringSurvey;
            this.storeContext = storeContext;
        }

        public void setUserToken(String userToken) {
            this.userToken = userToken;
        }

        public String getUserToken() {
            return userToken;
        }

        public boolean isTriggerPoints() {
            return triggerPoints;
        }

        public void setTriggerPoints(boolean triggerPoints) {
            this.triggerPoints = triggerPoints;
        }

        public boolean isIgnoringSurvey() {
            return Boolean.TRUE.equals(ignoringSurvey);
        }

        public void setIgnoringSurvey(boolean ignoringSurvey) {
            this.ignoringSurvey = ignoringSurvey;
        }

        public boolean isStoreContext() {
            return storeContext;
        }

        public void setStoreContext(boolean storeContext) {
            this.storeContext = storeContext;
        }
    }
}
