package creatorflow.service.opencloud;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import creatorflow.ownership.OwnershipOutcome;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

/**
 * The one and only component that talks to Roblox Open Cloud. Mirrors
 * {@link creatorflow.service.registry.HttpRegistryClient}: a shared {@link HttpClient} singleton,
 * a ~4s timeout, Jackson parsing, the {@code x-api-key} header sourced from
 * {@link OpenCloudSettings}, and {@code >= 400 ->} an {@link OpenCloudException} (with 429 mapped
 * to {@link RateLimitedException}). Field paths and enum strings come from the Task 0 spike note.
 *
 * <p>This client returns <em>raw facts</em> ({@link AssetInfo}, {@link UniverseOwner},
 * group-member rank); it does not decide ownership — that pure evaluation is
 * {@link OwnershipOutcome#evaluate} in {@code core}, orchestrated by {@code OwnershipVerifier}
 * (Task 4). Nothing here writes to the manifest or the network on export.
 */
public final class OpenCloudClient {

    /** Public Open Cloud host; every endpoint hangs off this. */
    public static final String DEFAULT_BASE_URL = "https://apis.roblox.com";

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(4);

    /** A group can have up to 40 roles; a small paging bound keeps a runaway token loop finite. */
    private static final int MAX_ROLE_PAGES = 20;

    /**
     * A stable, publicly-readable ROBLOX default animation ("R15Idle", from the Task 0 spike note).
     * {@link #testConnection()} reads it to prove both connectivity and that the key is accepted,
     * without needing the user to name an asset they own.
     */
    static final long PROBE_ASSET_ID = 507766388L;

    private final OpenCloudSettings settings;
    private final String baseUrl;

    /** Production entry point: talk to the real Open Cloud host. */
    public OpenCloudClient(OpenCloudSettings settings) {
        this(settings, DEFAULT_BASE_URL);
    }

    /** Test seam: point the client at a local stub server. */
    OpenCloudClient(OpenCloudSettings settings, String baseUrl) {
        this.settings = settings;
        this.baseUrl = trimTrailingSlash(baseUrl);
    }

    /** Whether a key is configured; the bridge route gates the live call on this. */
    public boolean isConfigured() {
        return settings.isConfigured();
    }

    /**
     * A lightweight connectivity + key-acceptance probe for the Settings "Test connection" button.
     * Reads one well-known public asset ({@link #PROBE_ASSET_ID}) and interprets the outcome. Never
     * throws — a "test" that blows up would be a poor button. A 401/403 means the key was rejected;
     * a 429 means the key works but is throttled; any other failure is reported as unreachable.
     */
    public ConnectionStatus testConnection() {
        try {
            getAsset(PROBE_ASSET_ID);
            return ConnectionStatus.OK;
        } catch (RateLimitedException rateLimited) {
            return ConnectionStatus.RATE_LIMITED; // the key was accepted, just throttled
        } catch (OpenCloudException http) {
            return (http.status() == 401 || http.status() == 403)
                    ? ConnectionStatus.KEY_REJECTED
                    : ConnectionStatus.UNREACHABLE;
        } catch (IOException network) {
            return ConnectionStatus.UNREACHABLE;
        }
    }

    /**
     * {@code GET /assets/v1/assets/{id}}. Parses the creator (a bare {@code userId}/{@code groupId}
     * <em>string</em>), the {@code assetType} enum, the {@code moderationResult.moderationState},
     * and the top-level {@code state}.
     */
    public AssetInfo getAsset(long assetId) throws IOException {
        JsonNode node = get("/assets/v1/assets/" + assetId);
        JsonNode creator = node.path("creationContext").path("creator");

        String creatorType = null;
        Long creatorId = null;
        if (creator.hasNonNull("userId")) {
            creatorType = OwnershipOutcome.TYPE_USER;
            creatorId = parseLong(creator.path("userId").asText());
        } else if (creator.hasNonNull("groupId")) {
            creatorType = OwnershipOutcome.TYPE_GROUP;
            creatorId = parseLong(creator.path("groupId").asText());
        }

        String assetType = textOrNull(node, "assetType");
        String moderationState = node.path("moderationResult").hasNonNull("moderationState")
                ? node.path("moderationResult").path("moderationState").asText()
                : null;
        String state = textOrNull(node, "state");
        return new AssetInfo(creatorType, creatorId, assetType, moderationState, state);
    }

    /**
     * {@code GET /cloud/v2/universes/{id}}. The owner is a resource <em>path string</em> — either
     * {@code "user": "users/123"} or {@code "group": "groups/123"} — which this normalizes to a
     * {@code (type, bare id)} pair matching the asset creator's shape.
     */
    public UniverseOwner getUniverse(long universeId) throws IOException {
        JsonNode node = get("/cloud/v2/universes/" + universeId);
        if (node.hasNonNull("user")) {
            return new UniverseOwner(OwnershipOutcome.TYPE_USER, pathId(node.path("user").asText()));
        }
        if (node.hasNonNull("group")) {
            return new UniverseOwner(OwnershipOutcome.TYPE_GROUP, pathId(node.path("group").asText()));
        }
        return new UniverseOwner(null, null);
    }

    /**
     * The creator-user's rank in the owning group, or {@link Optional#empty()} if they are not a
     * member.
     *
     * <p>Two calls per the spike note: the memberships filter endpoint
     * ({@code GET /cloud/v2/groups/{g}/memberships?filter=user=='users/{u}'}) — an <strong>empty
     * {@code groupMemberships} list is "not a member", a 200, never an error</strong> — followed by
     * the roles lookup ({@code GET /cloud/v2/groups/{g}/roles}) to resolve the membership entry's
     * role resource path to its numeric {@code rank}.
     */
    public Optional<Integer> groupMemberRank(long groupId, long userId) throws IOException {
        String filter = URLEncoder.encode("user == 'users/" + userId + "'", StandardCharsets.UTF_8);
        JsonNode memberships = get("/cloud/v2/groups/" + groupId
                + "/memberships?maxPageSize=1&filter=" + filter);

        JsonNode list = memberships.path("groupMemberships");
        if (!list.isArray() || list.isEmpty()) {
            return Optional.empty(); // empty list == not a member (NOT an error)
        }

        String roleId = lastSegment(list.get(0).path("role").asText(""));
        return Optional.ofNullable(rankForRole(groupId, roleId));
    }

    /** Resolve a role id to its numeric rank via the paginated roles endpoint; {@code null} if unresolved. */
    private Integer rankForRole(long groupId, String roleId) throws IOException {
        if (roleId == null || roleId.isBlank()) {
            return null;
        }
        String pageToken = "";
        for (int page = 0; page < MAX_ROLE_PAGES; page++) {
            String path = "/cloud/v2/groups/" + groupId + "/roles?maxPageSize=50";
            if (!pageToken.isBlank()) {
                path += "&pageToken=" + URLEncoder.encode(pageToken, StandardCharsets.UTF_8);
            }
            JsonNode roles = get(path);
            for (JsonNode role : roles.path("groupRoles")) {
                boolean idMatches = roleId.equals(role.path("id").asText())
                        || roleId.equals(lastSegment(role.path("path").asText("")));
                if (idMatches && role.hasNonNull("rank")) {
                    return role.path("rank").asInt();
                }
            }
            pageToken = roles.path("nextPageToken").asText("");
            if (pageToken.isBlank()) {
                break;
            }
        }
        return null;
    }

    private JsonNode get(String path) throws IOException {
        String apiKey = settings.apiKey();
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(REQUEST_TIMEOUT)
                .header("x-api-key", apiKey == null ? "" : apiKey)
                .header("Accept", "application/json")
                .GET()
                .build();
        try {
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status == 429) {
                throw new RateLimitedException(messageFor(response, status), retryAfter(response));
            }
            if (status >= 400) {
                throw new OpenCloudException(status, messageFor(response, status));
            }
            String body = response.body();
            return body == null || body.isBlank() ? JSON.createObjectNode() : JSON.readTree(body);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Open Cloud request interrupted", e);
        }
    }

    /** Prefer the API's {@code message} field for the exception text, else a generic status line. */
    private static String messageFor(HttpResponse<String> response, int status) {
        try {
            String body = response.body();
            if (body != null && !body.isBlank()) {
                JsonNode node = JSON.readTree(body);
                if (node.hasNonNull("message")) {
                    return node.path("message").asText();
                }
            }
        } catch (IOException ignored) {
            // fall through to the generic message
        }
        return "Open Cloud returned HTTP " + status;
    }

    private static Duration retryAfter(HttpResponse<String> response) {
        return response.headers().firstValue("retry-after")
                .map(String::strip)
                .map(value -> {
                    try {
                        return Duration.ofSeconds(Long.parseLong(value));
                    } catch (NumberFormatException e) {
                        return null;
                    }
                })
                .orElse(null);
    }

    private static String textOrNull(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.path(field).asText() : null;
    }

    /** Last path segment of a resource path such as {@code "users/123"} or {@code "groups/1/roles/2"}. */
    private static String lastSegment(String resourcePath) {
        if (resourcePath == null || resourcePath.isBlank()) {
            return "";
        }
        int slash = resourcePath.lastIndexOf('/');
        return slash >= 0 ? resourcePath.substring(slash + 1) : resourcePath;
    }

    /** Numeric id from a resource path such as {@code "users/82914"} -> {@code 82914L}. */
    private static Long pathId(String resourcePath) {
        return parseLong(lastSegment(resourcePath));
    }

    private static Long parseLong(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(value.strip());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String trimTrailingSlash(String url) {
        String trimmed = url == null ? "" : url.strip();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    /**
     * The facts an asset lookup yields. {@code creatorType} is {@code "USER"}/{@code "GROUP"}/
     * {@code null}; {@code creatorId} is the bare numeric id. {@code moderationState} and
     * {@code state} are the raw Roblox strings (e.g. {@code "Approved"}, {@code "Active"}).
     */
    public record AssetInfo(
            String creatorType,
            Long creatorId,
            String assetType,
            String moderationState,
            String state) {
    }

    /**
     * The experience owner an universe lookup yields, normalized to the same {@code (type, bare id)}
     * shape as {@link AssetInfo}. Both are {@code null} when the response carried neither a
     * {@code user} nor a {@code group} owner.
     */
    public record UniverseOwner(String ownerType, Long ownerId) {
    }

    /** The outcome of {@link #testConnection()}, mapped to an honest message in the Settings UI. */
    public enum ConnectionStatus {
        /** Open Cloud responded and accepted the key. */
        OK,
        /** Open Cloud rejected the key (401/403) — wrong value or missing scopes. */
        KEY_REJECTED,
        /** The key works but Open Cloud is rate-limiting (429) — a transient throttle. */
        RATE_LIMITED,
        /** Open Cloud could not be reached, or returned an unexpected error. */
        UNREACHABLE
    }
}
