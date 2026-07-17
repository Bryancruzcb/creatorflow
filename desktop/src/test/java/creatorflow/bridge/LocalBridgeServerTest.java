package creatorflow.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import creatorflow.TestMedia;
import creatorflow.db.AuditRepository;
import creatorflow.db.AnimationComparisonRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.MotionSnapshotRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.workflow.ReleaseExportService;
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
import java.util.Arrays;
import java.util.Optional;
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
        var pluginPairings = new PluginPairingService();
        var audit = new AuditRepository(database);
        var coordinator = new ScanCoordinator(scans, localProjects, audit);
        var releaseExports = new ReleaseExportService(database, localProjects, scans, decisions,
                releases, audit);
        server = new LocalBridgeServer(() -> Optional.of(directory), localProjects, scans,
                decisions, releases, workspaceState, animationComparisons, motionSnapshots,
                pluginPairings, releaseExports, coordinator, webRoot).start();
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
}
