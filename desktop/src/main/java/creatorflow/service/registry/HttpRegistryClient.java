package creatorflow.service.registry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import creatorflow.model.Asset;
import creatorflow.model.VerificationStatus;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Talks to the creatorflow-server REST API with the key from {@link RegistrySettings}. */
public final class HttpRegistryClient implements RegistryClient {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();

    private final RegistrySettings settings;

    public HttpRegistryClient(RegistrySettings settings) {
        this.settings = settings;
    }

    @Override
    public boolean isConfigured() {
        return settings.isConfigured();
    }

    @Override
    public RemoteVerdict verify(String fileName, String sha256, Long dHash, Long pHash, Long audioFp)
            throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("fileName", fileName);
        body.put("sha256", sha256);
        putNullable(body, "dHash", dHash);
        putNullable(body, "pHash", pHash);
        putNullable(body, "audioFp", audioFp);

        JsonNode response = post(settings.baseUrl() + "/api/v1/verify", body, settings.apiKey());
        List<RemoteMatch> matches = new ArrayList<>();
        for (JsonNode match : response.path("matches")) {
            matches.add(new RemoteMatch(
                    match.path("assetId").asLong(),
                    match.path("fileName").asText(),
                    match.path("owner").asText(),
                    match.path("layer").asText(),
                    match.path("distance").asInt(),
                    match.path("note").asText()));
        }
        return new RemoteVerdict(VerificationStatus.valueOf(response.path("verdict").asText("CLEAR")), matches);
    }

    @Override
    public void register(Asset asset) throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("fileName", asset.fileName());
        body.put("fileType", asset.fileType());
        body.put("sizeBytes", asset.sizeBytes());
        body.put("sha256", asset.sha256());
        putNullable(body, "dHash", asset.dHash());
        putNullable(body, "pHash", asset.pHash());
        putNullable(body, "audioFp", asset.audioFp());
        body.put("license", asset.license());
        body.put("ownershipDeclared", asset.ownershipDeclared());
        post(settings.baseUrl() + "/api/v1/assets", body, settings.apiKey());
    }

    /** Account creation happens before the client is configured, so it takes an explicit URL. */
    public static String createAccount(String baseUrl, String username) throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("username", username);
        JsonNode response = post(trim(baseUrl) + "/api/v1/accounts", body, null);
        return response.path("apiKey").asText();
    }

    public static boolean health(String baseUrl) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(trim(baseUrl) + "/api/v1/health"))
                    .timeout(Duration.ofSeconds(4))
                    .GET()
                    .build();
            return HTTP.send(request, HttpResponse.BodyHandlers.ofString()).statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private static JsonNode post(String url, ObjectNode body, String apiKey) throws IOException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(6))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()));
        if (apiKey != null) {
            builder.header("X-Api-Key", apiKey);
        }
        try {
            HttpResponse<String> response = HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode node = response.body() == null || response.body().isBlank()
                    ? JSON.createObjectNode()
                    : JSON.readTree(response.body());
            if (response.statusCode() >= 400) {
                throw new IOException(node.path("error").asText("Registry returned HTTP " + response.statusCode()));
            }
            return node;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Registry request interrupted", e);
        }
    }

    private static void putNullable(ObjectNode node, String field, Long value) {
        if (value != null) {
            node.put(field, value);
        }
    }

    private static String trim(String url) {
        String trimmed = url == null ? "" : url.strip();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }
}
