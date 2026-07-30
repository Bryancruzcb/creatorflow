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
import creatorflow.manifest.OwnershipEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.opencloud.RateLimitedException;
import creatorflow.workflow.ReleaseExportService;
import creatorflow.workflow.ScanAccounting;
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
    private OwnershipVerificationRepository ownershipVerifications;
    // The fake the verify-ownership route calls — swapped per test to return a MATCH, a MISMATCH,
    // or to throw a RateLimitedException, all without a live Open Cloud call.
    private final AtomicReference<OwnershipVerification> fakeVerifier = new AtomicReference<>();

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
        openCloudSettings = new OpenCloudSettings(directory);
        // Delegate to whatever the current test installed; never a live call.
        OwnershipVerification verifier = (robloxAssetId, universeId, now) -> {
            OwnershipVerification delegate = fakeVerifier.get();
            if (delegate == null) {
                throw new IllegalStateException("no fake OwnershipVerification installed for this test");
            }
            return delegate.verify(robloxAssetId, universeId, now);
        };
        server = new LocalBridgeServer(() -> Optional.of(directory), localProjects, scans,
                decisions, releases, workspaceState, animationComparisons, motionSnapshots,
                pluginPairings, releaseExports, openCloudSettings, verifier, ownershipVerifications,
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

        long assetId = seedBoundAsset(90110L);
        long projectId = json.readTree(get("/api/v1/projects", cookie).body())
                .get("items").get(0).get("projectId").asLong();

        // The run id comes from the assets page: /api/v1/projects/{id}/scan-runs is POST-only,
        // it starts a scan rather than listing them.
        String assetsPath = "/api/v1/projects/" + projectId + "/assets?limit=100&offset=0";
        String runId = json.readTree(get(assetsPath, cookie).body()).get("scanRunId").asText();

        record Capture(String name, String path) { }
        List<Capture> captures = List.of(
                new Capture("session", "/api/v1/session"),
                new Capture("projects", "/api/v1/projects"),
                new Capture("scan-run", "/api/v1/scan-runs/" + runId),
                new Capture("assets-page", assetsPath),
                new Capture("asset-detail", "/api/v1/assets/" + assetId),
                new Capture("decision-history", "/api/v1/assets/" + assetId + "/decisions"),
                new Capture("ownership-verifications", "/api/v1/assets/" + assetId + "/ownership-verifications"),
                new Capture("releases", "/api/v1/projects/" + projectId + "/releases"),
                new Capture("workspace-state", "/api/v1/workspace-state"));

        for (Capture capture : captures) {
            HttpResponse<String> response = get(capture.path(), cookie);
            assertEquals(200, response.statusCode(), capture.path() + " did not return 200");
            String stabilised = json.writerWithDefaultPrettyPrinter()
                    .writeValueAsString(stabilise(json.readTree(response.body())));
            assertNoPerRunValueSurvived(capture.name(), stabilised);
            Files.writeString(out.resolve(capture.name() + ".json"), stabilised);
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
