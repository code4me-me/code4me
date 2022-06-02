package me.code4me.plugin;

import org.jetbrains.annotations.NotNull;

import java.util.concurrent.Callable;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class Code4MeScheduledThreadPoolExecutor extends ScheduledThreadPoolExecutor {

    private static final Code4MeScheduledThreadPoolExecutor instance = new Code4MeScheduledThreadPoolExecutor();

    public static Code4MeScheduledThreadPoolExecutor getInstance() {
        return instance;
    }

    private Code4MeScheduledThreadPoolExecutor() {
        super(1);
    }

    @Override
    public ScheduledFuture<?> schedule(@NotNull Runnable command, long delay, @NotNull TimeUnit unit) {
        return super.schedule(() -> {
            try {
                command.run();
            } catch (Throwable th) {
                th.printStackTrace();
                throw th;
            }
        }, delay, unit);
    }

    @Override
    public <V> ScheduledFuture<V> schedule(@NotNull Callable<V> callable, long delay, @NotNull TimeUnit unit) {
        return super.schedule(() -> {
            try {
                return callable.call();
            } catch (Throwable th) {
                th.printStackTrace();
                throw th;
            }
        }, delay, unit);
    }
}
