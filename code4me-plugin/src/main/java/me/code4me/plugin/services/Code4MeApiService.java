package me.code4me.plugin.services;

import com.google.gson.Gson;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import me.code4me.plugin.api.Code4MeAutocompleteRequest;
import me.code4me.plugin.api.Code4MeAutocompleteResponse;
import me.code4me.plugin.api.Code4MeCompletionRequest;
import me.code4me.plugin.api.Code4MeCompletionResponse;
import me.code4me.plugin.api.Code4MeErrorResponse;
import me.code4me.plugin.api.Code4MeResponse;
import me.code4me.plugin.exceptions.AlreadyAutocompletingException;
import me.code4me.plugin.exceptions.ApiServerException;
import org.apache.http.Header;
import org.apache.http.HttpEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.jetbrains.annotations.NotNull;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.atomic.AtomicBoolean;

public class Code4MeApiService {

    private static final Gson gson = new Gson();
    private static final String BASE_URL = "https://code4me.me/api/v1";
    private static final String AUTOCOMPLETE_ENDPOINT = "/autocomplete";
    private static final String COMPLETION_ENDPOINT = "/completion";

    private final AtomicBoolean lock = new AtomicBoolean(false);

    public Code4MeApiService() {

    }

    public CompletableFuture<Code4MeAutocompleteResponse> fetchAutoCompletion(
            Project project,
            Code4MeAutocompleteRequest request
    ) {
        CompletableFuture<Code4MeAutocompleteResponse> future = new CompletableFuture<>();

        if (lock.getAndSet(true)) {
            future.completeExceptionally(new AlreadyAutocompletingException("You are already autocompleting!"));
            return future;
        }

        String token = project.getService(Code4MeSettingsService.class).getSettings().getUserToken();

        ProgressManager.getInstance().run(new Task.Backgroundable(project, "Idk", false) {
            public void run(@NotNull ProgressIndicator indicator) {
                indicator.setText("Autocompleting...");

                try (CloseableHttpClient client = HttpClients.createDefault()) {
                    HttpPost httpPost = new HttpPost(BASE_URL + AUTOCOMPLETE_ENDPOINT);
                    httpPost.addHeader("Authorization", "Bearer " + token);
                    httpPost.setEntity(new StringEntity(
                            gson.toJson(request),
                            ContentType.create(
                                    ContentType.APPLICATION_JSON.getMimeType(),
                                    StandardCharsets.UTF_8
                            )
                    ));

                    try (CloseableHttpResponse res = client.execute(httpPost)) {
                        Code4MeResponse response = parseResponseBody(
                                res.getEntity(),
                                Code4MeAutocompleteResponse.class,
                                res.getStatusLine().getStatusCode()
                        );

                        if (response instanceof Code4MeAutocompleteResponse) {
                            future.complete((Code4MeAutocompleteResponse) response);
                        } else if (response instanceof Code4MeErrorResponse) {
                            future.completeExceptionally(new ApiServerException((Code4MeErrorResponse) response));
                        } else {
                            future.completeExceptionally(new RuntimeException("Unknown Code4MeResponse " + response));
                        }
                    }
                } catch (IOException ex) {
                    future.completeExceptionally(ex);
                }
                lock.set(false);
            }
        });
        return future;
    }

    public CompletableFuture<Code4MeCompletionResponse> sendCompletionData(
            Project project,
            Code4MeCompletionRequest request
    ) {
        CompletableFuture<Code4MeCompletionResponse> future = new CompletableFuture<>();

        String token = project.getService(Code4MeSettingsService.class).getSettings().getUserToken();

        ForkJoinPool.commonPool().execute(() -> {
            try (CloseableHttpClient client = HttpClients.createDefault()) {
                HttpPost httpPost = new HttpPost(BASE_URL + COMPLETION_ENDPOINT);
                httpPost.addHeader("Authorization", "Bearer " + token);
                httpPost.setEntity(new StringEntity(
                        gson.toJson(request),
                        ContentType.create(
                                ContentType.APPLICATION_JSON.getMimeType(),
                                StandardCharsets.UTF_8
                        )
                ));

                try (CloseableHttpResponse res = client.execute(httpPost)) {
                    Code4MeResponse response = parseResponseBody(
                            res.getEntity(),
                            Code4MeCompletionResponse.class,
                            res.getStatusLine().getStatusCode()
                    );

                    if (response instanceof Code4MeCompletionResponse) {
                        future.complete((Code4MeCompletionResponse) response);
                    } else if (response instanceof Code4MeErrorResponse) {
                        future.completeExceptionally(
                                new RuntimeException(((Code4MeErrorResponse) response).getError())
                        );
                    } else {
                        future.completeExceptionally(new RuntimeException("Unknown Code4MeResponse " + response));
                    }
                }
            } catch (IOException ex) {
                future.completeExceptionally(ex);
            }
        });
        return future;
    }

    private <T extends Code4MeResponse> Code4MeResponse parseResponseBody(
            HttpEntity entity,
            Class<T> clazz,
            int statusCode
    ) throws IOException {
        try (
                InputStream in = entity.getContent();
                InputStreamReader reader = new InputStreamReader(in)
        ) {
            Header contentType = entity.getContentType();
            if (contentType != null && contentType.getValue().contains("application/json") && statusCode >= 200 && statusCode < 300) {
                return gson.fromJson(reader, clazz);
            } else {
                return new Code4MeErrorResponse(new String(in.readAllBytes(), StandardCharsets.UTF_8), statusCode);
            }
        }
    }
}
