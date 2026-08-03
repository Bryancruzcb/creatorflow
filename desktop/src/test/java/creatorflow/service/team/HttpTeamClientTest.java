package creatorflow.service.team;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * {@link HttpTeamClient} against a real HTTP server, because until now nothing exercised it against
 * one: every bridge test substitutes a fake {@code TeamClient}, which meant the status mapping, the
 * URL construction, the {@code X-Api-Key} header, the error unwrapping and the JSON parsing — the
 * whole of the read path's actual behaviour — were unverified.
 *
 * <p>The stub is {@link HttpServer} on an ephemeral loopback port, the same shape
 * {@code OpenCloudClientTest} already uses for the Roblox client.
 *
 * <p>The mapping being pinned here is not cosmetic. Every one of these statuses renders as
 * <em>unknown</em> except {@code OK}, so a bug that mapped a failure to OK — or that let an empty
 * body parse into an empty-but-successful result — would put "no one on your team has this" on
 * screen off the back of a server error.
 */
class HttpTeamClientTest {

    @TempDir
    Path directory;

    private HttpServer server;
    private TeamSettings settings;
    private HttpTeamClient client;
    private final List<String> requestedPaths = new ArrayList<>();
    private final List<String> presentedKeys = new ArrayList<>();

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        settings = new TeamSettings(directory);
        settings.save("http://127.0.0.1:" + server.getAddress().getPort(), "test-api-key", "mira");
        settings.saveTeam(7L, "Harbor Studio");
        client = new HttpTeamClient(settings);
    }

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    private void respond(String path, int status, String body) {
        server.createContext(path, exchange -> {
            requestedPaths.add(exchange.getRequestURI().toString());
            String key = exchange.getRequestHeaders().getFirst("X-Api-Key");
            presentedKeys.add(key == null ? "<none>" : key);
            send(exchange, status, body);
        });
    }

    private static void send(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    @Test
    void aLookupSendsTheFingerprintAsAQueryParameterAndTheKeyAsAHeader() {
        respond("/api/v1/teams/7/provenance-claims", 200, "[]");

        TeamClient.LookupResult result = client.lookup("A".repeat(64));

        assertEquals(TeamStatus.OK, result.status());
        assertEquals(List.of("/api/v1/teams/7/provenance-claims?fingerprint=" + "a".repeat(64)),
                requestedPaths, "the fingerprint must be lowercased and sent as the only parameter");
        assertEquals(List.of("test-api-key"), presentedKeys);
        // No algorithmVersion parameter exists on this route: version classification is the
        // client's job, and filtering upstream would drop rows a person needs to be shown.
        assertFalse(requestedPaths.get(0).contains("algorithmVersion"));
    }

    @Test
    void aPopulatedRowIsParsedFieldForField() {
        respond("/api/v1/teams/7/provenance-claims", 200, """
                [{"id":41,"memberUsername":"mira","isYours":true,"canRetract":true,
                  "algorithmVersion":"creatorflow.motion-fingerprint/v1","clipName":"courier_run",
                  "durationSeconds":1.25,"robloxAssetId":90110,"ownershipContext":"group:12345",
                  "declaredSource":"Authored in-house","declaredLicense":"All rights reserved",
                  "declaredNote":null,"observedAt":"2026-07-30T09:00:00Z",
                  "recordedAt":"2026-07-30T09:00:04Z"}]
                """);

        TeamClient.ClaimRecord claim = client.lookup("a".repeat(64)).claims().get(0);

        assertEquals(41, claim.id());
        assertEquals("mira", claim.memberUsername());
        assertTrue(claim.isYours());
        assertTrue(claim.canRetract());
        assertEquals("creatorflow.motion-fingerprint/v1", claim.algorithmVersion());
        assertEquals(90110L, claim.robloxAssetId());
        assertNull(claim.declaredNote(), "an explicit null must stay null, not become \"null\"");
        assertEquals("2026-07-30T09:00:04Z", claim.recordedAt().toString());
    }

    /** Absent reads as false: never offer a retract the server will refuse. */
    @Test
    void aRowFromAnOlderStoreWithoutCanRetractDefaultsToNotAllowed() {
        respond("/api/v1/teams/7/provenance-claims", 200,
                "[{\"id\":1,\"memberUsername\":\"mira\",\"isYours\":true}]");
        assertFalse(client.lookup("a".repeat(64)).claims().get(0).canRetract());
    }

    @Test
    void credentialFailuresMapToUnauthorizedIncludingTheDeliberate404() {
        respond("/api/v1/teams/7/provenance-claims", 404, "{\"error\":\"Team not found.\"}");
        TeamClient.LookupResult result = client.lookup("a".repeat(64));
        // 404 is what non-membership answers by design, so it means "this credential no longer
        // resolves to that team" — never "that fingerprint is absent".
        assertEquals(TeamStatus.UNAUTHORIZED, result.status());
        assertTrue(result.claims().isEmpty());
        assertEquals("Team not found.", result.message());
    }

    @Test
    void aServerErrorOnTheReadPathIsUnknownRatherThanAnEmptyResult() {
        respond("/api/v1/teams/7/provenance-claims", 500, "{\"error\":\"boom\"}");
        assertEquals(TeamStatus.UNREACHABLE, client.lookup("a".repeat(64)).status());
    }

    /**
     * The direction that matters most: an unexpected 4xx on a READ degrades to unknown, not to
     * REJECTED and not to OK. Anything that lands on OK here would render as an absence of claims.
     */
    @Test
    void anUnexpectedRefusalOnTheReadPathDegradesToUnknown() {
        respond("/api/v1/teams/7/provenance-claims", 409, "{\"error\":\"nope\"}");
        assertEquals(TeamStatus.UNREACHABLE, client.lookup("a".repeat(64)).status());
    }

    @Test
    void aBodyThatIsNotJsonIsUnknownRatherThanAnEmptyList() {
        server.createContext("/api/v1/teams/7/provenance-claims", exchange -> {
            byte[] bytes = "<html>proxy error</html>".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        TeamClient.LookupResult result = client.lookup("a".repeat(64));
        assertEquals(TeamStatus.UNREACHABLE, result.status());
        assertTrue(result.claims().isEmpty());
    }

    @Test
    void anUnreachableHostIsUnknownAndTheMessageDoesNotLeakTheAddress() {
        server.stop(0);
        TeamClient.LookupResult result = client.lookup("a".repeat(64));
        assertEquals(TeamStatus.UNREACHABLE, result.status());
        assertEquals("Could not reach the team provenance store.", result.message(),
                "a connect failure's own text can carry the host and port, and this string is shown");
    }

    /** Refused locally, before any socket: the store is fine and was never contacted. */
    @Test
    void aMalformedFingerprintIsRejectedWithoutASingleRequest() {
        respond("/api/v1/teams/7/provenance-claims", 200, "[]");
        TeamClient.LookupResult result = client.lookup("not-a-fingerprint");
        assertEquals(TeamStatus.REJECTED, result.status());
        assertTrue(requestedPaths.isEmpty(), "a malformed fingerprint must not reach the network");
    }

    @Test
    void anUnconfiguredStoreNeverReachesTheNetworkAndNeverLooksEmpty() {
        settings.clear();
        TeamClient.LookupResult result = new HttpTeamClient(settings).lookup("a".repeat(64));
        assertEquals(TeamStatus.NOT_CONFIGURED, result.status());
        assertTrue(requestedPaths.isEmpty());
    }

    @Test
    void shareCarriesTheWholeWireBodyAndReportsAnAlreadySharedClaim() {
        AtomicReference<String> body = new AtomicReference<>();
        server.createContext("/api/v1/teams/7/provenance-claims", exchange -> {
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            send(exchange, 200, """
                    {"claim":{"id":41,"memberUsername":"mira","isYours":true,"canRetract":true,
                              "algorithmVersion":"creatorflow.motion-fingerprint/v1",
                              "clipName":"courier_run","durationSeconds":1.25,
                              "recordedAt":"2026-07-30T09:00:04Z"},
                     "alreadyShared":true,"declarationsDiffer":true}
                    """);
        });

        TeamClient.ShareResult result = client.share(new TeamClient.ShareRequest(
                "a".repeat(64), "creatorflow.motion-fingerprint/v1", "courier_run", 1.25,
                90110L, "group:12345", "Authored in-house", "All rights reserved", null,
                java.time.Instant.parse("2026-07-30T09:00:00Z")));

        assertEquals(TeamStatus.OK, result.status());
        assertTrue(result.alreadyShared());
        // The stale-declaration flag has to survive the wire, or the UI cannot say "already
        // shared - retract to change" and a dropped correction looks like a success.
        assertTrue(result.declarationsDiffer());
        for (String field : new String[]{"fingerprint", "algorithmVersion", "clipName",
                "durationSeconds", "robloxAssetId", "ownershipContext", "declaredSource",
                "declaredLicense", "declaredNote", "observedAt"}) {
            assertTrue(body.get().contains("\"" + field + "\""), "the share body dropped " + field);
        }
    }

    /** A write is something a person just did, so a fixable refusal keeps its message. */
    @Test
    void aRefusedShareIsRejectedWithTheServersMessageRatherThanADisguisedOutage() {
        respond("/api/v1/teams/7/provenance-claims", 400,
                "{\"error\":\"fingerprint must be a 64-hex-character curve fingerprint.\"}");
        TeamClient.ShareResult result = client.share(new TeamClient.ShareRequest(
                "a".repeat(64), "v1", "courier_run", 1.0, null, null, null, null, null, null));
        assertEquals(TeamStatus.REJECTED, result.status());
        assertTrue(result.message().contains("64-hex"));
    }

    @Test
    void retractPostsToTheClaimsRetractPathAndSurfacesAnOutageDistinctly() {
        respond("/api/v1/teams/7/provenance-claims/41/retract", 503, "{\"error\":\"down\"}");
        TeamClient.RetractResult result = client.retract(41, "Shared the wrong export.");
        assertEquals(TeamStatus.UNREACHABLE, result.status());
        assertEquals(List.of("/api/v1/teams/7/provenance-claims/41/retract"), requestedPaths);
    }

    @Test
    void describeCountsMembersLiveAndReportsNoCountWhenItCannotAsk() {
        respond("/api/v1/teams/7/members", 200, "[{\"username\":\"mira\"},{\"username\":\"amir\"}]");
        TeamClient.TeamDescription described = client.describe();
        assertEquals(TeamStatus.OK, described.status());
        assertEquals(2, described.memberCount());

        server.stop(0);
        TeamClient.TeamDescription offline = client.describe();
        assertEquals(TeamStatus.UNREACHABLE, offline.status());
        assertNull(offline.memberCount(), "there is no cached member count to fall back on");
    }
}
