package me.code4me.plugin;

import com.intellij.DynamicBundle;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.PropertyKey;

import java.util.function.Supplier;

public class Code4MeBundle extends DynamicBundle {

    private static final String PATH_TO_BUNDLE = "messages.Code4MeBundle";
    private static final Code4MeBundle instance = new Code4MeBundle();

    public static @Nls String message(
            @NotNull @PropertyKey(resourceBundle = PATH_TO_BUNDLE) String key,
            Object... params
    ) {
        return instance.getMessage(key, params);
    }

    @NotNull
    public static Supplier<String> messagePointer(
            @NotNull @PropertyKey(resourceBundle = PATH_TO_BUNDLE) String key,
            Object... params
    ) {
        return instance.getLazyMessage(key, params);
    }

    private Code4MeBundle() {
        super(PATH_TO_BUNDLE);
    }
}
