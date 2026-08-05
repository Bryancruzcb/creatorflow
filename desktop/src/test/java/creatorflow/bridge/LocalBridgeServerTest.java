package creatorflow.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import creatorflow.TestMedia;
import creatorflow.db.AuditRepository;
import creatorflow.db.AnimationComparisonRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionBatchRepository;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.MotionSnapshotRepository;
import creatorflow.db.OwnershipVerificationRepository;
import creatorflow.db.PluginPairingRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.ManifestJson;
import creatorflow.manifest.OwnershipEvidence;
import creatorflow.manifest.ReleaseGate;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.opencloud.RateLimitedException;
import creatorflow.service.team.TeamClient;
import creatorflow.service.team.TeamSettings;
import creatorflow.service.team.TeamStatus;
import creatorflow.workflow.AnimationComparisonRecord;
import creatorflow.workflow.BatchDecisionService;
import creatorflow.workflow.ReleaseExportService;
import creatorflow.workflow.ScanAccounting;
import creatorflow.workflow.ScanAsset;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class LocalBridgeServerTest {

    @TempDir
    Path directory;

    private Database database;
    private LocalBridgeServer server;
    private HttpClient client;
    private URI origin;
    private URI launchUri;
    private String cookie;
    private String csrf;
    private Path webRoot;
    private LocalProjectRepository localProjects;
    private ScanRepository scans;
    private DecisionRepository decisions;
    private ReleaseRepository releases;
    private WorkspaceStateRepository workspaceState;
    private OpenCloudSettings openCloudSettings;
    private TeamSettings teamSettings;
    private OwnershipVerificationRepository ownershipVerifications;
    private DecisionBatchRepository decisionBatches;
    // The fake the verify-ownership route calls — swapped per test to return a MATCH, a MISMATCH,
    // or to throw a RateLimitedException, all without a live Open Cloud call.
    private final AtomicReference<OwnershipVerification> fakeVerifier = new AtomicReference<>();
    // Same seam for the team store: no test in this class ever opens a socket to one.
    private final AtomicReference<TeamClient> fakeTeam = new AtomicReference<>(TeamClient.disabled());

    @BeforeEach
    void start() throws Exception {
        database = new Database(directory.resolve("bridge.db"));
        webRoot = Files.createDirectories(directory.resolve("web"));
        startBridge();
        client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
        authenticate();
    }

    private void startBridge() {
        localProjects = new LocalProjectRepository(database);
        scans = new ScanRepository(database);
        decisions = new DecisionRepository(database);
        releases = new ReleaseRepository(database);
        workspaceState = new WorkspaceStateRepository(database);
        var animationComparisons = new AnimationComparisonRepository(database);
        var motionSnapshots = new MotionSnapshotRepository(database);
        var pluginPairings = new PluginPairingService(new PluginPairingRepository(database));
        var audit = new AuditRepository(database);
        var coordinator = new ScanCoordinator(scans, localProjects, audit);
        ownershipVerifications = new OwnershipVerificationRepository(database);
        var releaseExports = new ReleaseExportService(database, localProjects, scans, decisions,
                releases, audit, ownershipVerifications);
        decisionBatches = new DecisionBatchRepository(database);
        var batchDecisions = new BatchDecisionService(database, scans, decisions, decisionBatches,
                audit, releaseExports);
        openCloudSettings = new OpenCloudSettings(directory);
        // Delegate to whatever the current test installed; never a live call.
        OwnershipVerification verifier = (robloxAssetId, universeId, now) -> {
            OwnershipVerification delegate = fakeVerifier.get();
            if (delegate == null) {
                throw new IllegalStateException("no fake OwnershipVerification installed for this test");
            }
            return delegate.verify(robloxAssetId, universeId, now);
        };
        // Nothing in this suite makes a live team call: the bridge delegates to whatever the
        // current test installed, and the default is TeamClient.disabled() — the state a fresh
        // install is in. The fixture test swaps in a fake that answers with a populated claim.
        teamSettings = new TeamSettings(directory);
        fakeTeam.set(TeamClient.disabled());
        TeamClient teamClient = new DelegatingTeamClient(fakeTeam);
        server = new LocalBridgeServer(() -> Optional.of(directory), localProjects, scans,
                decisions, releases, workspaceState, animationComparisons, motionSnapshots,
                pluginPairings, releaseExports, batchDecisions, openCloudSettings, teamSettings,
                teamClient, verifier, ownershipVerifications,
                coordinator, webRoot).start();
    }

    private void authenticate() throws Exception {
        origin = server.origin();
        launchUri = server.launchUri();

        HttpResponse<String> launch = client.send(HttpRequest.newBuilder(launchUri).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(303, launch.statusCode());
        String setCookie = launch.headers().firstValue("set-cookie").orElseThrow();
        assertTrue(setCookie.contains("HttpOnly"));
        assertTrue(setCookie.contains("SameSite=Strict"));
        cookie = setCookie.split(";", 2)[0];
        HttpResponse<String> session = get("/api/v1/session", cookie);
        assertEquals(200, session.statusCode());
        csrf = new ObjectMapper().readTree(session.body()).get("csrfToken").asText();
    }

    @AfterEach
    void stop() {
        server.close();
        database.close();
    }

    @Test
    void launchTokenIsSingleUseAndSessionIsHttpOnlySameSite() throws Exception {
        HttpResponse<String> reused = client.send(HttpRequest.newBuilder(launchUri).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, reused.statusCode());

        HttpResponse<String> missingSession = get("/api/v1/session", null);
        assertEquals(401, missingSession.statusCode());

        HttpResponse<String> page = get("/", null);
        assertEquals(200, page.statusCode());
        assertTrue(page.headers().firstValue("content-security-policy").isPresent());
        assertFalse(page.headers().firstValue("access-control-allow-origin").isPresent());
    }

    @Test
    void mutationsRequireSameOriginAndCsrfBeforeOpeningPicker() throws Exception {
        assertEquals(403, post("/api/v1/project-picker", cookie, null, null).statusCode());
        assertEquals(403, post("/api/v1/project-picker", cookie, "https://evil.test", csrf).statusCode());
        assertEquals(403, post("/api/v1/project-picker", cookie, origin.toString(), "wrong").statusCode());

        HttpResponse<String> accepted = post("/api/v1/project-picker", cookie, origin.toString(), csrf);
        assertEquals(201, accepted.statusCode());
        assertTrue(accepted.body().contains("projectId"));
        assertFalse(accepted.body().contains(directory.toString()));
    }

    @Test
    void rejectsForgedHostAndEncodedTraversal() throws Exception {
        assertTrue(rawRequest("GET / HTTP/1.1\r\nHost: evil.invalid\r\nConnection: close\r\n\r\n")
                .startsWith("HTTP/1.1 403"));
        int port = origin.getPort();
        String traversal = rawRequest("GET /%2e%2e/secret HTTP/1.1\r\nHost: 127.0.0.1:" + port
                + "\r\nConnection: close\r\n\r\n");
        assertTrue(traversal.startsWith("HTTP/1.1 400"));
    }

    @Test
    void servesDecoderAndLargeModelTypesFromTheConfiguredWebRoot() throws Exception {
        byte[] wasm = new byte[] {0, 97, 115, 109};
        byte[] model = new byte[2 * 1024 * 1024];
        Arrays.fill(model, (byte) 7);
        Files.write(webRoot.resolve("decoder.wasm"), wasm);
        Files.write(webRoot.resolve("scene.glb"), model);

        HttpResponse<byte[]> decoder = client.send(
                HttpRequest.newBuilder(origin.resolve("/decoder.wasm")).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, decoder.statusCode());
        assertEquals("application/wasm", decoder.headers().firstValue("content-type").orElseThrow());
        assertTrue(Arrays.equals(wasm, decoder.body()));

        HttpResponse<byte[]> scene = client.send(
                HttpRequest.newBuilder(origin.resolve("/scene.glb")).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, scene.statusCode());
        assertEquals("model/gltf-binary", scene.headers().firstValue("content-type").orElseThrow());
        assertEquals(model.length, scene.body().length);
        assertEquals("public, max-age=31536000, immutable",
                scene.headers().firstValue("cache-control").orElseThrow());
    }

    @Test
    void selectedProjectCanRunARealScanAndReturnPersistedAssets() throws Exception {
        TestMedia.writePng(directory, "hero.png", TestMedia.structuredImage(9));
        ObjectMapper json = new ObjectMapper();
        HttpResponse<String> picked = post("/api/v1/project-picker", cookie, origin.toString(), csrf);
        long projectId = json.readTree(picked.body()).get("projectId").asLong();

        HttpRequest scanRequest = HttpRequest.newBuilder(
                        origin.resolve("/api/v1/projects/" + projectId + "/scan-runs"))
                .header("Cookie", cookie)
                .header("Origin", origin.toString())
                .header("X-CreatorFlow-CSRF", csrf)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"release\":\"test-1\"}"))
                .build();
        HttpResponse<String> started = client.send(scanRequest, HttpResponse.BodyHandlers.ofString());
        assertEquals(202, started.statusCode());
        String runId = json.readTree(started.body()).get("id").asText();

        String state = "QUEUED";
        for (int attempt = 0; attempt < 100 && !"COMPLETED".equals(state); attempt++) {
            Thread.sleep(25);
            state = json.readTree(get("/api/v1/scan-runs/" + runId, cookie).body())
                    .get("state").asText();
        }
        assertEquals("COMPLETED", state);
        HttpResponse<String> assets = get("/api/v1/projects/" + projectId + "/assets", cookie);
        assertEquals(200, assets.statusCode());
        assertEquals("hero.png", json.readTree(assets.body()).get("items").get(0).get("fileName").asText());
        assertFalse(assets.body().contains(directory.toString()));

        long assetId = json.readTree(assets.body()).get("items").get(0).get("id").asLong();
        assertEquals(403, postJson("/api/v1/assets/" + assetId + "/source-evidence",
                cookie, origin.toString(), null,
                "{\"source\":\"Contract\",\"license\":\"Owned\"}").statusCode());
        assertEquals(201, postJson("/api/v1/assets/" + assetId + "/source-evidence",
                cookie, origin.toString(), csrf,
                "{\"source\":\"Contract\",\"license\":\"Owned\",\"evidenceUrl\":\"https://example.test/hero\"}")
                .statusCode());
        assertEquals(201, postJson("/api/v1/assets/" + assetId + "/decisions",
                cookie, origin.toString(), csrf,
                "{\"type\":\"APPROVED\",\"reason\":\"Contract verified\"}").statusCode());

        HttpResponse<String> created = postJson("/api/v1/projects/" + projectId + "/releases",
                cookie, origin.toString(), csrf,
                "{\"scanRunId\":\"" + runId + "\",\"release\":\"test-1.0\"}");
        assertEquals(201, created.statusCode());
        assertTrue(json.readTree(created.body()).get("report").get("passed").asBoolean());
        String releaseId = json.readTree(created.body()).get("id").asText();
        HttpResponse<String> manifest = get("/api/v1/releases/" + releaseId + "/manifest", cookie);
        assertEquals(200, manifest.statusCode());
        assertTrue(manifest.headers().firstValue("content-disposition").orElseThrow()
                .contains("test-1.0-manifest.json"));
        assertFalse(manifest.body().contains("Contract verified"));
        assertTrue(manifest.body().contains("\"decision\" : \"APPROVED\""));
        assertTrue(manifest.body().contains("https://example.test/hero"));
        var releaseList = json.readTree(get("/api/v1/projects/" + projectId + "/releases", cookie).body())
                .get("items");
        assertEquals(1, releaseList.size());
        assertEquals(1, releaseList.get(0).get("comparison").get("added").asInt());
    }

    @Test
    void bindsAnIntendedExperienceDeclarationAndSurfacesItOnProjectAndReleaseViews() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();

        String body = "{\"universeId\":1234567890,\"placeId\":9876543210,\"experienceName\":\"Obby Tower\"}";
        assertEquals(403, postJson("/api/v1/projects/" + projectId + "/experience",
                cookie, origin.toString(), null, body).statusCode());

        HttpResponse<String> bound = postJson("/api/v1/projects/" + projectId + "/experience",
                cookie, origin.toString(), csrf, body);
        assertEquals(200, bound.statusCode(), bound.body());
        JsonNode boundExperience = json.readTree(bound.body()).get("experience");
        assertEquals(1234567890L, boundExperience.get("universeId").asLong());
        assertEquals(9876543210L, boundExperience.get("placeId").asLong());
        assertEquals("Obby Tower", boundExperience.get("experienceName").asText());

        HttpResponse<String> projects = get("/api/v1/projects", cookie);
        assertEquals(200, projects.statusCode());
        JsonNode listedExperience = json.readTree(projects.body()).get("items").get(0).get("experience");
        assertEquals("Obby Tower", listedExperience.get("experienceName").asText());

        assertEquals(400, postJson("/api/v1/projects/" + projectId + "/experience",
                cookie, origin.toString(), csrf,
                "{\"universeId\":1234567890,\"placeId\":9876543210,\"experienceName\":\"   \"}").statusCode());
        assertEquals(400, postJson("/api/v1/projects/" + projectId + "/experience",
                cookie, origin.toString(), csrf,
                "{\"placeId\":9876543210,\"experienceName\":\"Obby Tower\"}").statusCode());
        assertEquals(400, postJson("/api/v1/projects/" + projectId + "/experience",
                cookie, origin.toString(), csrf,
                "{\"universeId\":-1,\"placeId\":9876543210,\"experienceName\":\"Obby Tower\"}").statusCode());
    }

    @Test
    void recordsASelfReportedPublishedPlaceVersionOnARelease() throws Exception {
        TestMedia.writePng(directory, "hero.png", TestMedia.structuredImage(9));
        ObjectMapper json = new ObjectMapper();
        HttpResponse<String> picked = post("/api/v1/project-picker", cookie, origin.toString(), csrf);
        long projectId = json.readTree(picked.body()).get("projectId").asLong();

        HttpResponse<String> started = postJson("/api/v1/projects/" + projectId + "/scan-runs",
                cookie, origin.toString(), csrf, "{\"release\":\"test-1\"}");
        assertEquals(202, started.statusCode());
        String runId = json.readTree(started.body()).get("id").asText();

        String state = "QUEUED";
        for (int attempt = 0; attempt < 100 && !"COMPLETED".equals(state); attempt++) {
            Thread.sleep(25);
            state = json.readTree(get("/api/v1/scan-runs/" + runId, cookie).body()).get("state").asText();
        }
        assertEquals("COMPLETED", state);

        HttpResponse<String> created = postJson("/api/v1/projects/" + projectId + "/releases",
                cookie, origin.toString(), csrf,
                "{\"scanRunId\":\"" + runId + "\",\"release\":\"test-1.0\"}");
        assertEquals(201, created.statusCode());
        String releaseId = json.readTree(created.body()).get("id").asText();
        assertTrue(json.readTree(created.body()).get("publishedPlaceVersion").isNull());

        assertEquals(403, postJson("/api/v1/releases/" + releaseId + "/published-version",
                cookie, origin.toString(), null, "{\"publishedPlaceVersion\":7}").statusCode());

        HttpResponse<String> recorded = postJson("/api/v1/releases/" + releaseId + "/published-version",
                cookie, origin.toString(), csrf, "{\"publishedPlaceVersion\":7}");
        assertEquals(200, recorded.statusCode(), recorded.body());
        assertEquals(7, json.readTree(recorded.body()).get("publishedPlaceVersion").asInt());

        var releaseList = json.readTree(get("/api/v1/projects/" + projectId + "/releases", cookie).body())
                .get("items");
        assertEquals(7, releaseList.get(0).get("publishedPlaceVersion").asInt());

        assertEquals(400, postJson("/api/v1/releases/" + releaseId + "/published-version",
                cookie, origin.toString(), csrf, "{}").statusCode());
        assertEquals(400, postJson("/api/v1/releases/" + releaseId + "/published-version",
                cookie, origin.toString(), csrf, "{\"publishedPlaceVersion\":0}").statusCode());
        assertEquals(400, postJson("/api/v1/releases/" + releaseId + "/published-version",
                cookie, origin.toString(), csrf, "{\"publishedPlaceVersion\":-1}").statusCode());
    }

    @Test
    void projectListHidesRootsAndWorkspaceStateSurvivesBridgeRestart() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String body = "{\"activeProjectId\":" + projectId
                + ",\"filters\":{\"status\":\"SIMILAR\"},\"queue\":[\"finding-1\"]}";
        assertEquals(403, postJson("/api/v1/workspace-state", cookie, origin.toString(), null, body)
                .statusCode());
        assertEquals(200, postJson("/api/v1/workspace-state", cookie, origin.toString(), csrf, body)
                .statusCode());

        HttpResponse<String> projects = get("/api/v1/projects", cookie);
        assertEquals(200, projects.statusCode());
        assertTrue(projects.body().contains("projectId"));
        assertFalse(projects.body().contains(directory.toString()));

        server.close();
        database.close();
        database = new Database(directory.resolve("bridge.db"));
        startBridge();
        authenticate();

        HttpResponse<String> restored = get("/api/v1/workspace-state", cookie);
        assertEquals(projectId, json.readTree(restored.body()).get("activeProjectId").asLong());
        assertEquals("SIMILAR", json.readTree(restored.body()).get("filters").get("status").asText());
        assertEquals("finding-1", json.readTree(restored.body()).get("queue").get(0).asText());
    }

    @Test
    void pairedStudioPluginCanStoreMotionEvidenceWithoutBrowserCookiesOrOrigin() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        HttpResponse<String> issued = post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf);
        assertEquals(201, issued.statusCode());
        String token = json.readTree(issued.body()).get("token").asText();
        assertEquals(origin.toString(), json.readTree(issued.body()).get("endpoint").asText());

        assertEquals(401, pluginRequest("GET", "/plugin/v1/health", "wrong", null).statusCode());
        HttpResponse<String> health = pluginRequest("GET", "/plugin/v1/health", token, null);
        assertEquals(200, health.statusCode());
        assertEquals("creatorflow.roblox-motion/v0.1",
                json.readTree(health.body()).get("schema").asText());

        String animation = """
                {
                  "assetId":"%s","name":"Walk","duration":1.0,"looped":true,
                  "priority":"Movement","keyframes":[
                    {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        String body = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("1001") + ",\"candidate\":" + animation.formatted("1002") + "}";
        HttpResponse<String> compared = pluginRequest(
                "POST", "/plugin/v1/motion-comparisons", token, body);
        assertEquals(201, compared.statusCode(), compared.body());
        assertTrue(json.readTree(compared.body()).get("exactCurveData").asBoolean());
        assertEquals(100, json.readTree(compared.body()).get("overallScore").asInt());
        String comparisonId = json.readTree(compared.body()).get("id").asText();

        HttpResponse<String> history = get(
                "/api/v1/projects/" + projectId + "/motion-comparisons", cookie);
        assertEquals(200, history.statusCode());
        assertEquals(comparisonId, json.readTree(history.body()).get("items").get(0).get("id").asText());
        assertEquals(401, get("/api/v1/motion-comparisons/" + comparisonId, null).statusCode());

        HttpResponse<String> malformed = pluginRequest("POST", "/plugin/v1/motion-comparisons", token,
                "{\"schema\":\"wrong\"}");
        assertEquals(400, malformed.statusCode());
        assertEquals(1, json.readTree(get(
                "/api/v1/projects/" + projectId + "/motion-comparisons", cookie).body())
                .get("items").size());
    }

    @Test
    void motionComparisonAcceptsAndReturnsOptionalPlayability() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        String animation = """
                {
                  "assetId":"%s","name":"Walk","duration":1.0,"looped":true,
                  "priority":"Movement","keyframes":[
                    {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        String withPlayability = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("3001") + ",\"candidate\":" + animation.formatted("3002")
                + ",\"playability\":{\"source\":{\"r6\":{\"ok\":true}},\"candidate\":{\"r6\":{\"ok\":false,\"error\":\"boom\"}}}}";
        HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token, withPlayability);
        assertEquals(201, compared.statusCode(), compared.body());
        assertTrue(json.readTree(compared.body()).has("playability"));
        assertTrue(json.readTree(compared.body()).get("playability").get("source").get("r6").get("ok").asBoolean());

        String withoutPlayability = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("4001") + ",\"candidate\":" + animation.formatted("4002") + "}";
        HttpResponse<String> comparedNoPlayability = pluginRequest(
                "POST", "/plugin/v1/motion-comparisons", token, withoutPlayability);
        assertEquals(201, comparedNoPlayability.statusCode(), comparedNoPlayability.body());
        assertFalse(json.readTree(comparedNoPlayability.body()).has("playability"));
    }

    @Test
    void motionComparisonReportsStructuralRigBindingEvenWithoutAPlayabilityProbe() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        // An R15-shaped clip: three channels named the way Roblox's stock R15 dummy names its parts,
        // none of which exist on an R6 dummy.
        String animation = """
                {
                  "assetId":"%s","name":"Walk","duration":1.0,"looped":true,
                  "priority":"Movement","keyframes":[
                    {"time":0.0,"poses":[
                      {"jointPath":"HumanoidRootPart","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"},
                      {"jointPath":"HumanoidRootPart/LowerTorso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"},
                      {"jointPath":"HumanoidRootPart/LowerTorso/UpperTorso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"},
                      {"jointPath":"HumanoidRootPart/LowerTorso/UpperTorso/LeftUpperArm","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[
                      {"jointPath":"HumanoidRootPart","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"},
                      {"jointPath":"HumanoidRootPart/LowerTorso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"},
                      {"jointPath":"HumanoidRootPart/LowerTorso/UpperTorso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"},
                      {"jointPath":"HumanoidRootPart/LowerTorso/UpperTorso/LeftUpperArm","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        // No "playability" key at all -- the exact submission a plugin sends while its stock-rig
        // asset IDs are still unfilled. The structural check has to answer anyway; that is the
        // whole point of deriving it here instead of in Studio.
        String body = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("9101") + ",\"candidate\":" + animation.formatted("9102") + "}";
        HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token, body);
        assertEquals(201, compared.statusCode(), compared.body());
        JsonNode view = json.readTree(compared.body());
        assertFalse(view.has("playability"));

        JsonNode r15 = view.get("rigBinding").get("source").get("r15");
        assertEquals("R15", r15.get("rig").asText());
        assertEquals(4, r15.get("channels").asInt());
        assertEquals(4, r15.get("boundChannels").asInt());
        assertEquals(100, r15.get("boundPercent").asInt());
        assertFalse(r15.get("warn").asBoolean());

        JsonNode r6 = view.get("rigBinding").get("source").get("r6");
        assertEquals(1, r6.get("boundChannels").asInt(), "only HumanoidRootPart exists on both rigs");
        assertEquals(25, r6.get("boundPercent").asInt());
        assertTrue(r6.get("warn").asBoolean());
        assertTrue(r6.get("unboundJoints").toString().contains("LeftUpperArm"));

        // Both sides are reported, and the record keeps it: a rig-binding warning has to survive
        // the round trip to the history list, not just decorate the 201.
        assertTrue(view.get("rigBinding").get("candidate").get("r6").get("warn").asBoolean());
        String comparisonId = view.get("id").asText();
        JsonNode reread = json.readTree(get("/api/v1/motion-comparisons/" + comparisonId, cookie).body());
        assertEquals(25, reread.get("rigBinding").get("source").get("r6").get("boundPercent").asInt());
    }

    @Test
    void motionComparisonAcceptsAndReturnsOptionalClipKinds() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        String animation = """
                {
                  "assetId":"%s","name":"Walk","duration":1.0,"looped":true,
                  "priority":"Movement","keyframes":[
                    {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        String withKinds = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("7001") + ",\"candidate\":" + animation.formatted("7002")
                + ",\"sourceKind\":\"KEYFRAME\",\"candidateKind\":\"CURVE_SAMPLED\"}";
        HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token, withKinds);
        assertEquals(201, compared.statusCode(), compared.body());
        assertEquals("KEYFRAME", json.readTree(compared.body()).get("sourceKind").asText());
        assertEquals("CURVE_SAMPLED", json.readTree(compared.body()).get("candidateKind").asText());

        String withoutKinds = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("8001") + ",\"candidate\":" + animation.formatted("8002") + "}";
        HttpResponse<String> comparedNoKinds = pluginRequest(
                "POST", "/plugin/v1/motion-comparisons", token, withoutKinds);
        assertEquals(201, comparedNoKinds.statusCode(), comparedNoKinds.body());
        assertFalse(json.readTree(comparedNoKinds.body()).has("sourceKind"));
        assertFalse(json.readTree(comparedNoKinds.body()).has("candidateKind"));

        // A kind outside the two the app knows is rejected rather than stored verbatim. The
        // pinning guard compares the STORED value against the literal "CURVE_SAMPLED", so a
        // lowercase or invented spelling reaching the column would slip past that guard the day
        // it is flipped shut — the wrong direction for a safety switch to fail in.
        String lowercaseKind = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("8101") + ",\"candidate\":" + animation.formatted("8102")
                + ",\"sourceKind\":\"curve_sampled\",\"candidateKind\":\"KEYFRAME\"}";
        HttpResponse<String> rejectedSource = pluginRequest(
                "POST", "/plugin/v1/motion-comparisons", token, lowercaseKind);
        assertEquals(400, rejectedSource.statusCode(), rejectedSource.body());

        String unknownCandidateKind = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("8201") + ",\"candidate\":" + animation.formatted("8202")
                + ",\"sourceKind\":\"KEYFRAME\",\"candidateKind\":\"PROCEDURAL\"}";
        HttpResponse<String> rejectedCandidate = pluginRequest(
                "POST", "/plugin/v1/motion-comparisons", token, unknownCandidateKind);
        assertEquals(400, rejectedCandidate.statusCode(), rejectedCandidate.body());
    }

    /**
     * The comparison view has to carry the playback settings the record already stores (#121).
     *
     * <p>Two clips identical except for {@code Looped} have identical curve data, so they get
     * identical fingerprints, an EXACT_CURVE_DATA verdict, and every score at 100. That is correct
     * and stays correct — the fingerprint is a curve-data claim and nothing else (see
     * {@code creatorflow.motion.PlaybackSettings}). Both halves are pinned here on purpose: the
     * scoring is asserted unchanged, so a later attempt to "fix" this by folding the flags into the
     * fingerprint fails loudly, and the settings that explain why a looping idle and a one-shot pose
     * read alike now actually reach the reader.
     */
    @Test
    void motionComparisonViewCarriesBothSidesPlaybackSettings() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        String animation = """
                {
                  "assetId":"%s","name":"Idle","duration":1.0,"looped":%s,
                  "priority":"%s","keyframes":[
                    {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        String body = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("5001", "true", "Movement") + ",\"candidate\":"
                + animation.formatted("5002", "false", "Action") + "}";
        HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token, body);
        assertEquals(201, compared.statusCode(), compared.body());
        JsonNode view = json.readTree(compared.body());

        // Unchanged by design — the fix is presentation, and this says so in a way a rewrite breaks.
        assertTrue(view.get("exactCurveData").asBoolean());
        assertEquals(100, view.get("overallScore").asInt());

        assertTrue(view.get("sourcePlayback").get("looped").asBoolean());
        assertEquals("Movement", view.get("sourcePlayback").get("priority").asText());
        assertFalse(view.get("candidatePlayback").get("looped").asBoolean());
        assertEquals("Action", view.get("candidatePlayback").get("priority").asText());

        // Re-read rather than only echoed: a reviewer opens this record days after the plugin ran,
        // so the settings have to survive the columns, not just the response that wrote them.
        JsonNode reread = json.readTree(get(
                "/api/v1/motion-comparisons/" + view.get("id").asText(), cookie).body());
        assertTrue(reread.get("sourcePlayback").get("looped").asBoolean());
        assertEquals("Movement", reread.get("sourcePlayback").get("priority").asText());
        assertFalse(reread.get("candidatePlayback").get("looped").asBoolean());
        assertEquals("Action", reread.get("candidatePlayback").get("priority").asText());
    }

    /**
     * Rows written before {@code V012} have NULL playback columns, and the view has to say nothing
     * rather than guess.
     *
     * <p>A default would be worse than silence: rendering an unrecorded loop flag as "no" invents a
     * difference nobody observed, which is the same mistake in the opposite direction from the one
     * #121 fixes. {@code PlaybackSettings.unknown()} means unknown all the way to the wire.
     */
    @Test
    void motionComparisonViewOmitsPlaybackSettingsThatWereNeverRecorded() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        AnimationComparisonRecord legacy = new AnimationComparisonRepository(database).insert(
                projectId, "6001", "6002", "Idle", "Idle Copy", 1.0, 1.0,
                "fingerprint-a", "fingerprint-a", 100, 100, 100, 100, true,
                "{\"verdict\":\"EXACT_CURVE_DATA\"}", "creatorflow.motion-comparison/v1",
                null, null, null, null, null, null);

        JsonNode view = json.readTree(get("/api/v1/motion-comparisons/" + legacy.id(), cookie).body());
        assertEquals("Exact curve data — provenance required", view.get("verdict").asText());
        assertFalse(view.has("sourcePlayback"));
        assertFalse(view.has("candidatePlayback"));
    }

    /**
     * A regression guard on the SHIPPED configuration, not a RED/GREEN pair — it passes both
     * before and after {@code CURVE_SAMPLED_SNAPSHOTS_ALLOWED} exists, because that constant ships
     * {@code true}. Phase C's Task 0 spike measured sampling live in Studio and found it
     * bit-identical, so a CURVE_SAMPLED side is as pinnable as a keyframe one. What this pins is
     * that nobody re-blocks it by accident: flipping the constant to {@code false} turns the first
     * assertion red immediately, which is exactly the conversation that flip deserves.
     */
    @Test
    void animationSnapshotAllowsCurveSampledSidesWhileConfirmedDeterministic() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        String animation = """
                {
                  "assetId":"%s","name":"Walk","duration":1.0,"looped":true,
                  "priority":"Movement","keyframes":[
                    {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        String body = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("9001") + ",\"candidate\":" + animation.formatted("9002")
                + ",\"sourceKind\":\"CURVE_SAMPLED\",\"candidateKind\":\"KEYFRAME\"}";
        String comparisonId = json.readTree(
                pluginRequest("POST", "/plugin/v1/motion-comparisons", token, body).body())
                .get("id").asText();

        HttpResponse<String> pinSource = postJson("/api/v1/projects/" + projectId + "/animation-snapshots", cookie,
                origin.toString(), csrf, "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"source\",\"kind\":\"LAST_KNOWN_GOOD\"}");
        assertEquals(201, pinSource.statusCode(), pinSource.body());

        HttpResponse<String> pinCandidate = postJson("/api/v1/projects/" + projectId + "/animation-snapshots", cookie,
                origin.toString(), csrf, "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"candidate\",\"kind\":\"LAST_KNOWN_GOOD\"}");
        assertEquals(201, pinCandidate.statusCode(), pinCandidate.body());

        // #131: the pin carries the side's provenance onto the snapshot, so the reference says
        // how it was read without a join back to the comparison it came from. Asserted per side
        // off the SAME comparison, which is what catches the mix-up worth catching: one side
        // sampled, one exact, and a bug that copies either onto both.
        assertEquals("CURVE_SAMPLED", json.readTree(pinSource.body()).get("clipKind").asText());
        assertEquals("KEYFRAME", json.readTree(pinCandidate.body()).get("clipKind").asText());

        // And it is on the listing the UI reads, not only on the creation response.
        JsonNode listed = json.readTree(
                get("/api/v1/projects/" + projectId + "/animation-snapshots", cookie).body()).get("items");
        Map<String, String> kindByAsset = new java.util.HashMap<>();
        listed.forEach(item -> kindByAsset.put(item.get("assetId").asText(),
                item.hasNonNull("clipKind") ? item.get("clipKind").asText() : null));
        assertEquals("CURVE_SAMPLED", kindByAsset.get("9001"));
        assertEquals("KEYFRAME", kindByAsset.get("9002"));
    }

    /**
     * Pins WHICH engine the plugin route scores on, and that a mirrored match says so.
     *
     * <p>Issue #102 survived because nothing asserted this. The route called v1 while every browser
     * surface called v2, and the only existing test of it compared two identical animations — a pair
     * both engines score 100, so it could not tell them apart. A silent revert to v1 would have
     * passed the whole suite.
     *
     * <p>The mirrored pair is the sharpest available probe: before this change it was undetectable
     * through this route by construction, so a `true` here cannot be produced by v1 at all.
     */
    @Test
    void pluginRouteScoresOnEngineV2AndNamesAMirroredMatch() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        /*
         * Asymmetric performance on a mirrorable rig, and it must differ in ROTATION, not only in
         * position.
         *
         * A first version of this fixture used identity rotations everywhere. Rotation carries 0.65
         * of v2's pose blend, so two clips with identical rotations score about 90 on the direct
         * comparison alone — which lands in the HIGH band and short-circuits the mirror branch
         * before it runs. The test then failed for the right reason: nothing had been mirrored.
         */
        List<double[]> first = List.of(
                yaw(0.30, 40.0), yaw(0.10, 10.0), yaw(0.20, 25.0), yaw(-0.15, -5.0));
        List<double[]> second = List.of(
                yaw(0.50, 70.0), yaw(0.05, -15.0), yaw(0.35, 50.0), yaw(-0.25, -20.0));
        String source = mirrorableClip("2001", JOINTS, first, second);
        // The same performance reflected. Built by negating the emitted transform rather than by
        // recomputing from a negated angle, so the mirror is bitwise exact and cannot fail on
        // Math.sin(-x) not being exactly -Math.sin(x). The reflection MODEL is graded independently
        // by the parity oracle; what this test exercises is the route, the view and the JSON.
        String mirrored = mirrorableClip("2002", MIRRORED_JOINTS, reflectAll(first), reflectAll(second));

        HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token,
                "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":" + source
                        + ",\"candidate\":" + mirrored + "}");
        assertEquals(201, compared.statusCode(), compared.body());
        JsonNode view = json.readTree(compared.body());
        assertEquals("creatorflow.motion-comparison/v2-web", view.get("algorithmVersion").asText(),
                "the plugin route must score on the same engine the browser does");
        assertTrue(view.get("mirrored").asBoolean(), "a mirrored copy must be reported as mirrored");
        assertFalse(view.get("exactCurveData").asBoolean(),
                "a mirrored pair is not byte-identical, so it must not claim exact curve data");
        assertEquals(100, view.get("overallScore").asInt());

        // A pair sharing no joint names cannot be mirrored, so the flag must come back false —
        // otherwise `mirrored` could be stuck true and the assertion above would prove nothing.
        String unrelated = """
                {"assetId":"2003","name":"Other","duration":1.0,"looped":false,"priority":"Movement","keyframes":[
                  {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                  {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0.4,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                ]}
                """;
        JsonNode plain = json.readTree(pluginRequest("POST", "/plugin/v1/motion-comparisons", token,
                "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":" + source
                        + ",\"candidate\":" + unrelated + "}").body());
        assertFalse(plain.get("mirrored").asBoolean(),
                "a pair with no shared left/right joints cannot be mirrored");
    }

    /** Two mutual left/right pairs, and the same names with the sides swapped. */
    private static final List<String> JOINTS = List.of("ArmL", "ArmR", "LegL", "LegR");
    private static final List<String> MIRRORED_JOINTS = List.of("ArmR", "ArmL", "LegR", "LegL");

    /** Row-major 3x3 yaw inside the 12-component transform, at position x along the mirror axis. */
    private static double[] yaw(double x, double degrees) {
        double angle = Math.toRadians(degrees);
        double cosine = Math.cos(angle);
        double sine = Math.sin(angle);
        return new double[] {x, 0.0, 0.0, cosine, 0.0, sine, 0.0, 1.0, 0.0, -sine, 0.0, cosine};
    }

    /** Reflection across the YZ plane: negate x and the four off-diagonal entries R -> M R M flips. */
    private static List<double[]> reflectAll(List<double[]> transforms) {
        List<double[]> reflected = new ArrayList<>(transforms.size());
        for (double[] transform : transforms) {
            double[] copy = transform.clone();
            for (int index : new int[] {0, 4, 5, 6, 9}) {
                copy[index] = copy[index] == 0.0 ? 0.0 : -copy[index];
            }
            reflected.add(copy);
        }
        return reflected;
    }

    private static String mirrorableClip(
            String assetId, List<String> joints, List<double[]> first, List<double[]> second) {
        StringBuilder body = new StringBuilder();
        body.append("{\"assetId\":\"").append(assetId)
                .append("\",\"name\":\"Mirrorable\",\"duration\":1.0,\"looped\":false,")
                .append("\"priority\":\"Movement\",\"keyframes\":[");
        body.append(keyframeJson(0.0, joints, first)).append(',');
        body.append(keyframeJson(1.0, joints, second));
        body.append("]}");
        return body.toString();
    }

    private static String keyframeJson(double time, List<String> joints, List<double[]> transforms) {
        StringBuilder frame = new StringBuilder("{\"time\":" + time + ",\"poses\":[");
        for (int i = 0; i < joints.size(); i++) {
            if (i > 0) {
                frame.append(',');
            }
            frame.append("{\"jointPath\":\"").append(joints.get(i)).append("\",\"transform\":[");
            double[] transform = transforms.get(i);
            for (int j = 0; j < transform.length; j++) {
                if (j > 0) {
                    frame.append(',');
                }
                frame.append(transform[j]);
            }
            frame.append("],\"weight\":1,\"easingStyle\":\"Linear\",\"easingDirection\":\"InOut\"}");
        }
        return frame.append("]}").toString();
    }

    @Test
    void listsAndRevokesPluginPairingsWithoutExposingTokenOrHash() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        HttpResponse<String> issued = post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf);
        assertEquals(201, issued.statusCode());
        String token = json.readTree(issued.body()).get("token").asText();
        String pairingId = json.readTree(issued.body()).get("id").asText();
        assertTrue(pairingId != null && !pairingId.isBlank());

        assertEquals(401, get("/api/v1/projects/" + projectId + "/plugin-pairings", null).statusCode());

        HttpResponse<String> list = get("/api/v1/projects/" + projectId + "/plugin-pairings", cookie);
        assertEquals(200, list.statusCode());
        JsonNode items = json.readTree(list.body()).get("items");
        assertEquals(1, items.size());
        assertEquals(pairingId, items.get(0).get("id").asText());
        assertEquals("ACTIVE", items.get(0).get("status").asText());
        assertFalse(list.body().contains(token));
        assertFalse(list.body().toLowerCase(java.util.Locale.ROOT).contains("hash"));

        // A pairing id that belongs to a different project (or doesn't exist) must 404, never
        // silently succeed or leak whether the id exists elsewhere.
        long otherProjectId = localProjects.adopt(Files.createDirectories(directory.resolve("other-project")))
                .projectId();
        assertEquals(404, post("/api/v1/projects/" + otherProjectId + "/plugin-pairings/" + pairingId + "/revoke",
                cookie, origin.toString(), csrf).statusCode());
        assertEquals(404, post("/api/v1/projects/" + projectId + "/plugin-pairings/deadbeef-0000-0000-0000-000000000000/revoke",
                cookie, origin.toString(), csrf).statusCode());

        // Revoke is a mutation like any other: same-origin + CSRF required.
        assertEquals(403, post("/api/v1/projects/" + projectId + "/plugin-pairings/" + pairingId + "/revoke",
                cookie, origin.toString(), null).statusCode());

        HttpResponse<String> revoked = post("/api/v1/projects/" + projectId + "/plugin-pairings/" + pairingId + "/revoke",
                cookie, origin.toString(), csrf);
        assertEquals(200, revoked.statusCode());
        JsonNode revokedItems = json.readTree(revoked.body()).get("items");
        assertEquals(1, revokedItems.size());
        assertEquals("REVOKED", revokedItems.get(0).get("status").asText());
        assertFalse(revoked.body().contains(token));

        // The revoked token is now rejected on the pairing-gated plugin route.
        assertEquals(401, pluginRequest("GET", "/plugin/v1/health", token, null).statusCode());
    }

    @Test
    void pluginMayConnectThroughLocalhostAsWellAsLoopbackIp() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        // The plugin and its README advertise http://localhost:<port> as valid,
        // so the server must accept that Host spelling too.
        HttpRequest viaLocalhost = HttpRequest.newBuilder(
                        URI.create("http://localhost:" + origin.getPort() + "/plugin/v1/health"))
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();
        assertEquals(200, client.send(viaLocalhost, HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test
    void promotesAComparisonSideIntoAnImmutableAnimationSnapshot() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
                .get("projectId").asLong();
        String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
                cookie, origin.toString(), csrf).body()).get("token").asText();

        String animation = """
                {
                  "assetId":"%s","name":"%s","duration":1.0,"looped":true,
                  "priority":"Movement","keyframes":[
                    {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                    {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                  ]
                }
                """;
        String body = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                + animation.formatted("1001", "Walk A") + ",\"candidate\":"
                + animation.formatted("1002", "Walk B") + "}";
        String comparisonId = json.readTree(
                        pluginRequest("POST", "/plugin/v1/motion-comparisons", token, body).body())
                .get("id").asText();

        // Snapshot creation is a mutation: it needs session + CSRF like every other one.
        assertEquals(403, postJson("/api/v1/projects/" + projectId + "/animation-snapshots",
                cookie, origin.toString(), null,
                "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"candidate\",\"kind\":\"LAST_PUBLISHED\"}")
                .statusCode());

        HttpResponse<String> promoted = postJson("/api/v1/projects/" + projectId + "/animation-snapshots",
                cookie, origin.toString(), csrf,
                "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"candidate\",\"kind\":\"last_published\"}");
        assertEquals(201, promoted.statusCode(), promoted.body());
        assertEquals("1002", json.readTree(promoted.body()).get("assetId").asText());
        assertEquals("FIRST_SNAPSHOT", json.readTree(promoted.body()).get("status").asText());
        assertEquals(comparisonId, json.readTree(promoted.body()).get("sourceComparisonId").asText());

        // Re-promoting the same, unchanged candidate supersedes and reports UNCHANGED.
        HttpResponse<String> again = postJson("/api/v1/projects/" + projectId + "/animation-snapshots",
                cookie, origin.toString(), csrf,
                "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"candidate\",\"kind\":\"LAST_PUBLISHED\"}");
        assertEquals(201, again.statusCode());
        assertEquals("UNCHANGED", json.readTree(again.body()).get("status").asText());

        // The current-snapshots view keeps one row per asset+kind, and reading needs a session.
        HttpResponse<String> list = get("/api/v1/projects/" + projectId + "/animation-snapshots", cookie);
        assertEquals(200, list.statusCode());
        assertEquals(1, json.readTree(list.body()).get("items").size());
        assertEquals(401, get("/api/v1/projects/" + projectId + "/animation-snapshots", null).statusCode());

        // An unknown kind is rejected as a bad request, not a server error.
        assertEquals(400, postJson("/api/v1/projects/" + projectId + "/animation-snapshots",
                cookie, origin.toString(), csrf,
                "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"candidate\",\"kind\":\"whenever\"}")
                .statusCode());
    }

    @Test
    void verifyOwnershipGatesOnKeyAndCsrfThenPersistsAndListsHistory() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long assetId = seedBoundAsset(90110L);
        String verify = "/api/v1/assets/" + assetId + "/verify-ownership";
        String history = "/api/v1/assets/" + assetId + "/ownership-verifications";

        // A mutation: without CSRF it is 403 before any key or body is even considered.
        assertEquals(403, postJson(verify, cookie, origin.toString(), null,
                "{\"robloxAssetId\":507766388}").statusCode());

        // No Open Cloud key configured -> 409; the single live-call site refuses to invent a result.
        HttpResponse<String> noKey = postJson(verify, cookie, origin.toString(), csrf,
                "{\"robloxAssetId\":507766388}");
        assertEquals(409, noKey.statusCode(), noKey.body());

        openCloudSettings.save("oc-test-key-abc123");

        // Key present but no animation id in the body -> a 404 precondition, not a crash.
        assertEquals(404, postJson(verify, cookie, origin.toString(), csrf, "{}").statusCode());

        // A MATCH from the fake verifier is persisted and echoed back as the stored view.
        fakeVerifier.set((robloxAssetId, universeId, now) -> new OwnershipEvidence(robloxAssetId,
                OwnershipEvidence.TYPE_USER, 42L, "Animation", "Approved",
                OwnershipEvidence.TYPE_USER, 42L, null, OwnershipOutcome.MATCH, now));
        HttpResponse<String> verified = postJson(verify, cookie, origin.toString(), csrf,
                "{\"robloxAssetId\":507766388}");
        assertEquals(201, verified.statusCode(), verified.body());
        JsonNode view = json.readTree(verified.body());
        assertEquals("MATCH", view.get("outcome").asText());
        assertTrue(view.get("verified").asBoolean());
        assertEquals(507766388L, view.get("robloxAssetId").asLong());
        assertEquals(90110L, view.get("universeId").asLong());
        assertEquals("USER", view.get("creatorType").asText());
        assertEquals(42L, view.get("ownerId").asLong());
        assertFalse(view.get("checkedAt").isNull());
        // The id came out of the request body — a person typed it. The view says so, so the UI can
        // render the file-to-animation link as DECLARED instead of implying CreatorFlow found it.
        assertEquals("DECLARED_BY_USER", view.get("assetIdSource").asText());
        // The API key and the raw upstream body must never appear in a rendered view.
        assertFalse(verified.body().contains("oc-test-key-abc123"));
        assertFalse(verified.body().toLowerCase(java.util.Locale.ROOT).contains("rawresponse"));

        HttpResponse<String> firstHistory = get(history, cookie);
        assertEquals(200, firstHistory.statusCode());
        assertEquals(1, json.readTree(firstHistory.body()).get("items").size());

        // A second verification appends; the newest observation is listed first.
        fakeVerifier.set((robloxAssetId, universeId, now) -> new OwnershipEvidence(robloxAssetId,
                OwnershipEvidence.TYPE_USER, 42L, "Animation", "Approved",
                OwnershipEvidence.TYPE_GROUP, 99L, null, OwnershipOutcome.MISMATCH, now));
        assertEquals(201, postJson(verify, cookie, origin.toString(), csrf,
                "{\"robloxAssetId\":507766388}").statusCode());

        HttpResponse<String> listed = get(history, cookie);
        assertEquals(200, listed.statusCode());
        JsonNode items = json.readTree(listed.body()).get("items");
        assertEquals(2, items.size());
        assertEquals("MISMATCH", items.get(0).get("outcome").asText());
        assertEquals("MATCH", items.get(1).get("outcome").asText());
        assertFalse(listed.body().contains("oc-test-key-abc123"));
        // Reading history still needs a session.
        assertEquals(401, get(history, null).statusCode());
    }

    @Test
    void sessionReportsWhetherAnOpenCloudKeyIsConfiguredAndNeverTheKeyItself() throws Exception {
        ObjectMapper json = new ObjectMapper();

        // Before a key is saved the session says so plainly, so the workspace can disable the verify
        // action with an honest reason instead of only failing after the click.
        HttpResponse<String> before = get("/api/v1/session", cookie);
        assertEquals(200, before.statusCode());
        assertFalse(json.readTree(before.body()).get("openCloudKeyConfigured").asBoolean());

        openCloudSettings.save("oc-test-key-abc123");

        HttpResponse<String> after = get("/api/v1/session", cookie);
        assertEquals(200, after.statusCode());
        assertTrue(json.readTree(after.body()).get("openCloudKeyConfigured").asBoolean());
        // A boolean only: neither the key nor any prefix or masked form of it crosses the bridge.
        assertFalse(after.body().contains("oc-test-key-abc123"));
        assertFalse(after.body().contains("oc-test-key"));
        assertFalse(after.body().toLowerCase(java.util.Locale.ROOT).contains("apikey"));

        // And the status is still session-guarded like every other bridge read.
        assertEquals(401, get("/api/v1/session", null).statusCode());
    }

    @Test
    void verifyOwnershipReturns404WhenTheExperienceIsUnbound() throws Exception {
        long assetId = seedUnboundAsset();
        openCloudSettings.save("oc-test-key-abc123");
        HttpResponse<String> unbound = postJson("/api/v1/assets/" + assetId + "/verify-ownership",
                cookie, origin.toString(), csrf, "{\"robloxAssetId\":507766388}");
        assertEquals(404, unbound.statusCode(), unbound.body());
        assertTrue(unbound.body().contains("bound experience"));
    }

    @Test
    void verifyOwnershipSurfacesRateLimitAsADistinct429() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long assetId = seedBoundAsset(90110L);
        openCloudSettings.save("oc-test-key-abc123");
        fakeVerifier.set((robloxAssetId, universeId, now) -> {
            throw new RateLimitedException("slow down", Duration.ofSeconds(30));
        });

        HttpResponse<String> limited = postJson("/api/v1/assets/" + assetId + "/verify-ownership",
                cookie, origin.toString(), csrf, "{\"robloxAssetId\":507766388}");
        assertEquals(429, limited.statusCode(), limited.body());
        assertEquals(30, json.readTree(limited.body()).get("retryAfterSeconds").asInt());

        // A rate limit is transient: nothing is persisted, so no false record lingers.
        HttpResponse<String> history = get(
                "/api/v1/assets/" + assetId + "/ownership-verifications", cookie);
        assertEquals(0, json.readTree(history.body()).get("items").size());
    }

    /**
     * Roblox is not obliged to send a {@code Retry-After}, and the spike note records that a 429 was
     * never provoked live. With no hint the route must still be a plain 429 with its message — and
     * must omit {@code retryAfterSeconds} entirely rather than emit a zero, which the UI would render
     * as "try again in 0 seconds": a wait CreatorFlow was never told.
     */
    @Test
    void verifyOwnershipSurfaces429WithNoRetryHintWhenRobloxSendsNone() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long assetId = seedBoundAsset(90110L);
        openCloudSettings.save("oc-test-key-abc123");
        fakeVerifier.set((robloxAssetId, universeId, now) -> {
            throw new RateLimitedException("slow down", null);
        });

        HttpResponse<String> limited = postJson("/api/v1/assets/" + assetId + "/verify-ownership",
                cookie, origin.toString(), csrf, "{\"robloxAssetId\":507766388}");

        assertEquals(429, limited.statusCode(), limited.body());
        JsonNode body = json.readTree(limited.body());
        assertFalse(body.has("retryAfterSeconds"),
                "with no Retry-After header the response must carry no invented wait");
        assertTrue(body.get("error").asText().contains("rate-limiting"), limited.body());

        // Still transient: an unhinted rate limit persists nothing either.
        HttpResponse<String> history = get(
                "/api/v1/assets/" + assetId + "/ownership-verifications", cookie);
        assertEquals(0, json.readTree(history.body()).get("items").size());
    }

    /**
     * The gate-preview route: the same evaluation a release performs, with none of the persistence.
     *
     * <p>What it has to prove is not that a gate report can be serialised — {@code ReleaseGate} is
     * already covered — but that asking for one leaves the ledger exactly as it found it. Today the
     * only way to re-check a BLOCKED release is to build another one, and every throwaway build
     * inserts an immutable row that becomes the next real release's diff baseline.
     */
    @Test
    void gatePreviewEvaluatesTheGateAndCreatesNothing() throws Exception {
        ObjectMapper json = new ObjectMapper();
        long assetId = seedBoundAsset(90110L);
        long projectId = json.readTree(get("/api/v1/projects", cookie).body())
                .get("items").get(0).get("projectId").asLong();
        String path = "/api/v1/projects/" + projectId + "/gate-preview";

        // Session-guarded like every other read, and a GET — a POST here is the wrong shape.
        assertEquals(401, get(path, null).statusCode());
        assertEquals(405, post(path, cookie, origin.toString(), csrf).statusCode());

        HttpResponse<String> previewed = get(path, cookie);
        assertEquals(200, previewed.statusCode(), previewed.body());
        JsonNode body = json.readTree(previewed.body());
        assertFalse(body.get("passed").asBoolean());
        assertEquals(1, body.get("summary").get("violations").asInt());
        assertEquals(1, body.get("summary").get("unresolvedAssets").asInt());
        assertFalse(body.get("evaluatedAt").isNull());

        JsonNode violation = body.get("violations").get(0);
        assertEquals("UNRESOLVED_SOURCE", violation.get("code").asText());
        assertEquals("art/walk.rbxm", violation.get("path").asText());
        assertEquals("PENDING", violation.get("decision").asText());
        // The one field this route adds, and the whole reason it exists rather than the workspace
        // parsing the downloadable report: the gate speaks in manifest paths, every decision
        // affordance in the workspace is keyed by this numeric id, and the assets list is paged.
        assertEquals(assetId, violation.get("scanAssetId").asLong());

        // Repeated checks stay free of side effects: no release row appears, however many are run.
        for (int attempt = 0; attempt < 3; attempt++) {
            assertEquals(200, get(path, cookie).statusCode());
        }
        assertEquals(0, json.readTree(get("/api/v1/projects/" + projectId + "/releases", cookie).body())
                .get("items").size());
    }

    @Test
    void gatePreviewRefusesWhatItCannotHonestlyEvaluate() throws Exception {
        assertEquals(404, get("/api/v1/projects/9999999/gate-preview", cookie).statusCode());

        long emptyProjectId = localProjects.adopt(
                Files.createDirectories(directory.resolve("gate-preview-no-scan"))).projectId();
        HttpResponse<String> noRun = get("/api/v1/projects/" + emptyProjectId + "/gate-preview", cookie);
        assertEquals(409, noRun.statusCode(), noRun.body());
        assertTrue(noRun.body().contains("no scan to release"), noRun.body());

        // A run that is still going is not an immutable snapshot, so there is nothing honest to
        // check against — the same precondition the releases POST enforces, with the same message.
        var running = scans.create(emptyProjectId, directory, "1.0.0", List.of(), List.of("png"));
        scans.markStarted(running.id());
        HttpResponse<String> incomplete = get(
                "/api/v1/projects/" + emptyProjectId + "/gate-preview?scanRunId=" + running.id(), cookie);
        assertEquals(409, incomplete.statusCode(), incomplete.body());
        assertTrue(incomplete.body().contains("completed immutable scan"), incomplete.body());

        assertEquals(404, get("/api/v1/projects/" + emptyProjectId
                + "/gate-preview?scanRunId=00000000-0000-0000-0000-000000000000", cookie).statusCode());
    }

    /**
     * The panel's groups are the gate's own violations, and this is the test that keeps them that way.
     *
     * <p>The oracle is deliberately not another call through the same service: the release's manifest
     * bytes are downloaded and fed to a plain {@code new ReleaseGate().evaluate(...)}, so if the
     * route ever started filtering, re-ordering or re-deriving what is outstanding, the two would
     * disagree here. A group review that offers to fix a set of files the gate does not agree about
     * is a lie about what the action accomplishes, which is why this is the first test.
     */
    @Test
    void reviewGroupsAreExactlyWhatADirectGateEvaluationFinds() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(4, 2);

        JsonNode groups = json.readTree(reviewGroups(seeded.runId()).body());
        assertEquals("BLOCKED", groups.get("gateResult").asText());

        HttpResponse<String> release = postJson("/api/v1/projects/" + seeded.projectId() + "/releases",
                cookie, origin.toString(), csrf, "{\"release\":\"oracle\"}");
        assertEquals(201, release.statusCode(), release.body());
        String releaseId = json.readTree(release.body()).get("id").asText();
        CreativeManifest manifest = new ManifestJson().read(
                get("/api/v1/releases/" + releaseId + "/manifest", cookie).body());

        Map<String, List<String>> expected = new LinkedHashMap<>();
        for (ReleaseGate.Violation violation : new ReleaseGate().evaluate(manifest).violations()) {
            expected.computeIfAbsent(violation.code().name(), key -> new ArrayList<>()).add(violation.path());
        }
        Map<String, List<String>> actual = new LinkedHashMap<>();
        for (JsonNode group : groups.get("groups")) {
            List<String> paths = new ArrayList<>();
            group.get("assets").forEach(asset -> paths.add(asset.get("relativePath").asText()));
            actual.put(group.get("code").asText(), paths);
        }
        expected.values().forEach(Collections::sort);
        actual.values().forEach(Collections::sort);
        assertEquals(expected, actual, "the groups must be the gate's violations, not a second opinion");
    }

    /**
     * The allow-list, enforced on the write rather than only left out of the UI.
     *
     * <p>A disabled control is bypassable — a stale tab, a hand-rolled request — so bulk APPROVE is
     * refused here regardless of what any client did or did not render. Bulk approving thirty flagged
     * files is the exact false-clearance this product exists not to manufacture.
     */
    @Test
    void batchDecisionsRefuseApprovedAndBlockedInEveryGroup() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(3, 2);
        List<Long> ids = seeded.assetIds();

        for (String type : List.of("APPROVED", "BLOCKED")) {
            for (String code : List.of("UNRESOLVED_SOURCE", "FLAGGED_WITHOUT_APPROVAL")) {
                HttpResponse<String> refused = batchDecision(seeded.runId(), code, type,
                        "Looks fine to me.", ids.subList(1, 3), null);
                assertEquals(400, refused.statusCode(), refused.body());
                assertTrue(json.readTree(refused.body()).get("error").asText()
                        .contains("per-file decisions"), refused.body());
            }
        }
        assertEquals(0, decisionCount(ids), "a refused batch must write nothing");
    }

    /**
     * Excluding is a scope claim ("these are not in this release"), which can honestly be true of a
     * folder at once — but only where the standing problem is a missing source record. On a flagged
     * or ownership-lead group it is the closest thing available to making findings go away in one
     * click, so it is refused there, server-side, and the group advertises that by listing only
     * NEEDS_REVIEW.
     */
    @Test
    void excludingIsBatchableOnlyWhereTheStandingProblemIsAMissingSourceRecord() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(4, 2);
        JsonNode groups = json.readTree(reviewGroups(seeded.runId()).body()).get("groups");

        Map<String, List<String>> advertised = new LinkedHashMap<>();
        for (JsonNode group : groups) {
            List<String> actions = new ArrayList<>();
            group.get("batchableActions").forEach(action -> actions.add(action.asText()));
            advertised.put(group.get("code").asText(), actions);
        }
        assertEquals(List.of("SOURCE_EVIDENCE", "EXCLUDED", "NEEDS_REVIEW"),
                advertised.get("UNRESOLVED_SOURCE"));
        assertEquals(List.of("NEEDS_REVIEW"), advertised.get("FLAGGED_WITHOUT_APPROVAL"));

        List<Long> flagged = groupAssetIds(groups, "FLAGGED_WITHOUT_APPROVAL");
        HttpResponse<String> refused = batchDecision(seeded.runId(), "FLAGGED_WITHOUT_APPROVAL",
                "EXCLUDED", "Not shipping these in 2.4.", flagged, null);
        assertEquals(400, refused.statusCode(), refused.body());
        assertTrue(json.readTree(refused.body()).get("error").asText().contains("cannot be batched"),
                refused.body());

        // The same action, on the group where it is an honest scope claim, is accepted — for the
        // files standing under that rule alone. seedGroupRun flags the LAST two, so 0 and 1 are not.
        HttpResponse<String> accepted = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "EXCLUDED",
                "WIP concepts under art/ — not shipping in 2.4.", seeded.assetIds().subList(0, 2), null);
        assertEquals(201, accepted.statusCode(), accepted.body());
    }

    /**
     * The guarantee the group scope actually rests on, and the one this feature got wrong first.
     *
     * <p>{@code ReleaseGate.evaluate} skips an {@code EXCLUDED} asset at {@code ReleaseGate.java:44},
     * <em>before</em> the flagged check and before the ownership check — so exclusion settles an
     * asset, not a violation. Batch-excluding a file from the unresolved-source group to settle its
     * missing source record would therefore silence its similarity flag in the same click, and the
     * group label would be saying one thing while the gate did another. Refusing per file is what
     * makes "excluding is only offered where the standing problem is a missing source record" a
     * mechanism rather than a claim.
     */
    @Test
    void aFileStandingUnderTwoRulesCannotBeBatchExcludedFromEitherOfThem() throws Exception {
        ObjectMapper json = new ObjectMapper();
        // Two SIMILAR files with no source record: each stands under UNRESOLVED_SOURCE *and*
        // FLAGGED_WITHOUT_APPROVAL, which is the ordinary shape of a re-scanned variant.
        SeededRun seeded = seedGroupRun(2, 2);
        JsonNode groups = json.readTree(reviewGroups(seeded.runId()).body()).get("groups");
        List<Long> both = groupAssetIds(groups, "UNRESOLVED_SOURCE");
        assertEquals(2, both.size(), groups.toString());

        // The group says so out loud, per row, so the panel can withhold the control with a reason.
        for (JsonNode group : groups) {
            if (!group.get("code").asText().equals("UNRESOLVED_SOURCE")) continue;
            for (JsonNode asset : group.get("assets")) {
                assertEquals(1, asset.get("alsoStandingCodes").size(), asset.toString());
                assertEquals("FLAGGED_WITHOUT_APPROVAL", asset.get("alsoStandingCodes").get(0).asText());
            }
        }

        int flaggedBefore = gateSummary(seeded.projectId()).get("flaggedWithoutApproval").asInt();
        assertEquals(2, flaggedBefore);

        HttpResponse<String> refused = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "EXCLUDED",
                "Clearing out the re-scan pile.", both, null);
        assertEquals(400, refused.statusCode(), refused.body());
        assertTrue(json.readTree(refused.body()).get("error").asText()
                .contains("skips every other check"), refused.body());

        // Nothing written, and — the part that matters — the similarity flags are still standing.
        assertEquals(0, decisionCount(both));
        assertTrue(decisionBatches.forRun(seeded.runId()).isEmpty());
        assertEquals(flaggedBefore, gateSummary(seeded.projectId()).get("flaggedWithoutApproval").asInt(),
                "a refused batch exclusion must not have silenced a flag");

        // Needs-review over exactly the same files is still offered: it clears nothing at the gate,
        // so it cannot silence anything, and labelling the queue is the honest bulk action here.
        HttpResponse<String> triaged = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "Scheduling a review of the re-scan pile with Marco.", both, null);
        assertEquals(201, triaged.statusCode(), triaged.body());
        assertEquals(2, gateSummary(seeded.projectId()).get("flaggedWithoutApproval").asInt(),
                "needs review must clear nothing at the gate");
    }

    /** The live gate summary, read without persisting a release. */
    private JsonNode gateSummary(long projectId) throws Exception {
        return new ObjectMapper().readTree(
                get("/api/v1/projects/" + projectId + "/gate-preview", cookie).body()).get("summary");
    }

    /**
     * The group is re-derived on the server, so a request cannot smuggle an asset into a group by
     * labelling it. Without this the group name would be a claim the client makes about ids it
     * chose, rather than something the gate said.
     */
    @Test
    void aBatchRejectsAnAssetThatIsNotStandingInThatGroup() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(4, 2);
        JsonNode groups = json.readTree(reviewGroups(seeded.runId()).body()).get("groups");
        List<Long> flagged = groupAssetIds(groups, "FLAGGED_WITHOUT_APPROVAL");
        List<Long> notFlagged = new ArrayList<>(seeded.assetIds());
        notFlagged.removeAll(flagged);

        List<Long> smuggled = List.of(flagged.getFirst(), notFlagged.getFirst());
        HttpResponse<String> refused = batchDecision(seeded.runId(), "FLAGGED_WITHOUT_APPROVAL",
                "NEEDS_REVIEW", "Scheduling a review for these.", smuggled, null);
        assertEquals(400, refused.statusCode(), refused.body());
        assertTrue(json.readTree(refused.body()).get("error").asText()
                .contains("not standing under that rule"), refused.body());
        assertEquals(0, decisionCount(seeded.assetIds()), "a refused batch must write nothing");
    }

    /**
     * Drift: something moved between loading the group and submitting it.
     *
     * <p>{@code DecisionRepository.append} performs no such check itself — two appends without a
     * supersede id race silently and {@code latestFor} simply picks the later one — so the check has
     * to be here, and it has to reject the <em>whole</em> batch. A partly applied batch would leave
     * files carrying a judgement nobody's screen ever showed.
     */
    @Test
    void aDriftedBatchIsRejectedWholeAndWritesNothing() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(3, 0);
        List<Long> ids = seeded.assetIds();

        // Loaded with no decisions on record, then one asset is decided per-file in another tab.
        long moved = ids.get(1);
        assertEquals(201, postJson("/api/v1/assets/" + moved + "/decisions", cookie, origin.toString(),
                csrf, "{\"type\":\"NEEDS_REVIEW\",\"reason\":\"Someone else got here first\"}")
                .statusCode());

        HttpResponse<String> stale = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "Scheduling a review with Marco on Thursday.", ids, null);
        assertEquals(409, stale.statusCode(), stale.body());
        JsonNode body = json.readTree(stale.body());
        assertEquals(1, body.get("driftedAssetIds").size(), stale.body());
        assertEquals(moved, body.get("driftedAssetIds").get(0).asLong());
        assertTrue(body.get("error").asText().contains("nothing was recorded"), stale.body());

        // Exactly the one per-file decision from above survives; the batch wrote none of its own.
        assertEquals(1, decisionCount(ids));
        assertTrue(decisionBatches.forRun(seeded.runId()).isEmpty(), "no batch row may be left behind");
    }

    /**
     * Two is the floor because one file is a per-file decision, and 200 is the ceiling because the
     * point of a reviewed set is that a person can still look at it. Neither is a byte limit;
     * {@code MAX_REQUEST_BYTES} is far away from both.
     */
    @Test
    void aBatchNeedsAtLeastTwoFilesAndAtMostTwoHundredAndAlwaysAReason() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(3, 0);
        List<Long> ids = seeded.assetIds();

        HttpResponse<String> single = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "Just this one.", ids.subList(0, 1), null);
        assertEquals(400, single.statusCode(), single.body());
        assertTrue(json.readTree(single.body()).get("error").asText().contains("per-file decision"),
                single.body());

        List<Long> tooMany = new ArrayList<>();
        for (long index = 1; index <= BatchDecisionService.MAX_BATCH_ASSETS + 1; index++) tooMany.add(index);
        HttpResponse<String> over = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "Everything at once.", tooMany, null);
        assertEquals(400, over.statusCode(), over.body());
        assertTrue(json.readTree(over.body()).get("error").asText().contains("capped at 200"), over.body());

        HttpResponse<String> blank = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "   ", ids, null);
        assertEquals(400, blank.statusCode(), blank.body());

        assertEquals(0, decisionCount(ids));
    }

    /**
     * The shape of the record: one batch row, and one ordinary decision row per asset carrying its
     * id. Never one row covering N assets — that would break {@code latestFor}/{@code latestForRun}
     * and, worse, would make "one judgement" and "one record" the same thing.
     */
    @Test
    void everyBatchedAssetKeepsItsOwnRowAndTheyShareOneBatchId() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(3, 0);
        List<Long> ids = seeded.assetIds();
        String rationale = "All three are placeholder concepts from the 2.4 planning doc.";

        HttpResponse<String> recorded = batchDecision(seeded.runId(), "UNRESOLVED_SOURCE",
                "NEEDS_REVIEW", rationale, ids, null);
        assertEquals(201, recorded.statusCode(), recorded.body());
        JsonNode body = json.readTree(recorded.body());
        String batchId = body.get("batchId").asText();
        assertEquals(3, body.get("assetCount").asInt());
        assertEquals(3, body.get("decisions").size());

        Set<String> decisionIds = new java.util.HashSet<>();
        for (JsonNode decision : body.get("decisions")) {
            decisionIds.add(decision.get("id").asText());
            assertEquals(batchId, decision.get("batchId").asText());
        }
        assertEquals(3, decisionIds.size(), "each asset gets its own decision row, never a shared one");

        for (long assetId : ids) {
            JsonNode history = json.readTree(
                    get("/api/v1/assets/" + assetId + "/decisions", cookie).body()).get("items");
            assertEquals(1, history.size());
            assertEquals(batchId, history.get(0).get("batchId").asText());
            assertEquals(rationale, history.get(0).get("reason").asText(),
                    "the shared rationale is recorded verbatim, not decorated");
            // The disclosure the inspector renders: this judgement was one of three made at once.
            assertEquals(3, history.get(0).get("batchAssetCount").asInt());
            assertEquals(batchId, json.readTree(get("/api/v1/assets/" + assetId, cookie).body())
                    .get("latestDecision").get("batchId").asText());
        }

        // And a decision made one file at a time still reads as exactly that.
        long single = ids.getFirst();
        String supersedes = json.readTree(get("/api/v1/assets/" + single + "/decisions", cookie).body())
                .get("items").get(0).get("id").asText();
        JsonNode perFile = json.readTree(postJson("/api/v1/assets/" + single + "/decisions", cookie,
                origin.toString(), csrf, "{\"type\":\"APPROVED\",\"reason\":\"Checked this one on its"
                        + " own\",\"supersedesDecisionId\":\"" + supersedes + "\"}").body());
        assertTrue(perFile.get("batchId").isNull(), perFile.toString());
        assertTrue(perFile.get("batchAssetCount").isNull(), perFile.toString());

        var batch = decisionBatches.findById(batchId).orElseThrow();
        assertEquals(3, batch.assetCount());
        assertEquals("UNRESOLVED_SOURCE", batch.groupCode());
        assertEquals("NEEDS_REVIEW", batch.action());
        assertEquals(rationale, batch.rationale());
    }

    /**
     * The shared source declaration: the one batch that can actually clear {@code UNRESOLVED_SOURCE}.
     * Its drift token is the evidence row rather than a decision, because {@code source_evidence} has
     * no supersedes column and "newest wins" would otherwise silently clobber someone else's record.
     */
    @Test
    void aSharedSourceDeclarationLandsPerAssetAndRefusesAStaleEvidenceRow() throws Exception {
        ObjectMapper json = new ObjectMapper();
        SeededRun seeded = seedGroupRun(3, 0);
        List<Long> ids = seeded.assetIds();
        Map<Long, Long> loaded = latestEvidenceIds(seeded.runId());

        // A blank license is not a declaration the gate can read, so it is refused rather than stored.
        assertEquals(400, batchSourceEvidence(seeded.runId(), "Poly Haven", null,
                "All from the same kit.", loaded).statusCode());

        // Somebody records a different source on one of them meanwhile — still unresolved, so the
        // file stays in the group, but the evidence row the panel was looking at is no longer current.
        long moved = ids.get(1);
        assertEquals(201, postJson("/api/v1/assets/" + moved + "/source-evidence", cookie,
                origin.toString(), csrf, "{\"source\":\"Someone else got here first\"}").statusCode());

        HttpResponse<String> stale = batchSourceEvidence(seeded.runId(), "Poly Haven", "CC0 1.0",
                "All three are from the Poly Haven rock kit downloaded 2026-06-14.", loaded);
        assertEquals(409, stale.statusCode(), stale.body());
        JsonNode drift = json.readTree(stale.body());
        assertEquals(1, drift.get("driftedAssetIds").size(), stale.body());
        assertEquals(moved, drift.get("driftedAssetIds").get(0).asLong());
        assertEquals(1, json.readTree(get("/api/v1/assets/" + ids.getFirst() + "/source-evidence", cookie)
                .body()).get("items").size(), "the rejected batch must have written nothing at all");
        assertTrue(decisionBatches.forRun(seeded.runId()).isEmpty(), "no batch row may be left behind");

        // Reloaded, the same declaration lands — one row per asset, all carrying one batch id.
        HttpResponse<String> recorded = batchSourceEvidence(seeded.runId(), "Poly Haven", "CC0 1.0",
                "All three are from the Poly Haven rock kit downloaded 2026-06-14.",
                latestEvidenceIds(seeded.runId()));
        assertEquals(201, recorded.statusCode(), recorded.body());
        JsonNode body = json.readTree(recorded.body());
        String batchId = body.get("batchId").asText();
        assertEquals(3, body.get("sourceEvidence").size());
        Set<Long> evidenceRowIds = new java.util.HashSet<>();
        for (JsonNode evidence : body.get("sourceEvidence")) {
            evidenceRowIds.add(evidence.get("id").asLong());
            assertEquals(batchId, evidence.get("batchId").asText());
            assertTrue(evidence.get("resolved").asBoolean(), recorded.body());
        }
        assertEquals(3, evidenceRowIds.size(), "each asset gets its own evidence row");

        // And the declaration is what actually clears the rule: the group is gone.
        JsonNode after = json.readTree(reviewGroups(seeded.runId()).body());
        assertEquals("PASS", after.get("gateResult").asText(), after.toString());
        assertEquals(0, after.get("groups").size(), after.toString());
    }

    /** Each asset in the UNRESOLVED_SOURCE group with the evidence row the panel would have loaded. */
    private Map<Long, Long> latestEvidenceIds(String runId) throws Exception {
        Map<Long, Long> evidenceIds = new LinkedHashMap<>();
        JsonNode groups = new ObjectMapper().readTree(reviewGroups(runId).body()).get("groups");
        for (JsonNode group : groups) {
            if (!group.get("code").asText().equals("UNRESOLVED_SOURCE")) continue;
            for (JsonNode asset : group.get("assets")) {
                JsonNode evidenceId = asset.get("latestSourceEvidenceId");
                evidenceIds.put(asset.get("scanAssetId").asLong(),
                        evidenceId.isNull() ? null : evidenceId.asLong());
            }
        }
        return evidenceIds;
    }

    /** A run that is not a completed immutable snapshot has no honest group to review. */
    @Test
    void theBatchRoutesRefuseWhatTheyCannotHonestlyEvaluate() throws Exception {
        assertEquals(404, get("/api/v1/scan-runs/00000000-0000-0000-0000-000000000000/review-groups",
                cookie).statusCode());

        long projectId = localProjects.adopt(
                Files.createDirectories(directory.resolve("batch-no-scan"))).projectId();
        var running = scans.create(projectId, directory, "1.0.0", List.of(), List.of("png"));
        scans.markStarted(running.id());

        HttpResponse<String> groups = reviewGroups(running.id());
        assertEquals(409, groups.statusCode(), groups.body());
        assertTrue(groups.body().contains("completed immutable scan"), groups.body());

        HttpResponse<String> batched = batchDecision(running.id(), "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "Nothing to see here.", List.of(1L, 2L), null);
        assertEquals(409, batched.statusCode(), batched.body());

        // Session- and CSRF-guarded exactly like every other read and write on this bridge.
        SeededRun seeded = seedGroupRun(2, 0);
        assertEquals(401, get("/api/v1/scan-runs/" + seeded.runId() + "/review-groups", null).statusCode());
        assertEquals(405, post("/api/v1/scan-runs/" + seeded.runId() + "/review-groups", cookie,
                origin.toString(), csrf).statusCode());
        assertEquals(403, postJson("/api/v1/scan-runs/" + seeded.runId() + "/batch-decisions", cookie,
                origin.toString(), null, "{}").statusCode());
    }

    private HttpResponse<String> reviewGroups(String runId) throws Exception {
        return get("/api/v1/scan-runs/" + runId + "/review-groups", cookie);
    }

    private HttpResponse<String> batchDecision(String runId, String code, String type, String rationale,
                                               List<Long> assetIds, String supersedesDecisionId)
            throws Exception {
        StringBuilder assets = new StringBuilder("[");
        for (int index = 0; index < assetIds.size(); index++) {
            if (index > 0) assets.append(',');
            assets.append("{\"scanAssetId\":").append(assetIds.get(index));
            if (supersedesDecisionId != null) {
                assets.append(",\"supersedesDecisionId\":\"").append(supersedesDecisionId).append('"');
            }
            assets.append('}');
        }
        assets.append(']');
        String body = "{\"code\":\"" + code + "\",\"type\":\"" + type + "\",\"rationale\":\""
                + rationale + "\",\"assets\":" + assets + "}";
        return postJson("/api/v1/scan-runs/" + runId + "/batch-decisions", cookie, origin.toString(),
                csrf, body);
    }

    private HttpResponse<String> batchSourceEvidence(String runId, String source, String license,
                                                     String rationale, Map<Long, Long> evidenceIds)
            throws Exception {
        StringBuilder assets = new StringBuilder("[");
        boolean first = true;
        for (Map.Entry<Long, Long> entry : evidenceIds.entrySet()) {
            if (!first) assets.append(',');
            first = false;
            assets.append("{\"scanAssetId\":").append(entry.getKey())
                    .append(",\"latestSourceEvidenceId\":")
                    .append(entry.getValue() == null ? "null" : entry.getValue()).append('}');
        }
        assets.append(']');
        String body = "{\"code\":\"UNRESOLVED_SOURCE\",\"source\":"
                + (source == null ? "null" : "\"" + source + "\"") + ",\"license\":"
                + (license == null ? "null" : "\"" + license + "\"") + ",\"rationale\":\""
                + rationale + "\",\"assets\":" + assets + "}";
        return postJson("/api/v1/scan-runs/" + runId + "/batch-source-evidence", cookie,
                origin.toString(), csrf, body);
    }

    private static List<Long> groupAssetIds(JsonNode groups, String code) {
        List<Long> ids = new ArrayList<>();
        for (JsonNode group : groups) {
            if (!group.get("code").asText().equals(code)) continue;
            group.get("assets").forEach(asset -> ids.add(asset.get("scanAssetId").asLong()));
        }
        return ids;
    }

    private int decisionCount(List<Long> assetIds) {
        return assetIds.stream().mapToInt(assetId -> decisions.historyFor(assetId).size()).sum();
    }

    private record SeededRun(long projectId, String runId, List<Long> assetIds) { }

    /**
     * A completed run of {@code count} assets, none carrying source evidence — so every one of them
     * stands under {@code UNRESOLVED_SOURCE} — of which the last {@code similar} are SIMILAR, so
     * they additionally stand under {@code FLAGGED_WITHOUT_APPROVAL}. One asset legitimately standing
     * in two groups is the normal case, not an edge one.
     */
    private SeededRun seedGroupRun(int count, int similar) {
        long projectId = localProjects.adopt(directory).projectId();
        var run = scans.create(projectId, directory, "1.0.0", List.of("node_modules"), List.of("rbxm"));
        scans.markStarted(run.id());
        List<AssetEntry> assets = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            boolean flagged = index >= count - similar;
            assets.add(new AssetEntry("art/asset-" + index + ".rbxm", "asset-" + index + ".rbxm",
                    "rbxm", 128, String.format("%064x", index + 1), 64, 64,
                    new Fingerprints("01", "02", null),
                    flagged ? VerificationStatus.SIMILAR : VerificationStatus.CLEAR,
                    new SourceEvidence(null, null, null), ReleaseDecision.PENDING, List.of(), List.of()));
        }
        CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("proj", "1.0.0"), Instant.now(),
                new CreativeManifest.Summary(count, count - similar, similar, 0, count, count), assets);
        scans.complete(run.id(), manifest, new ScanAccounting(count, 0, 0, 0, 0, 0, 128L * count), List.of());
        return new SeededRun(projectId, run.id(),
                scans.listAssets(run.id(), 500, 0).stream().map(ScanAsset::id).toList());
    }

    private long seedBoundAsset(long universeId) {
        long projectId = localProjects.adopt(directory).projectId();
        localProjects.bindExperience(projectId, universeId, 1818L, "Test Experience");
        return seedAsset(projectId);
    }

    private long seedUnboundAsset() {
        return seedAsset(localProjects.adopt(directory).projectId());
    }

    private long seedAsset(long projectId) {
        var run = scans.create(projectId, directory, "1.0.0", List.of("node_modules"), List.of("rbxm"));
        scans.markStarted(run.id());
        List<AssetEntry> assets = List.of(new AssetEntry("art/walk.rbxm", "walk.rbxm", "rbxm", 128,
                "a".repeat(64), 64, 64, new Fingerprints("01", "02", null),
                VerificationStatus.CLEAR, new SourceEvidence(null, null, null),
                ReleaseDecision.PENDING, List.of(), List.of()));
        CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("proj", "1.0.0"), Instant.now(),
                new CreativeManifest.Summary(1, 1, 0, 0, 1, 1), assets);
        scans.complete(run.id(), manifest, new ScanAccounting(1, 0, 0, 0, 0, 0, 128), List.of());
        return scans.listAssets(run.id(), 10, 0).getFirst().id();
    }

    /**
     * Writes real response bodies to disk for the TypeScript client to parse.
     *
     * The three TS unit suites around LocalBridgeClient stub fetch, so they assert the client
     * against a hand-written idea of what this server returns. That catches client bugs and is
     * structurally blind to server drift: rename a field here and every one of them still passes
     * while the desktop app breaks.
     *
     * These fixtures are the actual bytes this server produced, captured from the same flow the
     * other tests in this class exercise. The TS side feeds them through the real client. If a
     * field is renamed, retyped or nested differently, that test fails on the next run of either
     * suite — which is the only way the two halves stay in contract without running both.
     *
     * Not asserted here on purpose. This test's job is to record what the server says, not to
     * decide whether it is right; the assertions live where the parsing does.
     */
    @Test
    void writesContractFixturesForTheTypeScriptClient() throws Exception {
        ObjectMapper json = new ObjectMapper();
        Path out = Path.of("..", "frontend", "src", "bridge", "contract-fixtures");
        Files.createDirectories(out);

        // Three assets rather than one, and a real batch recorded over two of them: the batch marker
        // is a key on ordinary decision and source-evidence payloads, so the only way the fixtures
        // can prove it survives a rename is for one of them to actually carry a batched decision.
        SeededRun seeded = seedGroupRun(3, 0);
        localProjects.bindExperience(seeded.projectId(), 90110L, 1818L, "Test Experience");
        long assetId = seeded.assetIds().getFirst();
        long projectId = seeded.projectId();
        String runId = seeded.runId();
        assertEquals(201, batchDecision(runId, "UNRESOLVED_SOURCE", "NEEDS_REVIEW",
                "Scheduling a review of the whole kit with Marco on Thursday.",
                seeded.assetIds().subList(0, 2), null).statusCode());

        String assetsPath = "/api/v1/projects/" + projectId + "/assets?limit=100&offset=0";

        // The team fixtures need a configured store and a store that answers, neither of which a
        // fresh temp data dir has. Configure the real TeamSettings the bridge already holds, and
        // install a fake TeamClient that returns one populated claim — a fixture recorded against
        // TeamClient.disabled() would carry an empty claims array and prove nothing about the row
        // shape, which is the half most likely to drift.
        teamSettings.save("http://team.example:8080", "contract-fixture-team-key", "contract-fixture-user");
        teamSettings.saveTeam(7L, "Harbor Studio");
        fakeTeam.set(new FixtureTeamClient());

        record Capture(String name, String path, String body) {
            Capture(String name, String path) {
                this(name, path, null);
            }
        }
        List<Capture> captures = List.of(
                new Capture("session", "/api/v1/session"),
                new Capture("projects", "/api/v1/projects"),
                new Capture("scan-run", "/api/v1/scan-runs/" + runId),
                new Capture("assets-page", assetsPath),
                new Capture("asset-detail", "/api/v1/assets/" + assetId),
                new Capture("decision-history", "/api/v1/assets/" + assetId + "/decisions"),
                new Capture("ownership-verifications", "/api/v1/assets/" + assetId + "/ownership-verifications"),
                new Capture("releases", "/api/v1/projects/" + projectId + "/releases"),
                new Capture("gate-preview", "/api/v1/projects/" + projectId + "/gate-preview"),
                new Capture("review-groups", "/api/v1/scan-runs/" + runId + "/review-groups"),
                new Capture("workspace-state", "/api/v1/workspace-state"),
                new Capture("team-status", "/api/v1/team"),
                new Capture("team-provenance", "/api/v1/team/provenance-lookup",
                        "{\"fingerprint\":\"" + "f".repeat(64)
                                + "\",\"algorithmVersion\":\"creatorflow.motion-fingerprint/v1\"}"));

        for (Capture capture : captures) {
            HttpResponse<String> response = capture.body() == null
                    ? get(capture.path(), cookie)
                    : postJson(capture.path(), cookie, origin.toString(), csrf, capture.body());
            assertEquals(200, response.statusCode(), capture.path() + " did not return 200");
            String stabilised = json.writerWithDefaultPrettyPrinter()
                    .writeValueAsString(stabilise(json.readTree(response.body())));
            assertNoPerRunValueSurvived(capture.name(), stabilised);
            Files.writeString(out.resolve(capture.name() + ".json"), stabilised);
        }
    }

    /** One populated claim, so the recorded fixture pins the row's real field names and types. */
    private static final class FixtureTeamClient implements TeamClient {

        private static final ClaimRecord CLAIM = new ClaimRecord(41, "mira", false, true,
                "creatorflow.motion-fingerprint/v1", "courier_run", 1.25, 90110L, "group:12345",
                "Authored in-house", "All rights reserved", "Kept as the shipped version.",
                Instant.parse("2026-07-30T09:00:00Z"), Instant.parse("2026-07-30T09:00:04Z"));

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
            return new LookupResult(TeamStatus.OK, List.of(CLAIM), null);
        }

        @Override
        public ShareResult share(ShareRequest request) {
            return new ShareResult(TeamStatus.OK, CLAIM, false, false, null);
        }

        @Override
        public RetractResult retract(long claimId, String reason) {
            return new RetractResult(TeamStatus.OK, CLAIM, null);
        }
    }

    /**
     * Fails if a value that changes every run reached the file.
     *
     * A stability bug in {@link #stabilise} cannot fail this test the honest way — you would have
     * to run it twice and diff, which no CI job does. So the check is inverted: these four strings
     * are known to be freshly generated for THIS run, and none of them may appear in what gets
     * written. Add a capture carrying a live token or a real port and this fails immediately rather
     * than several months later as unexplained {@code git status} noise.
     *
     * The limit is worth stating: this knows only about the volatile values it is told about. A
     * brand-new kind of per-run value still gets through, which is why {@code stabilise} matches
     * timestamps and UUIDs by shape rather than trusting this list to stay complete.
     */
    private void assertNoPerRunValueSurvived(String name, String written) {
        List<String> perRun = List.of(csrf, origin.toString(),
                directory.toString(), directory.getFileName().toString());
        for (String value : perRun) {
            assertFalse(written.contains(value),
                    name + ".json still carries a value that is regenerated every run (" + value
                            + "), so committing it would dirty the tree on the next mvn run. See #97.");
        }
    }

    private static final String STABLE_CSRF_TOKEN = "contract-fixture-csrf-token";
    private static final String STABLE_ORIGIN = "http://127.0.0.1:0";
    private static final String STABLE_INSTANT = "2026-01-01T00:00:00Z";
    private static final String STABLE_UUID = "00000000-0000-0000-0000-000000000000";
    private static final String STABLE_WORKSPACE = "contract-fixture-workspace";
    private static final String STABLE_KEY_STORAGE_MODE = "CONTRACT_FIXTURE_KEY_STORAGE_MODE";

    private static final Pattern UUID_SHAPED =
            Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final Pattern INSTANT_SHAPED =
            Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$");

    /**
     * Makes a captured response byte-identical from one run to the next, in place.
     *
     * Recording the raw bodies meant every {@code mvn verify} left modified fixtures in the working
     * tree (#97). That is worse than untidy: it trains whoever sees it to {@code git checkout} the
     * fixtures without reading them, which is precisely how a real field rename would get
     * discarded, and it makes {@code git status} unreliable for the concurrent-agent workflow this
     * repository actually uses.
     *
     * Five things vary per run, and they are not all values:
     *
     * <ol>
     *   <li>the CSRF token, freshly random per server start;</li>
     *   <li>the origin, which carries an ephemeral port;</li>
     *   <li>wall-clock timestamps;</li>
     *   <li>the scan-run UUID;</li>
     *   <li>the project name, which is this test's {@code @TempDir} directory name.</li>
     * </ol>
     *
     * And <strong>field order</strong>, which is the one worth knowing about. Some of these
     * payloads are assembled with {@code Map.of}, whose iteration order is randomised per JVM by
     * design — so key order is not stable even with every value pinned. Fields are therefore
     * written sorted. JSON object order is not part of the contract; the TypeScript client reads by
     * key, so imposing an order loses nothing and is the only way these files can be stable at all.
     *
     * Normalising values costs nothing these fixtures are for either. Their job is to catch drift
     * in field names, types and nesting — a renamed, retyped or re-nested field still changes the
     * file and still fails {@code contract.test.ts}, which asserts shapes rather than contents.
     * What is deliberately NOT done is dropping keys: {@code csrfToken} vanishing entirely is
     * exactly the kind of break worth failing on, so the key stays and only its value is pinned.
     *
     * Timestamps and UUIDs are matched by value shape rather than by field name, so a newly added
     * one is stabilised the first time it appears instead of quietly restarting the churn. The
     * one-off diff that ADDS the new key still shows up, which is the part a human should see.
     */
    private JsonNode stabilise(JsonNode node) {
        if (node instanceof ObjectNode object) {
            // Read the field names before touching anything: replacing values while iterating an
            // ObjectNode's own field iterator mutates what is being walked.
            List<String> fields = new ArrayList<>();
            object.fieldNames().forEachRemaining(fields::add);
            Collections.sort(fields);
            Map<String, JsonNode> sorted = new LinkedHashMap<>();
            for (String field : fields) sorted.put(field, stabiliseValue(field, object.get(field)));
            object.removeAll();
            object.setAll(sorted);
        } else if (node instanceof ArrayNode array) {
            array.forEach(this::stabilise);
        }
        return node;
    }

    private JsonNode stabiliseValue(String field, JsonNode value) {
        if (!value.isTextual()) return stabilise(value);
        if (field.equals("csrfToken")) return TextNode.valueOf(STABLE_CSRF_TOKEN);
        if (field.equals("origin")) return TextNode.valueOf(STABLE_ORIGIN);
        // keyStorageMode is OS-dependent BY DESIGN — DPAPI_WINDOWS on a Windows dev box,
        // PLAINTEXT on Linux CI — so recording the real value would make this fixture flip on
        // every platform change and reintroduce exactly the #97 churn. The key name and type are
        // what the contract test reads; the value is not part of the contract.
        if (field.equals("keyStorageMode")) return TextNode.valueOf(STABLE_KEY_STORAGE_MODE);
        String text = value.textValue();
        if (INSTANT_SHAPED.matcher(text).matches()) return TextNode.valueOf(STABLE_INSTANT);
        if (UUID_SHAPED.matcher(text).matches()) return TextNode.valueOf(STABLE_UUID);
        // Substring rather than equality: the temp directory shows up bare as the project name and
        // could show up again inside an absolute path.
        String withoutTempDir = text
                .replace(directory.toString(), STABLE_WORKSPACE)
                .replace(directory.getFileName().toString(), STABLE_WORKSPACE);
        return withoutTempDir.equals(text) ? value : TextNode.valueOf(withoutTempDir);
    }

    private HttpResponse<String> get(String path, String requestCookie) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(origin.resolve(path)).GET();
        if (requestCookie != null) request.header("Cookie", requestCookie);
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String requestCookie, String requestOrigin,
                                      String requestCsrf) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(origin.resolve(path))
                .POST(HttpRequest.BodyPublishers.noBody());
        if (requestCookie != null) request.header("Cookie", requestCookie);
        if (requestOrigin != null) request.header("Origin", requestOrigin);
        if (requestCsrf != null) request.header("X-CreatorFlow-CSRF", requestCsrf);
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> postJson(String path, String requestCookie, String requestOrigin,
                                          String requestCsrf, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(origin.resolve(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (requestCookie != null) request.header("Cookie", requestCookie);
        if (requestOrigin != null) request.header("Origin", requestOrigin);
        if (requestCsrf != null) request.header("X-CreatorFlow-CSRF", requestCsrf);
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> pluginRequest(String method, String path, String token, String body)
            throws Exception {
        HttpRequest.BodyPublisher publisher = body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body);
        HttpRequest.Builder request = HttpRequest.newBuilder(origin.resolve(path))
                .header("Authorization", "Bearer " + token)
                .method(method, publisher);
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String rawRequest(String request) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", origin.getPort());
             OutputStreamWriter writer = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.US_ASCII);
             BufferedReader reader = new BufferedReader(new InputStreamReader(
                     socket.getInputStream(), StandardCharsets.US_ASCII))) {
            writer.write(request);
            writer.flush();
            return reader.readLine();
        }
    }

    @Test
    void aReconnectingEventStreamResumesFromLastEventIdInsteadOfReplayingEverything() throws Exception {
        TestMedia.writePng(directory, "hero.png", TestMedia.structuredImage(9));
        ObjectMapper json = new ObjectMapper();
        HttpResponse<String> picked = post("/api/v1/project-picker", cookie, origin.toString(), csrf);
        long projectId = json.readTree(picked.body()).get("projectId").asLong();
        HttpResponse<String> started = client.send(HttpRequest.newBuilder(
                        origin.resolve("/api/v1/projects/" + projectId + "/scan-runs"))
                .header("Cookie", cookie).header("Origin", origin.toString())
                .header("X-CreatorFlow-CSRF", csrf).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"release\":\"resume-1\"}")).build(),
                HttpResponse.BodyHandlers.ofString());
        String runId = json.readTree(started.body()).get("id").asText();

        String state = "QUEUED";
        for (int attempt = 0; attempt < 200 && !"COMPLETED".equals(state); attempt++) {
            Thread.sleep(25);
            state = json.readTree(get("/api/v1/scan-runs/" + runId, cookie).body()).get("state").asText();
        }
        assertEquals("COMPLETED", state);

        // A fresh subscriber gets the whole buffer and every event carries an id:.
        String full = client.send(HttpRequest.newBuilder(
                        origin.resolve("/api/v1/scan-runs/" + runId + "/events"))
                .header("Cookie", cookie).GET().build(), HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(full.contains("id: 1"), "the stream must label events with an id to resume from");
        long highest = full.lines().filter(line -> line.startsWith("id: "))
                .mapToLong(line -> Long.parseLong(line.substring(4).strip())).max().orElseThrow();
        assertTrue(highest >= 1);

        // A browser EventSource reconnects to the SAME url (so no ?after=) and puts its position
        // in Last-Event-ID. Before this was read, the server restarted at 0 and replayed the lot.
        String resumed = client.send(HttpRequest.newBuilder(
                        origin.resolve("/api/v1/scan-runs/" + runId + "/events"))
                .header("Cookie", cookie).header("Last-Event-ID", Long.toString(highest))
                .GET().build(), HttpResponse.BodyHandlers.ofString()).body();
        assertFalse(resumed.contains("id: 1\n"), "a resumed stream must not replay from the start");
        assertFalse(resumed.contains("\"sequence\":1,"), "no already-delivered event may be re-sent");

        // A malformed header must not break the stream; it falls back to a full replay.
        String malformed = client.send(HttpRequest.newBuilder(
                        origin.resolve("/api/v1/scan-runs/" + runId + "/events"))
                .header("Cookie", cookie).header("Last-Event-ID", "not-a-number")
                .GET().build(), HttpResponse.BodyHandlers.ofString()).body();
        assertTrue(malformed.contains("id: 1"), "a malformed Last-Event-ID falls back to replay");
    }
}
