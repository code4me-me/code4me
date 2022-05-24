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
            this.settings = new Settings(UUID.randomUUID().toString().replace("-", ""), true);
            this.save();
        } else {
            this.settings = gson.fromJson(settingsJson, Settings.class);
        }
    }

    public Settings getSettings() {
        return settings;
    }

    public void save() {
        PasswordSafe.getInstance().setPassword(credentialAttributes, gson.toJson(settings));
    }

    public static class Settings {

        private final String userToken;
        private boolean triggerPoints;

        public Settings(String userToken, boolean triggerPoints) {
            this.userToken = userToken;
            this.triggerPoints = triggerPoints;
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
    }
}
