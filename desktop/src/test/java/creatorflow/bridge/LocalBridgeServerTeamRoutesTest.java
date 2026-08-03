package creatorflow.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import creatorflow.db.AnimationComparisonRepository;
import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.MotionSnapshotRepository;
import creatorflow.db.OwnershipVerificationRepository;
import creatorflow.db.PluginPairingRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.PlaybackSettings;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.team.TeamClient;
import creatorflow.service.team.TeamSettings;
import creatorflow.service.team.TeamStatus;
import creatorflow.workflow.MotionSnapshotRecord;
import creatorflow.workflow.ReleaseExportService;
import java.lang.reflect.RecordComponent;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The bridge's four team routes, and the honesty properties they exist to hold.
 *
 * <p>Two of these are the phase, not detail:
 * <ul>
 *   <li><strong>The frontend cannot publish a fingerprint the desktop did not compute.</strong>
 *       The share route reads the fingerprint, algorithm version, clip name and duration from the
 *       local {@code motion_snapshots} row and ignores whatever the request said. The wire shape
 *       is asserted field by field, because the confirmation dialog's text is not the contract —
 *       the wire is.</li>
 *   <li><strong>A lookup that could not run still answers 200, carrying its status.</strong> If
 *       an unreachable store failed the request instead, the UI would be free to render "no
 *       claims" — which is the one thing this phase must never say when it does not know.</li>
 * </ul>
 */
class LocalBridgeServerTeamRoutesTest {

    private static final String SNAPSHOT_FINGERPRINT = "c".repeat(64);
    private static final String ALGORITHM_VERSION = "creatorflow.motion-fingerprint/v1";

    @TempDir
    Path directory;

    private final ObjectMapper json = new ObjectMapper();
    private final AtomicReference<TeamClient> fakeTeam = new AtomicReference<>(TeamClient.disabled());

    private Database database;
    private LocalBridgeServer server;
    private HttpClient client;
    private URI origin;
    private String cookie;
    private String csrf;
    private TeamSettings teamSettings;
    private MotionSnapshotRecord snapshot;

    @BeforeEach
    void start() throws Exception {
        database = new Database(directory.resolve("bridge.db"));
        Path webRoot = Files.createDirectories(directory.resolve("web"));
        var localProjects = new LocalProjectRepository(database);
        var scans = new ScanRepository(database);
        var decisions = new DecisionRepository(database);
        var releases = new ReleaseRepository(database);
        var workspaceState = new WorkspaceStateRepository(database);
        var animationComparisons = new AnimationComparisonRepository(database);
        var motionSnapshots = new MotionSnapshotRepository(database);
        var pluginPairings = new PluginPairingService(new PluginPairingRepository(database));
        var audit = new AuditRepository(database);
        var coordinator = new ScanCoordinator(scans, localProjects, audit);
        var ownershipVerifications = new OwnershipVerificationRepository(database);
        var releaseExports = new ReleaseExportService(database, localProjects, scans, decisions,
                releases, audit, ownershipVerifications);
        teamSettings = new TeamSettings(directory);

        var project = localProjects.adopt(Files.createDirectories(directory.resolve("project")));
        snapshot = motionSnapshots.capture(project.projectId(), "1042", MotionSnapshotKind.LAST_KNOWN_GOOD,
                null, "courier_run", 1.25, SNAPSHOT_FINGERPRINT, ALGORITHM_VERSION,
                PlaybackSettings.of(true, "Action"));

        server = new LocalBridgeServer(() -> Optional.of(directory), localProjects, scans,
                decisions, releases, workspaceState, animationComparisons, motionSnapshots,
                pluginPairings, releaseExports, new OpenCloudSettings(directory), teamSettings,
                new DelegatingTeamClient(fakeTeam),
                (assetId, universeId, now) -> {
                    throw new IllegalStateException("ownership verification is not exercised here");
                },
                ownershipVerifications, coordinator, webRoot).start();

        client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
        origin = server.origin();
        HttpResponse<String> launch = client.send(
                HttpRequest.newBuilder(server.launchUri()).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        cookie = launch.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
        csrf = json.readTree(get("/api/v1/session").body()).get("csrfToken").asText();
    }

    @AfterEach
    void stop() {
        if (server != null) server.close();
        if (database != null) database.close();
    }

    /**
     * The load-bearing one. A browser can name a snapshot; it cannot name a fingerprint.
     */
    @Test
    void shareReadsTheFingerprintFromTheLocalSnapshotAndIgnoresTheRequest() throws Exception {
        CapturingTeamClient team = configuredTeam();

        HttpResponse<String> response = postJson("/api/v1/team/provenance-claims", """
                {"snapshotId":"%s",
                 "fingerprint":"%s",
                 "algorithmVersion":"attacker.made-this-up/v9",
                 "clipName":"not_the_real_clip",
                 "durationSeconds":999.0,
                 "declaredSource":"Authored in-house"}
                """.formatted(snapshot.id(), "d".repeat(64)));
        assertEquals(201, response.statusCode(), response.body());

        TeamClient.ShareRequest sent = team.lastShare;
        assertNotNull(sent, "the share never reached the client");
        assertEquals(SNAPSHOT_FINGERPRINT, sent.fingerprint(),
                "the request's fingerprint must be ignored entirely — this is the whole guard");
        assertEquals(ALGORITHM_VERSION, sent.algorithmVersion());
        assertEquals("courier_run", sent.clipName());
        assertEquals(1.25, sent.durationSeconds());
        // Declared text is the one thing that does come from the request, verbatim.
        assertEquals("Authored in-house", sent.declaredSource());
        // observedAt is the snapshot's own capture time — this machine's clock, hence DECLARED.
        assertEquals(snapshot.createdAt(), sent.observedAt());
    }

    /**
     * The wire shape, pinned. Adding a field to {@code ShareRequest} without deciding what it means
     * for a person is how a provenance record quietly grows something verdict-shaped.
     */
    @Test
    void theShareWireCarriesExactlyTheseFieldsAndNothingElse() {
        List<String> actual = Arrays.stream(TeamClient.ShareRequest.class.getRecordComponents())
                .map(RecordComponent::getName)
                .toList();
        assertEquals(List.of("fingerprint", "algorithmVersion", "clipName", "durationSeconds",
                "robloxAssetId", "ownershipContext", "declaredSource", "declaredLicense",
                "declaredNote", "observedAt"), actual,
                "the share wire changed. Four of these are read from the local snapshot and six are "
                        + "DECLARED text; anything new has to be classified as one or the other, and "
                        + "must not be a score, a rank or a decision.");
    }

    /** Same discipline for what comes back: no verdict field can appear without this failing. */
    @Test
    void theClaimWireCarriesNoVerdictScoreOrRank() {
        List<String> actual = Arrays.stream(TeamClient.ClaimRecord.class.getRecordComponents())
                .map(RecordComponent::getName)
                .toList();
        assertEquals(List.of("id", "memberUsername", "isYours", "algorithmVersion", "clipName",
                "durationSeconds", "robloxAssetId", "ownershipContext", "declaredSource",
                "declaredLicense", "declaredNote", "observedAt", "recordedAt"), actual,
                "a claim gained or lost a field. A judgement must stay underivable from this record.");
    }

    @Test
    void shareRejectsAnUnknownSnapshotRatherThanInventingOne() throws Exception {
        configuredTeam();
        assertEquals(404, postJson("/api/v1/team/provenance-claims",
                "{\"snapshotId\":\"00000000-0000-0000-0000-000000000000\"}").statusCode());
    }

    /**
     * The single most important behaviour in the phase. An unreachable store answers 200 with a
     * status, so "we could not ask" can never arrive at the UI looking like an empty result set.
     */
    @Test
    void aLookupAgainstAnUnreachableStoreStillAnswers200WithItsStatus() throws Exception {
        fakeTeam.set(new StatusOnlyTeamClient(TeamStatus.UNREACHABLE));

        HttpResponse<String> response = postJson("/api/v1/team/provenance-lookup",
                "{\"fingerprint\":\"" + SNAPSHOT_FINGERPRINT + "\",\"algorithmVersion\":\""
                        + ALGORITHM_VERSION + "\"}");
        assertEquals(200, response.statusCode());
        JsonNode body = json.readTree(response.body());
        assertEquals("UNREACHABLE", body.get("status").asText());
        assertEquals(0, body.get("claims").size());
        assertTrue(body.has("status"),
                "an empty claims array without a status is indistinguishable from 'nobody has this'");
    }

    @Test
    void anUnconfiguredStoreAnswersNotConfiguredRatherThanAnEmptySuccess() throws Exception {
        HttpResponse<String> response = postJson("/api/v1/team/provenance-lookup",
                "{\"fingerprint\":\"" + SNAPSHOT_FINGERPRINT + "\"}");
        assertEquals(200, response.statusCode());
        assertEquals("NOT_CONFIGURED", json.readTree(response.body()).get("status").asText());
    }

    /**
     * The lookup is fingerprint-only. The caller's algorithm version is echoed back so the UI can
     * classify each row against it, and is never used to filter — here or upstream.
     */
    @Test
    void theLookupEchoesTheAlgorithmVersionAndSendsOnlyTheFingerprint() throws Exception {
        CapturingTeamClient team = configuredTeam();

        HttpResponse<String> response = postJson("/api/v1/team/provenance-lookup",
                "{\"fingerprint\":\"" + SNAPSHOT_FINGERPRINT.toUpperCase(java.util.Locale.ROOT)
                        + "\",\"algorithmVersion\":\"" + ALGORITHM_VERSION + "\"}");
        assertEquals(200, response.statusCode());
        JsonNode body = json.readTree(response.body());
        assertEquals(ALGORITHM_VERSION, body.get("algorithmVersion").asText());
        assertEquals(SNAPSHOT_FINGERPRINT, body.get("fingerprint").asText(), "echoed lowercased");
        assertEquals(SNAPSHOT_FINGERPRINT, team.lastLookup, "the client is asked by fingerprint only");

        JsonNode claim = body.get("claims").get(0);
        // The row's own version travels untouched, whatever it is — classification is the UI's job.
        assertEquals("creatorflow.motion-fingerprint/v2", claim.get("algorithmVersion").asText());
        for (String forbidden : new String[]{"verdict", "score", "distance", "rank", "decision"}) {
            assertFalse(claim.has(forbidden), "a claim must carry no " + forbidden + " field");
        }
    }

    @Test
    void theTeamStatusRouteReportsConfigurationWithoutEverCarryingTheKey() throws Exception {
        configuredTeam();
        HttpResponse<String> response = get("/api/v1/team");
        assertEquals(200, response.statusCode());
        JsonNode body = json.readTree(response.body());

        assertTrue(body.get("configured").asBoolean());
        assertEquals("Harbor Studio", body.get("teamName").asText());
        assertEquals(3, body.get("memberCount").asInt());
        assertEquals("OK", body.get("status").asText());
        assertFalse(body.has("apiKey"), "the team API key must never cross this bridge");
        assertFalse(response.body().contains("team-key-value"),
                "the key leaked into the status payload");
    }

    @Test
    void anUnreachableStoreReportsNoMemberCountRatherThanAStaleOne() throws Exception {
        teamSettings.save("http://team.example:8080", "team-key-value", "mira");
        teamSettings.saveTeam(7L, "Harbor Studio");
        fakeTeam.set(new StatusOnlyTeamClient(TeamStatus.UNREACHABLE));

        JsonNode body = json.readTree(get("/api/v1/team").body());
        assertEquals("UNREACHABLE", body.get("status").asText());
        assertTrue(body.get("memberCount").isNull(),
                "nothing about a team is cached, so an unreachable store has no member count to show");
    }

    @Test
    void retractNeedsAReason() throws Exception {
        configuredTeam();
        assertEquals(400, postJson("/api/v1/team/provenance-claims/41/retract", "{}").statusCode());
        assertEquals(200, postJson("/api/v1/team/provenance-claims/41/retract",
                "{\"reason\":\"Shared the wrong export.\"}").statusCode());
    }

    @Test
    void aRetractAgainstAnUnreachableStoreFailsLoudlyRatherThanLookingLikeSuccess() throws Exception {
        fakeTeam.set(new StatusOnlyTeamClient(TeamStatus.UNREACHABLE));
        assertEquals(503, postJson("/api/v1/team/provenance-claims/41/retract",
                "{\"reason\":\"Shared the wrong export.\"}").statusCode());
    }

    /** Every team route is a mutation or a session read; none of them is reachable cross-origin. */
    @Test
    void theTeamRoutesKeepTheSessionAndCsrfGuards() throws Exception {
        HttpResponse<String> noCsrf = client.send(HttpRequest
                .newBuilder(origin.resolve("/api/v1/team/provenance-lookup"))
                .header("Content-Type", "application/json")
                .header("Cookie", cookie)
                .header("Origin", origin.toString())
                .POST(HttpRequest.BodyPublishers.ofString("{\"fingerprint\":\"" + SNAPSHOT_FINGERPRINT + "\"}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, noCsrf.statusCode());

        HttpResponse<String> noSession = client.send(HttpRequest
                .newBuilder(origin.resolve("/api/v1/team")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, noSession.statusCode());
    }

    // --------------------------------------------------------------- helpers

    private CapturingTeamClient configuredTeam() {
        teamSettings.save("http://team.example:8080", "team-key-value", "mira");
        teamSettings.saveTeam(7L, "Harbor Studio");
        CapturingTeamClient team = new CapturingTeamClient();
        fakeTeam.set(team);
        return team;
    }

    private HttpResponse<String> get(String path) throws Exception {
        return client.send(HttpRequest.newBuilder(origin.resolve(path))
                .header("Cookie", cookie)
                .GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> postJson(String path, String body) throws Exception {
        return client.send(HttpRequest.newBuilder(origin.resolve(path))
                .header("Content-Type", "application/json")
                .header("Cookie", cookie)
                .header("Origin", origin.toString())
                .header("X-CreatorFlow-CSRF", csrf)
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build(), HttpResponse.BodyHandlers.ofString());
    }

    /** Records what the bridge actually asked for, and answers with one v2 row. */
    private static final class CapturingTeamClient implements TeamClient {

        private static final ClaimRecord CLAIM = new ClaimRecord(41, "mira", false,
                "creatorflow.motion-fingerprint/v2", "courier_run", 1.25, 90110L, "group:12345",
                "Authored in-house", "All rights reserved", null,
                Instant.parse("2026-07-30T09:00:00Z"), Instant.parse("2026-07-30T09:00:04Z"));

        private volatile String lastLookup;
        private volatile ShareRequest lastShare;

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public TeamDescription describe() {
            return new TeamDescription(TeamStatus.OK, 3, null);
        }

        @Override
        public LookupResult lookup(String fingerprint) {
            lastLookup = fingerprint;
            return new LookupResult(TeamStatus.OK, List.of(CLAIM), null);
        }

        @Override
        public ShareResult share(ShareRequest request) {
            lastShare = request;
            return new ShareResult(TeamStatus.OK, CLAIM, false, false, null);
        }

        @Override
        public RetractResult retract(long claimId, String reason) {
            return new RetractResult(TeamStatus.OK, CLAIM, null);
        }
    }

    /** Answers one status to everything — the shape of every failure mode. */
    private record StatusOnlyTeamClient(TeamStatus status) implements TeamClient {

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public TeamDescription describe() {
            return new TeamDescription(status, null, "The team store could not be reached.");
        }

        @Override
        public LookupResult lookup(String fingerprint) {
            return LookupResult.of(status, "The team store could not be reached.");
        }

        @Override
        public ShareResult share(ShareRequest request) {
            return ShareResult.of(status, "The team store could not be reached.");
        }

        @Override
        public RetractResult retract(long claimId, String reason) {
            return RetractResult.of(status, "The team store could not be reached.");
        }
    }

    @Test
    void aLookupNeverReportsRejectedForAWellFormedFingerprint() throws Exception {
        // REJECTED exists for the write paths. On the read path an unexpected refusal degrades to
        // UNREACHABLE — unknown — because that is the direction that cannot mislead.
        configuredTeam();
        JsonNode body = json.readTree(postJson("/api/v1/team/provenance-lookup",
                "{\"fingerprint\":\"" + SNAPSHOT_FINGERPRINT + "\"}").body());
        assertEquals("OK", body.get("status").asText());
        assertNull(body.get("message").textValue());
    }
}
