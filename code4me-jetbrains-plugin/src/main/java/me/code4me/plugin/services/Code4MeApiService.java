package me.code4me.plugin.services;

import com.google.gson.Gson;
import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.progress.ProgressIndicator;
import com.intellij.openapi.progress.ProgressManager;
import com.intellij.openapi.progress.Task;
import com.intellij.openapi.project.Project;
import me.code4me.plugin.api.PredictionAutocompleteRequest;
import me.code4me.plugin.api.PredictionAutocompleteResponse;
import me.code4me.plugin.api.PredictionVerifyRequest;
import me.code4me.plugin.api.PredictionVerifyResponse;
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
    private static final String PREDICTION_AUTOCOMPLETE_ENDPOINT = "/prediction/autocomplete";
    private static final String PREDICTION_VERIFY_ENDPOINT = "/prediction/verify";
    private static final String SURVEY_ENDPOINT = "/survey?user_id=%s";

    private final AtomicBoolean lock = new AtomicBoolean(false);

    public Code4MeApiService() {

    }

    public CompletableFuture<PredictionAutocompleteResponse> fetchAutoCompletion(
            Project project,
            PredictionAutocompleteRequest request
    ) {
        CompletableFuture<PredictionAutocompleteResponse> future = new CompletableFuture<>();

        if (lock.getAndSet(true)) {
            future.completeExceptionally(new AlreadyAutocompletingException("You are already autocompleting!"));
            return future;
        }

        String token = project.getService(Code4MeSettingsService.class).getSettings().getUserToken();

        ProgressManager.getInstance().run(new Task.Backgroundable(project, "Idk", false) {
            public void run(@NotNull ProgressIndicator indicator) {
                indicator.setText("Autocompleting...");

                try (CloseableHttpClient client = HttpClients.createDefault()) {
                    HttpPost httpPost = new HttpPost(BASE_URL + PREDICTION_AUTOCOMPLETE_ENDPOINT);
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
                                PredictionAutocompleteResponse.class,
                                res.getStatusLine().getStatusCode()
                        );

                        if (response instanceof PredictionAutocompleteResponse) {
                            future.complete((PredictionAutocompleteResponse) response);
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

    public CompletableFuture<PredictionVerifyResponse> sendCompletionData(
            Project project,
            PredictionVerifyRequest request
    ) {
        CompletableFuture<PredictionVerifyResponse> future = new CompletableFuture<>();

        String token = project.getService(Code4MeSettingsService.class).getSettings().getUserToken();

        ForkJoinPool.commonPool().execute(() -> {
            try (CloseableHttpClient client = HttpClients.createDefault()) {
                HttpPost httpPost = new HttpPost(BASE_URL + PREDICTION_VERIFY_ENDPOINT);
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
                            PredictionVerifyResponse.class,
                            res.getStatusLine().getStatusCode()
                    );

                    if (response instanceof PredictionVerifyResponse) {
                        future.complete((PredictionVerifyResponse) response);
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

    public void redirectToCode4MeSurvey(Project project) {
        String userToken = project.getService(Code4MeSettingsService.class).getSettings().getUserToken();
        BrowserUtil.browse(BASE_URL + String.format(SURVEY_ENDPOINT, userToken));
    }
}
