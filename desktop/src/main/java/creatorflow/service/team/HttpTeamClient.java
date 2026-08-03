package creatorflow.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The live team provenance client. Plumbing lifted from {@code HttpRegistryClient} — one shared
 * {@link HttpClient}, the same 4 s connect / 6 s read budget, the same {@code X-Api-Key} header
 * and error unwrapping — because the failure modes are identical and a second dialect of them
 * would be a second thing to get wrong.
 *
 * <p>The budget matters more here than it did there. Nothing in the preflight flow waits on this
 * client, and every failure becomes a {@link TeamStatus} the UI renders as unknown. There is no
 * retry loop and no cache: a lookup either happened just now or it did not happen.
 */
public final class HttpTeamClient implements TeamClient {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(4);
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(6);
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(CONNECT_TIMEOUT)
            .build();

    private final TeamSettings settings;

    public HttpTeamClient(TeamSettings settings) {
        this.settings = settings;
    }

    @Override
    public boolean isConfigured() {
        return settings.isConfigured();
    }

    @Override
    public TeamDescription describe() {
        if (!settings.isConfigured()) {
            return new TeamDescription(TeamStatus.NOT_CONFIGURED, null,
                    "No team provenance store is configured.");
        }
        try {
            JsonNode members = send("GET", teamPath("/members"), null);
            return new TeamDescription(TeamStatus.OK, members.isArray() ? members.size() : null, null);
        } catch (TeamCallFailed failure) {
            return new TeamDescription(readFailure(failure), null, failure.getMessage());
        }
    }

    @Override
    public LookupResult lookup(String fingerprint) {
        if (!settings.isConfigured()) {
            return LookupResult.of(TeamStatus.NOT_CONFIGURED, "No team provenance store is configured.");
        }
        String normalized = fingerprint == null ? "" : fingerprint.strip().toLowerCase(java.util.Locale.ROOT);
        if (!normalized.matches("[0-9a-f]{64}")) {
            // Refused locally rather than sent: a malformed fingerprint is a caller bug, and a
            // round trip would only turn it into an ambiguous server error.
            return LookupResult.of(TeamStatus.REJECTED, "A 64-hex curve fingerprint is required.");
        }
        try {
            // Fingerprint only. No algorithmVersion parameter exists on this route by design.
            JsonNode rows = send("GET", teamPath("/provenance-claims?fingerprint="
                    + URLEncoder.encode(normalized, StandardCharsets.UTF_8)), null);
            List<ClaimRecord> claims = new ArrayList<>();
            if (rows.isArray()) rows.forEach(row -> claims.add(toClaim(row)));
            return new LookupResult(TeamStatus.OK, List.copyOf(claims), null);
        } catch (TeamCallFailed failure) {
            return LookupResult.of(readFailure(failure), failure.getMessage());
        }
    }

    @Override
    public ShareResult share(ShareRequest request) {
        if (!settings.isConfigured()) {
            return ShareResult.of(TeamStatus.NOT_CONFIGURED, "No team provenance store is configured.");
        }
        ObjectNode body = JSON.createObjectNode();
        // This object IS the contract. LocalBridgeServerTeamRoutesTest asserts the exact key set,
        // because the dialog text is not the spec — the wire is.
        body.put("fingerprint", request.fingerprint());
        body.put("algorithmVersion", request.algorithmVersion());
        body.put("clipName", request.clipName());
        body.put("durationSeconds", request.durationSeconds());
        putNullable(body, "robloxAssetId", request.robloxAssetId());
        putNullable(body, "ownershipContext", request.ownershipContext());
        putNullable(body, "declaredSource", request.declaredSource());
        putNullable(body, "declaredLicense", request.declaredLicense());
        putNullable(body, "declaredNote", request.declaredNote());
        putNullable(body, "observedAt", request.observedAt() == null ? null : request.observedAt().toString());
        try {
            JsonNode response = send("POST", teamPath("/provenance-claims"), body);
            return new ShareResult(TeamStatus.OK, toClaim(response.path("claim")),
                    response.path("alreadyShared").asBoolean(false),
                    response.path("declarationsDiffer").asBoolean(false), null);
        } catch (TeamCallFailed failure) {
            return ShareResult.of(writeFailure(failure), failure.getMessage());
        }
    }

    @Override
    public RetractResult retract(long claimId, String reason) {
        if (!settings.isConfigured()) {
            return RetractResult.of(TeamStatus.NOT_CONFIGURED, "No team provenance store is configured.");
        }
        ObjectNode body = JSON.createObjectNode();
        body.put("reason", reason);
        try {
            JsonNode response = send("POST", teamPath("/provenance-claims/" + claimId + "/retract"), body);
            return new RetractResult(TeamStatus.OK, toClaim(response), null);
        } catch (TeamCallFailed failure) {
            return RetractResult.of(writeFailure(failure), failure.getMessage());
        }
    }

    // ------------------------------------------- account and team management
    //
    // Used by the desktop Settings card only. These take an explicit base URL where the settings
    // may not be saved yet, mirroring HttpRegistryClient.createAccount.

    /** Liveness probe. Never throws — an unreachable server is an answer, not an exception. */
    public static boolean health(String baseUrl) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(trim(baseUrl) + "/api/v1/health"))
                    .timeout(READ_TIMEOUT)
                    .GET()
                    .build();
            return HTTP.send(request, HttpResponse.BodyHandlers.ofString()).statusCode() == 200;
        } catch (Exception unreachable) {
            return false;
        }
    }

    /**
     * Registers a username and returns the issued API key.
     *
     * @param signupToken the operator's {@code creatorflow.signup.token} when they set one; blank
     *                    or null on a server that leaves registration open
     */
    public static String createAccount(String baseUrl, String username, String signupToken)
            throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("username", username);
        HttpRequest.Builder builder = HttpRequest
                .newBuilder(URI.create(trim(baseUrl) + "/api/v1/accounts"))
                .timeout(READ_TIMEOUT)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()));
        if (signupToken != null && !signupToken.isBlank()) {
            builder.header("X-Signup-Token", signupToken.strip());
        }
        try {
            return unwrap(HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString()))
                    .path("apiKey").asText();
        } catch (TeamCallFailed failure) {
            throw new IOException(failure.getMessage(), failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("Team store request interrupted", interrupted);
        }
    }

    /** One team this account belongs to, as the Settings card lists them. */
    public record TeamRecord(long id, String name, String role, long memberCount) {
    }

    public List<TeamRecord> teams() throws IOException {
        JsonNode rows = call("GET", "/api/v1/teams", null);
        List<TeamRecord> teams = new ArrayList<>();
        if (rows.isArray()) {
            rows.forEach(row -> teams.add(new TeamRecord(row.path("id").asLong(),
                    row.path("name").asText(), row.path("role").asText(""),
                    row.path("memberCount").asLong(0))));
        }
        return List.copyOf(teams);
    }

    public TeamRecord createTeam(String name) throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("name", name);
        JsonNode row = call("POST", "/api/v1/teams", body);
        return new TeamRecord(row.path("id").asLong(), row.path("name").asText(),
                row.path("role").asText(""), row.path("memberCount").asLong(0));
    }

    /** Mints a join code. The returned value is shown once and cannot be recovered afterwards. */
    public String issueJoinCode(long teamId) throws IOException {
        return call("POST", "/api/v1/teams/" + teamId + "/join-codes", null).path("code").asText();
    }

    public TeamRecord joinTeam(String code) throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("code", code);
        JsonNode row = call("POST", "/api/v1/teams/join", body);
        return new TeamRecord(row.path("id").asLong(), row.path("name").asText(),
                row.path("role").asText(""), row.path("memberCount").asLong(0));
    }

    /** Members of a team, as {@code username (ROLE)} lines for the Settings card. */
    public List<String> memberLines(long teamId) throws IOException {
        JsonNode rows = call("GET", "/api/v1/teams/" + teamId + "/members", null);
        List<String> lines = new ArrayList<>();
        if (rows.isArray()) {
            rows.forEach(row -> lines.add(row.path("username").asText() + " · "
                    + row.path("role").asText("MEMBER").toLowerCase(java.util.Locale.ROOT)));
        }
        return List.copyOf(lines);
    }

    // --------------------------------------------------------------- plumbing

    private String teamPath(String suffix) {
        return "/api/v1/teams/" + settings.teamId() + suffix;
    }

    /** Settings-card calls, which want a real exception with the server's message. */
    private JsonNode call(String method, String path, ObjectNode body) throws IOException {
        try {
            return send(method, path, body);
        } catch (TeamCallFailed failure) {
            throw new IOException(failure.getMessage(), failure);
        }
    }

    private JsonNode send(String method, String path, ObjectNode body) throws TeamCallFailed {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(settings.baseUrl() + path))
                .timeout(READ_TIMEOUT)
                .header("X-Api-Key", settings.apiKey());
        if (body == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json")
                    .method(method, HttpRequest.BodyPublishers.ofString(body.toString()));
        }
        try {
            return unwrap(HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString()));
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new TeamCallFailed(0, "Team store request interrupted");
        } catch (IOException unreachable) {
            // Deliberately does not include the exception text: a connect failure's message can
            // carry the host and port, and this string reaches the UI.
            throw new TeamCallFailed(0, "Could not reach the team provenance store.");
        }
    }

    private static JsonNode unwrap(HttpResponse<String> response) throws TeamCallFailed {
        JsonNode node;
        try {
            node = response.body() == null || response.body().isBlank()
                    ? JSON.createObjectNode()
                    : JSON.readTree(response.body());
        } catch (com.fasterxml.jackson.core.JsonProcessingException malformed) {
            throw new TeamCallFailed(response.statusCode(),
                    "The team provenance store returned something that is not JSON.");
        }
        if (response.statusCode() >= 400) {
            throw new TeamCallFailed(response.statusCode(), node.path("error")
                    .asText("The team provenance store returned HTTP " + response.statusCode() + "."));
        }
        return node;
    }

    /**
     * The read path's mapping. Anything that is not clearly a credential problem becomes
     * {@link TeamStatus#UNREACHABLE} — i.e. <em>unknown</em>, which is the only safe direction: an
     * unexpected refusal must never end up looking like "the team has no such fingerprint".
     *
     * <p>404 is folded into UNAUTHORIZED on purpose. The server answers 404 rather than 403 for
     * non-membership so team ids cannot be probed, so a 404 here means this credential no longer
     * resolves to the configured team — not that the fingerprint is absent.
     */
    private static TeamStatus readFailure(TeamCallFailed failure) {
        int status = failure.status();
        if (status == 401 || status == 403 || status == 404) return TeamStatus.UNAUTHORIZED;
        return TeamStatus.UNREACHABLE;
    }

    /** The write path's mapping, which may additionally surface a refusal the person can act on. */
    private static TeamStatus writeFailure(TeamCallFailed failure) {
        int status = failure.status();
        if (status == 401 || status == 403 || status == 404) return TeamStatus.UNAUTHORIZED;
        if (status >= 400 && status < 500) return TeamStatus.REJECTED;
        return TeamStatus.UNREACHABLE;
    }

    private static ClaimRecord toClaim(JsonNode row) {
        return new ClaimRecord(
                row.path("id").asLong(),
                row.path("memberUsername").asText(""),
                row.path("isYours").asBoolean(false),
                // Absent reads as false: a build talking to an older store must not offer a
                // retract the server will refuse, and withholding the button is the safe way to
                // be wrong about it.
                row.path("canRetract").asBoolean(false),
                row.path("algorithmVersion").asText(""),
                row.path("clipName").asText(""),
                row.path("durationSeconds").asDouble(0),
                row.hasNonNull("robloxAssetId") ? row.get("robloxAssetId").asLong() : null,
                text(row, "ownershipContext"),
                text(row, "declaredSource"),
                text(row, "declaredLicense"),
                text(row, "declaredNote"),
                instant(row, "observedAt"),
                instant(row, "recordedAt"));
    }

    private static String text(JsonNode row, String field) {
        return row.hasNonNull(field) ? row.get(field).asText() : null;
    }

    private static Instant instant(JsonNode row, String field) {
        if (!row.hasNonNull(field)) return null;
        try {
            return Instant.parse(row.get(field).asText());
        } catch (RuntimeException unparseable) {
            // A timestamp this build cannot read is dropped rather than guessed at. It is
            // display-only; inventing one would be worse than showing none.
            return null;
        }
    }

    private static void putNullable(ObjectNode node, String field, Object value) {
        if (value == null) {
            node.putNull(field);
        } else if (value instanceof Long number) {
            node.put(field, number);
        } else {
            node.put(field, value.toString());
        }
    }

    private static String trim(String url) {
        String trimmed = url == null ? "" : url.strip();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    /** Internal: an HTTP status plus a message safe to show. Never escapes this class. */
    private static final class TeamCallFailed extends Exception {
        private final int status;

        private TeamCallFailed(int status, String message) {
            super(message);
            this.status = status;
        }

        private int status() {
            return status;
        }
    }
}
