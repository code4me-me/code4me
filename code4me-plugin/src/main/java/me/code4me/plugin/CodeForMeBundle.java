package me.code4me.plugin;

import com.intellij.DynamicBundle;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.PropertyKey;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.function.Supplier;

public class CodeForMeBundle extends DynamicBundle {

    private static final String PATH_TO_BUNDLE = "messages.CodeForMeBundle";
    private static final CodeForMeBundle instance = new CodeForMeBundle();

    private static final ScheduledExecutorService executorService = Executors.newSingleThreadScheduledExecutor();

    public static @Nls String message(
            @NotNull @PropertyKey(resourceBundle = PATH_TO_BUNDLE) String key,
            Object @NotNull ... params
    ) {
        return instance.getMessage(key, params);
    }

    @NotNull
    public static Supplier<@Nls String> messagePointer(
            @NotNull @PropertyKey(resourceBundle = PATH_TO_BUNDLE) String key,
            Object @NotNull ... params
    ) {
        return instance.getLazyMessage(key, params);
    }

    public static ScheduledExecutorService getExecutorService() {
        return executorService;
    }

    private CodeForMeBundle() {
        super(PATH_TO_BUNDLE);
    }
}
