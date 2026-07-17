package creatorflow.bridge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import creatorflow.db.AnimationComparisonRepository;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.MotionSnapshotRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.ScanOptions;
import creatorflow.motion.MotionComparisonEngine;
import creatorflow.motion.MotionComparisonRequest;
import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.NormalizedAnimation;
import creatorflow.workflow.AnimationComparisonRecord;
import creatorflow.workflow.MotionSnapshotRecord;
import creatorflow.workflow.DecisionType;
import creatorflow.workflow.LocalProject;
import creatorflow.workflow.ReleaseBundle;
import creatorflow.workflow.ReleaseExportService;
import creatorflow.workflow.ReleaseRecord;
import creatorflow.workflow.ReleaseSummary;
import creatorflow.workflow.ScanAsset;
import creatorflow.workflow.ScanRun;
import creatorflow.workflow.WorkspaceState;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Same-origin loopback host for the React workspace and desktop-only capabilities.
 * The server binds only 127.0.0.1, accepts roots only from {@link ProjectPicker}, and has no CORS.
 */
public final class LocalBridgeServer implements AutoCloseable {

    public static final String WEB_ROOT_PROPERTY = "creatorflow.web.root";
    private static final String COOKIE_NAME = "creatorflow_session";
    private static final int MAX_REQUEST_BYTES = 64 * 1024;
    private static final int MAX_MOTION_REQUEST_BYTES = 2 * 1024 * 1024;
    private static final int MAX_MOTION_KEYFRAMES = 2_000;
    private static final int MAX_MOTION_POSES = 20_000;
    private static final String MOTION_INPUT_SCHEMA = "creatorflow.roblox-motion/v0.1";
    private static final Pattern PROJECT_SCANS = Pattern.compile("^/api/v1/projects/(\\d+)/scan-runs$");
    private static final Pattern PROJECT_ASSETS = Pattern.compile("^/api/v1/projects/(\\d+)/assets$");
    private static final Pattern PROJECT_RELEASES = Pattern.compile("^/api/v1/projects/(\\d+)/releases$");
    private static final Pattern PROJECT_PLUGIN_PAIRING = Pattern.compile("^/api/v1/projects/(\\d+)/plugin-pairings$");
    private static final Pattern PROJECT_PLUGIN_PAIRING_REVOKE =
            Pattern.compile("^/api/v1/projects/(\\d+)/plugin-pairings/([a-f0-9-]+)/revoke$");
    private static final Pattern PROJECT_EXPERIENCE = Pattern.compile("^/api/v1/projects/(\\d+)/experience$");
    private static final Pattern PROJECT_MOTION_COMPARISONS = Pattern.compile("^/api/v1/projects/(\\d+)/motion-comparisons$");
    private static final Pattern PROJECT_ANIMATION_SNAPSHOTS = Pattern.compile("^/api/v1/projects/(\\d+)/animation-snapshots$");
    private static final Pattern SCAN = Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)$");
    private static final Pattern SCAN_EVENTS = Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/events$");
    private static final Pattern SCAN_CANCEL = Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/cancel$");
    private static final Pattern ASSET = Pattern.compile("^/api/v1/assets/(\\d+)$");
    private static final Pattern ASSET_DECISIONS = Pattern.compile("^/api/v1/assets/(\\d+)/decisions$");
    private static final Pattern ASSET_EVIDENCE = Pattern.compile("^/api/v1/assets/(\\d+)/source-evidence$");
    private static final Pattern RELEASE_MANIFEST = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)/manifest$");
    private static final Pattern RELEASE_REPORT = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)/report$");
    private static final Pattern RELEASE_PUBLISHED_VERSION = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)/published-version$");
    private static final Pattern RELEASE = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)$");
    private static final Pattern MOTION_COMPARISON = Pattern.compile("^/api/v1/motion-comparisons/([a-f0-9-]+)$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final ProjectPicker picker;
    private final LocalProjectRepository localProjects;
    private final ScanRepository scans;
    private final DecisionRepository decisions;
    private final ReleaseRepository releases;
    private final WorkspaceStateRepository workspaceState;
    private final AnimationComparisonRepository animationComparisons;
    private final MotionSnapshotRepository motionSnapshots;
    private final PluginPairingService pluginPairings;
    private final ReleaseExportService releaseExports;
    private final ScanCoordinator coordinator;
    private final Path staticRoot;
    private final ObjectMapper json = JsonMapper.builder().addModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS).build();
    private final AtomicReference<String> launchToken = new AtomicReference<>(secret());
    private final AtomicReference<String> sessionToken = new AtomicReference<>();
    private final AtomicReference<String> csrfToken = new AtomicReference<>();
    private final ExecutorService httpExecutor = Executors.newVirtualThreadPerTaskExecutor();

    private HttpServer server;
    private String expectedHost;
    private java.util.Set<String> allowedHosts;
    private URI origin;

    public LocalBridgeServer(ProjectPicker picker, LocalProjectRepository localProjects,
                             ScanRepository scans, DecisionRepository decisions,
                             ReleaseRepository releases, WorkspaceStateRepository workspaceState,
                             AnimationComparisonRepository animationComparisons,
                             MotionSnapshotRepository motionSnapshots,
                             PluginPairingService pluginPairings,
                             ReleaseExportService releaseExports, ScanCoordinator coordinator,
                             Path staticRoot) {
        this.picker = java.util.Objects.requireNonNull(picker, "picker");
        this.localProjects = java.util.Objects.requireNonNull(localProjects, "localProjects");
        this.scans = java.util.Objects.requireNonNull(scans, "scans");
        this.decisions = java.util.Objects.requireNonNull(decisions, "decisions");
        this.releases = java.util.Objects.requireNonNull(releases, "releases");
        this.workspaceState = java.util.Objects.requireNonNull(workspaceState, "workspaceState");
        this.animationComparisons = java.util.Objects.requireNonNull(animationComparisons, "animationComparisons");
        this.motionSnapshots = java.util.Objects.requireNonNull(motionSnapshots, "motionSnapshots");
        this.pluginPairings = java.util.Objects.requireNonNull(pluginPairings, "pluginPairings");
        this.releaseExports = java.util.Objects.requireNonNull(releaseExports, "releaseExports");
        this.coordinator = java.util.Objects.requireNonNull(coordinator, "coordinator");
        this.staticRoot = normalizeStaticRoot(staticRoot);
    }

    public synchronized LocalBridgeServer start() {
        if (server != null) return this;
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
            expectedHost = "127.0.0.1:" + server.getAddress().getPort();
            // Both names the Studio plugin advertises as valid; a foreign origin can
            // never present either Host value, so the DNS-rebinding defense holds.
            allowedHosts = java.util.Set.of(expectedHost,
                    "localhost:" + server.getAddress().getPort());
            origin = URI.create("http://" + expectedHost);
            server.createContext("/", this::handle);
            server.setExecutor(httpExecutor);
            server.start();
            return this;
        } catch (IOException e) {
            throw new IllegalStateException("Could not start CreatorFlow local bridge", e);
        }
    }

    public URI origin() {
        ensureStarted();
        return origin;
    }

    public URI launchUri() {
        ensureStarted();
        String token = launchToken.get();
        if (token == null) return origin;
        return URI.create(origin + "/launch?token=" + token);
    }

    private void handle(HttpExchange exchange) throws IOException {
        addSecurityHeaders(exchange.getResponseHeaders());
        try {
            String host = exchange.getRequestHeaders().getFirst("Host");
            if (host == null || !allowedHosts.contains(host.toLowerCase(java.util.Locale.ROOT))) {
                throw new HttpError(403, "Invalid Host header");
            }
            String path = decodedPath(exchange);
            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                throw new HttpError(405, "CORS is not enabled");
            }
            if ("/launch".equals(path)) {
                launch(exchange);
                return;
            }
            if (path.startsWith("/plugin/")) {
                routePlugin(exchange, path);
                return;
            }
            if (path.startsWith("/api/")) {
                requireSession(exchange);
                requireSameOriginWhenPresent(exchange);
                routeApi(exchange, path);
                return;
            }
            if (!"GET".equals(exchange.getRequestMethod()) && !"HEAD".equals(exchange.getRequestMethod())) {
                throw new HttpError(405, "Method not allowed");
            }
            serveStatic(exchange, path);
        } catch (HttpError error) {
            sendJson(exchange, error.status, Map.of("error", error.getMessage()));
        } catch (IllegalArgumentException error) {
            sendJson(exchange, 400, Map.of("error", safeMessage(error)));
        } catch (Exception error) {
            sendJson(exchange, 500, Map.of("error", "Local bridge request failed"));
        } finally {
            exchange.close();
        }
    }

    private void launch(HttpExchange exchange) throws IOException {
        requireMethod(exchange, "GET");
        String supplied = query(exchange.getRequestURI().getRawQuery()).get("token");
        String expected = launchToken.get();
        if (expected == null || !constantTimeEquals(expected, supplied)
                || !launchToken.compareAndSet(expected, null)) {
            throw new HttpError(401, "Launch token is invalid or has already been used");
        }
        String session = secret();
        String csrf = secret();
        sessionToken.set(session);
        csrfToken.set(csrf);
        exchange.getResponseHeaders().add("Set-Cookie", COOKIE_NAME + "=" + session
                + "; Path=/; HttpOnly; SameSite=Strict");
        exchange.getResponseHeaders().set("Location", "/");
        exchange.sendResponseHeaders(303, -1);
    }

    private void routePlugin(HttpExchange exchange, String path) throws IOException {
        PluginPairingService.Pairing pairing = requirePluginPairing(exchange);
        if (localProjects.findByProjectId(pairing.projectId()).isEmpty()) {
            throw new HttpError(401, "The paired CreatorFlow project no longer exists");
        }
        if ("/plugin/v1/health".equals(path)) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, Map.of(
                    "status", "ok",
                    "projectId", pairing.projectId(),
                    "expiresAt", pairing.expiresAt(),
                    "schema", MOTION_INPUT_SCHEMA));
            return;
        }
        if ("/plugin/v1/motion-comparisons".equals(path)) {
            requireMethod(exchange, "POST");
            JsonNode body = readJson(exchange, MAX_MOTION_REQUEST_BYTES);
            MotionComparisonRequest request = parseMotionRequest(body);
            var result = MotionComparisonEngine.compare(request);
            NormalizedAnimation source = request.source();
            NormalizedAnimation candidate = request.candidate();
            AnimationComparisonRecord stored = animationComparisons.insert(
                    pairing.projectId(), source.assetId(), candidate.assetId(),
                    source.name(), candidate.name(), source.duration(), candidate.duration(),
                    result.sourceFingerprint(), result.candidateFingerprint(),
                    roundedPercent(result.overallPercent()), roundedPercent(result.posePercent()),
                    roundedPercent(result.timingPercent()), roundedPercent(result.coveragePercent()),
                    result.exactCurveData(), json.writeValueAsString(result), result.algorithmVersion());
            sendJson(exchange, 201, animationComparisonView(stored));
            return;
        }
        throw new HttpError(404, "Plugin endpoint not found");
    }

    private MotionComparisonRequest parseMotionRequest(JsonNode body) {
        if (!body.isObject()) throw new IllegalArgumentException("Motion request must be a JSON object");
        String schema = text(body, "schema", null);
        if (!MOTION_INPUT_SCHEMA.equals(schema)) {
            throw new IllegalArgumentException("Unsupported motion schema");
        }
        if (!body.path("source").isObject() || !body.path("candidate").isObject()) {
            throw new IllegalArgumentException("Motion request requires source and candidate animations");
        }
        validateMotionEnvelope(body.get("source"), "source");
        validateMotionEnvelope(body.get("candidate"), "candidate");
        try {
            return new MotionComparisonRequest(
                    json.treeToValue(body.get("source"), NormalizedAnimation.class),
                    json.treeToValue(body.get("candidate"), NormalizedAnimation.class));
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalArgumentException("Motion request is malformed");
        }
    }

    private static void validateMotionEnvelope(JsonNode animation, String label) {
        JsonNode keyframes = animation.path("keyframes");
        if (!keyframes.isArray() || keyframes.isEmpty()) {
            throw new IllegalArgumentException(label + " animation requires keyframes");
        }
        if (keyframes.size() > MAX_MOTION_KEYFRAMES) {
            throw new IllegalArgumentException(label + " animation has too many keyframes");
        }
        int poseCount = 0;
        for (JsonNode keyframe : keyframes) {
            JsonNode poses = keyframe.path("poses");
            if (!poses.isArray()) throw new IllegalArgumentException(label + " keyframe requires poses");
            poseCount += poses.size();
            if (poseCount > MAX_MOTION_POSES) {
                throw new IllegalArgumentException(label + " animation has too many poses");
            }
        }
    }

    private void routeApi(HttpExchange exchange, String path) throws IOException {
        if ("/api/v1/session".equals(path)) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, Map.of("csrfToken", csrfToken.get(), "origin", origin.toString()));
            return;
        }
        if ("/api/v1/projects".equals(path)) {
            requireMethod(exchange, "GET");
            sendJson(exchange, 200, Map.of("items", localProjects.list().stream()
                    .map(LocalBridgeServer::projectView).toList()));
            return;
        }
        if ("/api/v1/workspace-state".equals(path)) {
            if ("GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 200, workspaceView(workspaceState.load().orElse(null)));
            } else {
                requireMutation(exchange);
                WorkspaceState state = workspaceState.save(parseWorkspaceState(readJson(exchange)));
                sendJson(exchange, 200, workspaceView(state));
            }
            return;
        }
        if ("/api/v1/project-picker".equals(path)) {
            requireMutation(exchange);
            Optional<Path> selected = picker.chooseProject();
            if (selected.isEmpty()) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            LocalProject project = localProjects.adopt(selected.orElseThrow());
            sendJson(exchange, 201, Map.of("projectId", project.projectId(), "name", project.name()));
            return;
        }

        Matcher matcher = PROJECT_PLUGIN_PAIRING.matcher(path);
        if (matcher.matches()) {
            long projectId = Long.parseLong(matcher.group(1));
            localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            if ("GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 200, Map.of("items", pluginPairings.list(projectId).stream()
                        .map(LocalBridgeServer::pluginPairingView).toList()));
                return;
            }
            requireMutation(exchange);
            PluginPairingService.IssuedPairing pairing = pluginPairings.issue(projectId);
            sendJson(exchange, 201, Map.of(
                    "id", pairing.id(),
                    "projectId", pairing.projectId(),
                    "endpoint", origin.toString(),
                    "token", pairing.token(),
                    "expiresAt", pairing.expiresAt()));
            return;
        }

        matcher = PROJECT_PLUGIN_PAIRING_REVOKE.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            long projectId = Long.parseLong(matcher.group(1));
            String pairingId = matcher.group(2);
            localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            // Scope the revoke to this project: a pairing id that exists but belongs to a
            // different project must 404, exactly like an unknown id.
            boolean belongsToProject = pluginPairings.list(projectId).stream()
                    .anyMatch(view -> view.id().equals(pairingId));
            if (!belongsToProject) throw new HttpError(404, "Plugin pairing not found");
            pluginPairings.revoke(pairingId, projectId);
            sendJson(exchange, 200, Map.of("items", pluginPairings.list(projectId).stream()
                    .map(LocalBridgeServer::pluginPairingView).toList()));
            return;
        }

        matcher = PROJECT_EXPERIENCE.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            long projectId = Long.parseLong(matcher.group(1));
            localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            JsonNode body = readJson(exchange);
            Long universeId = nullableLong(body, "universeId");
            Long placeId = nullableLong(body, "placeId");
            String experienceName = requiredText(body, "experienceName");
            if (universeId == null) throw new IllegalArgumentException("universeId is required");
            if (placeId == null) throw new IllegalArgumentException("placeId is required");
            localProjects.bindExperience(projectId, universeId, placeId, experienceName);
            LocalProject updated = localProjects.findByProjectId(projectId).orElseThrow();
            sendJson(exchange, 200, projectView(updated));
            return;
        }

        matcher = PROJECT_MOTION_COMPARISONS.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            long projectId = Long.parseLong(matcher.group(1));
            localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            Map<String, String> query = query(exchange.getRequestURI().getRawQuery());
            int limit = Math.max(1, Math.min(integer(query.get("limit"), 25), 100));
            int offset = Math.max(0, integer(query.get("offset"), 0));
            sendJson(exchange, 200, Map.of(
                    "items", animationComparisons.forProject(projectId, limit, offset).stream()
                            .map(record -> {
                                try {
                                    return animationComparisonView(record);
                                } catch (IOException error) {
                                    throw new IllegalStateException("Stored animation comparison is invalid", error);
                                }
                            }).toList(),
                    "limit", limit,
                    "offset", offset));
            return;
        }

        matcher = MOTION_COMPARISON.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            AnimationComparisonRecord record = animationComparisons.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Animation comparison not found"));
            sendJson(exchange, 200, animationComparisonView(record));
            return;
        }

        matcher = PROJECT_ANIMATION_SNAPSHOTS.matcher(path);
        if (matcher.matches()) {
            long projectId = Long.parseLong(matcher.group(1));
            localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            if ("GET".equals(exchange.getRequestMethod())) {
                Map<String, String> query = query(exchange.getRequestURI().getRawQuery());
                String assetId = query.get("assetId");
                String kindParam = query.get("kind");
                List<MotionSnapshotRecord> items;
                if (Boolean.parseBoolean(query.get("history")) && assetId != null && kindParam != null) {
                    int limit = Math.max(1, Math.min(integer(query.get("limit"), 25), 100));
                    int offset = Math.max(0, integer(query.get("offset"), 0));
                    items = motionSnapshots.history(projectId, assetId,
                            MotionSnapshotKind.fromWire(kindParam), limit, offset);
                } else {
                    items = motionSnapshots.currentForProject(projectId);
                }
                sendJson(exchange, 200, Map.of("items", items.stream().map(this::snapshotView).toList()));
            } else {
                requireMutation(exchange);
                JsonNode body = readJson(exchange);
                String comparisonId = requiredText(body, "comparisonId");
                String side = requiredText(body, "side");
                MotionSnapshotKind kind = MotionSnapshotKind.fromWire(text(body, "kind", null));
                AnimationComparisonRecord comparison = animationComparisons.findById(comparisonId)
                        .filter(record -> record.projectId() == projectId)
                        .orElseThrow(() -> new HttpError(404, "Animation comparison not found"));
                MotionSnapshotRecord snapshot = switch (side.toLowerCase(java.util.Locale.ROOT)) {
                    case "source" -> motionSnapshots.capture(projectId, comparison.sourceAssetId(), kind,
                            comparisonId, comparison.sourceName(), comparison.sourceDuration(),
                            comparison.sourceFingerprint(), comparison.algorithmVersion());
                    case "candidate" -> motionSnapshots.capture(projectId, comparison.candidateAssetId(), kind,
                            comparisonId, comparison.candidateName(), comparison.candidateDuration(),
                            comparison.candidateFingerprint(), comparison.algorithmVersion());
                    default -> throw new IllegalArgumentException("side must be \"source\" or \"candidate\"");
                };
                sendJson(exchange, 201, snapshotView(snapshot));
            }
            return;
        }

        matcher = PROJECT_SCANS.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            long projectId = Long.parseLong(matcher.group(1));
            LocalProject project = localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            JsonNode body = readJson(exchange);
            ScanOptions options = scanOptions(body);
            String release = text(body, "release", "Working");
            sendJson(exchange, 202, runView(coordinator.start(project, release, options)));
            return;
        }

        matcher = PROJECT_ASSETS.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            long projectId = Long.parseLong(matcher.group(1));
            LocalProject project = localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            String runId = project.activeScanRunId();
            if (runId == null) runId = scans.latestForProject(projectId).map(ScanRun::id).orElse(null);
            if (runId == null) {
                sendJson(exchange, 200, Map.of("items", List.of(), "limit", 100, "offset", 0));
                return;
            }
            Map<String, String> query = query(exchange.getRequestURI().getRawQuery());
            int limit = integer(query.get("limit"), 100);
            int offset = integer(query.get("offset"), 0);
            sendJson(exchange, 200, Map.of("scanRunId", runId,
                    "items", scans.listAssets(runId, limit, offset),
                    "limit", Math.max(1, Math.min(limit, 500)), "offset", Math.max(0, offset)));
            return;
        }

        matcher = PROJECT_RELEASES.matcher(path);
        if (matcher.matches()) {
            long projectId = Long.parseLong(matcher.group(1));
            LocalProject project = localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            if ("GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 200, Map.of("items", releases.summariesForProject(projectId).stream()
                        .map(this::releaseSummaryView).toList()));
            } else {
                requireMutation(exchange);
                JsonNode body = readJson(exchange);
                String runId = text(body, "scanRunId", project.activeScanRunId());
                if (runId == null) runId = scans.latestForProject(projectId).map(ScanRun::id).orElse(null);
                if (runId == null) throw new HttpError(409, "Project has no scan to release");
                ScanRun run = scans.findById(runId)
                        .orElseThrow(() -> new HttpError(404, "Scan run not found"));
                String releaseName = text(body, "release", run.releaseName());
                try {
                    sendJson(exchange, 201, releaseBundleView(
                            releaseExports.create(projectId, runId, releaseName)));
                } catch (IllegalStateException conflict) {
                    throw new HttpError(409, safeMessage(conflict));
                }
            }
            return;
        }

        matcher = SCAN_EVENTS.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            streamEvents(exchange, matcher.group(1));
            return;
        }
        matcher = SCAN_CANCEL.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            boolean accepted = coordinator.cancel(matcher.group(1));
            if (!accepted) throw new HttpError(409, "Scan is not cancellable");
            sendJson(exchange, 202, Map.of("state", "CANCELLATION_REQUESTED"));
            return;
        }
        matcher = SCAN.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            ScanRun run = scans.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Scan run not found"));
            sendJson(exchange, 200, runView(run));
            return;
        }

        matcher = ASSET_DECISIONS.matcher(path);
        if (matcher.matches()) {
            long assetId = Long.parseLong(matcher.group(1));
            if ("GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 200, Map.of("items", decisions.historyFor(assetId)));
            } else {
                requireMutation(exchange);
                JsonNode body = readJson(exchange);
                DecisionType type = DecisionType.valueOf(requiredText(body, "type"));
                String reason = requiredText(body, "reason");
                String supersedes = text(body, "supersedesDecisionId", null);
                sendJson(exchange, 201, supersedes == null
                        ? decisions.append(assetId, type, reason)
                        : decisions.supersede(supersedes, type, reason));
            }
            return;
        }
        matcher = ASSET_EVIDENCE.matcher(path);
        if (matcher.matches()) {
            long assetId = Long.parseLong(matcher.group(1));
            if (scans.findAsset(assetId).isEmpty()) throw new HttpError(404, "Scan asset not found");
            if ("GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 200, Map.of("items", scans.evidenceHistory(assetId)));
            } else {
                requireMutation(exchange);
                JsonNode body = readJson(exchange);
                SourceEvidence evidence = new SourceEvidence(optionalText(body, "source"),
                        optionalText(body, "license"), optionalText(body, "evidenceUrl"));
                sendJson(exchange, 201, scans.appendEvidence(assetId, evidence));
            }
            return;
        }
        matcher = ASSET.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            long assetId = Long.parseLong(matcher.group(1));
            ScanAsset asset = scans.findAsset(assetId)
                    .orElseThrow(() -> new HttpError(404, "Scan asset not found"));
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("asset", asset);
            response.put("findings", scans.findingsFor(assetId));
            response.put("sourceEvidence", scans.evidenceFor(assetId).orElse(null));
            response.put("latestDecision", decisions.latestFor(assetId).orElse(null));
            sendJson(exchange, 200, response);
            return;
        }

        matcher = RELEASE_MANIFEST.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            ReleaseRecord release = releases.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Release not found"));
            sendJsonArtifact(exchange, release.manifestJson(),
                    artifactName(release.releaseName(), "manifest"));
            return;
        }
        matcher = RELEASE_REPORT.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            ReleaseRecord release = releases.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Release not found"));
            sendJsonArtifact(exchange, release.reportJson(),
                    artifactName(release.releaseName(), "gate-report"));
            return;
        }
        matcher = RELEASE_PUBLISHED_VERSION.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            String releaseId = matcher.group(1);
            releases.findById(releaseId).orElseThrow(() -> new HttpError(404, "Release not found"));
            JsonNode body = readJson(exchange);
            Long publishedPlaceVersion = nullableLong(body, "publishedPlaceVersion");
            if (publishedPlaceVersion == null) {
                throw new IllegalArgumentException("publishedPlaceVersion is required");
            }
            releases.recordPublishedVersion(releaseId, publishedPlaceVersion);
            ReleaseRecord updated = releases.findById(releaseId).orElseThrow();
            sendJson(exchange, 200, releaseView(updated));
            return;
        }
        matcher = RELEASE.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            ReleaseRecord release = releases.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Release not found"));
            sendJson(exchange, 200, releaseDetailView(release));
            return;
        }
        throw new HttpError(404, "API endpoint not found");
    }

    private void streamEvents(HttpExchange exchange, String runId) throws IOException {
        scans.findById(runId).orElseThrow(() -> new HttpError(404, "Scan run not found"));
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Accel-Buffering", "no");
        exchange.sendResponseHeaders(200, 0);
        long last = integer(query(exchange.getRequestURI().getRawQuery()).get("after"), 0);
        try (OutputStream output = exchange.getResponseBody()) {
            while (true) {
                List<ScanCoordinator.ProgressEvent> events = coordinator.awaitEvents(runId, last, 10_000);
                for (var event : events) {
                    last = event.sequence();
                    output.write(("id: " + last + "\nevent: " + event.type().name().toLowerCase()
                            + "\ndata: " + json.writeValueAsString(event) + "\n\n")
                            .getBytes(StandardCharsets.UTF_8));
                }
                if (events.isEmpty()) output.write(": keepalive\n\n".getBytes(StandardCharsets.UTF_8));
                output.flush();
                ScanRun run = scans.findById(runId).orElseThrow();
                if (run.state().terminal() && events.isEmpty()) return;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void serveStatic(HttpExchange exchange, String path) throws IOException {
        if (path.contains("\0") || segments(path).contains("..")) {
            throw new HttpError(400, "Invalid static path");
        }
        String relative = path.equals("/") ? "index.html" : path.substring(1);
        if (staticRoot != null) {
            Path candidate = staticRoot.resolve(relative).normalize();
            if (!candidate.startsWith(staticRoot)) throw new HttpError(400, "Invalid static path");
            if (Files.isRegularFile(candidate)) {
                sendStaticFile(exchange, candidate, relative);
                return;
            }
            if (!relative.contains(".") && Files.isRegularFile(staticRoot.resolve("index.html"))) {
                sendStaticFile(exchange, staticRoot.resolve("index.html"), "index.html");
                return;
            }
        }
        String resourcePath = "/creatorflow/web/" + (relative.contains(".") ? relative : "index.html");
        InputStream resource = LocalBridgeServer.class.getResourceAsStream(resourcePath);
        if (resource == null) throw new HttpError(404, "Static asset not found");
        try (InputStream input = resource) {
            exchange.getResponseHeaders().set("Content-Type", contentType(relative));
            setStaticCachePolicy(exchange.getResponseHeaders(), relative);
            if ("HEAD".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(200, -1);
                return;
            }
            exchange.sendResponseHeaders(200, 0);
            try (OutputStream output = exchange.getResponseBody()) {
                input.transferTo(output);
            }
        }
    }

    /** Streams large GLBs and media instead of materializing an entire asset in the bridge heap. */
    private static void sendStaticFile(HttpExchange exchange, Path file, String requestPath) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", contentType(requestPath));
        exchange.getResponseHeaders().set("Content-Length", Long.toString(Files.size(file)));
        setStaticCachePolicy(exchange.getResponseHeaders(), requestPath);
        if ("HEAD".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(200, -1);
            return;
        }
        exchange.sendResponseHeaders(200, Files.size(file));
        try (InputStream input = Files.newInputStream(file);
             OutputStream output = exchange.getResponseBody()) {
            input.transferTo(output);
        }
    }

    private static void setStaticCachePolicy(Headers headers, String path) {
        if (path.equals("index.html") || path.endsWith(".json")) {
            headers.set("Cache-Control", "no-cache");
        } else {
            headers.set("Cache-Control", "public, max-age=31536000, immutable");
        }
    }

    private ScanOptions scanOptions(JsonNode body) {
        ScanOptions defaults = ScanOptions.defaults();
        Set<String> exclusions = stringSet(body.get("excludedDirectoryNames"),
                defaults.excludedDirectoryNames());
        Set<String> formats = stringSet(body.get("supportedFileTypes"), defaults.supportedFileTypes());
        boolean hidden = body.path("includeHidden").asBoolean(defaults.includeHidden());
        boolean symlinks = body.path("followSymbolicLinks").asBoolean(defaults.followSymbolicLinks());
        return new ScanOptions(exclusions, formats, hidden, symlinks);
    }

    private static Set<String> stringSet(JsonNode node, Set<String> fallback) {
        if (node == null || node.isNull()) return fallback;
        if (!node.isArray()) throw new IllegalArgumentException("Expected an array of strings");
        java.util.LinkedHashSet<String> values = new java.util.LinkedHashSet<>();
        node.forEach(value -> {
            if (!value.isTextual()) throw new IllegalArgumentException("Expected an array of strings");
            values.add(value.asText());
        });
        return values;
    }

    private Map<String, Object> runView(ScanRun run) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", run.id());
        view.put("projectId", run.projectId());
        view.put("release", run.releaseName());
        view.put("state", run.state());
        view.put("discoveredCount", run.discoveredCount());
        view.put("processedCount", run.processedCount());
        view.put("bytesProcessed", run.bytesProcessed());
        view.put("supportedCount", run.supportedCount());
        view.put("ignoredCount", run.ignoredCount());
        view.put("excludedCount", run.excludedCount());
        view.put("unreadableCount", run.unreadableCount());
        view.put("missingDependencyCount", run.missingDependencyCount());
        view.put("failedCount", run.failedCount());
        view.put("warnings", run.warnings());
        view.put("error", run.errorMessage());
        view.put("createdAt", run.createdAt());
        view.put("startedAt", run.startedAt());
        view.put("completedAt", run.completedAt());
        return view;
    }

    private static Map<String, Object> projectView(LocalProject project) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("projectId", project.projectId());
        view.put("name", project.name());
        view.put("adoptedAt", project.adoptedAt());
        view.put("activeScanRunId", project.activeScanRunId());
        view.put("experience", experienceView(project.universeId(), project.placeId(), project.experienceName()));
        return view;
    }

    private Map<String, Object> releaseView(ReleaseRecord release) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", release.id());
        view.put("scanRunId", release.scanRunId());
        view.put("release", release.releaseName());
        view.put("policyResult", release.policyResult());
        view.put("createdAt", release.createdAt());
        view.put("manifestUrl", "/api/v1/releases/" + release.id() + "/manifest");
        view.put("reportUrl", "/api/v1/releases/" + release.id() + "/report");
        view.put("comparison", readStoredJson(release.comparisonJson()));
        view.put("experience", experienceView(release.universeId(), release.placeId(), release.experienceName()));
        view.put("publishedPlaceVersion", release.publishedPlaceVersion());
        return view;
    }

    private Map<String, Object> releaseSummaryView(ReleaseSummary release) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", release.id());
        view.put("scanRunId", release.scanRunId());
        view.put("release", release.releaseName());
        view.put("policyResult", release.policyResult());
        view.put("createdAt", release.createdAt());
        view.put("manifestUrl", "/api/v1/releases/" + release.id() + "/manifest");
        view.put("reportUrl", "/api/v1/releases/" + release.id() + "/report");
        view.put("comparison", readStoredJson(release.comparisonJson()));
        view.put("experience", experienceView(release.universeId(), release.placeId(), release.experienceName()));
        view.put("publishedPlaceVersion", release.publishedPlaceVersion());
        return view;
    }

    /** A human declaration only — CreatorFlow does not verify ownership of or access to it. */
    private static Map<String, Object> experienceView(Long universeId, Long placeId, String experienceName) {
        if (universeId == null || placeId == null || experienceName == null) return null;
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("universeId", universeId);
        view.put("placeId", placeId);
        view.put("experienceName", experienceName);
        return view;
    }

    private Map<String, Object> releaseBundleView(ReleaseBundle bundle) {
        Map<String, Object> view = new LinkedHashMap<>(releaseView(bundle.release()));
        view.put("manifest", bundle.manifest());
        view.put("report", bundle.report());
        view.put("comparison", bundle.comparison());
        return view;
    }

    private JsonNode readStoredJson(String value) {
        try {
            return json.readTree(value);
        } catch (IOException invalid) {
            throw new IllegalStateException("Persisted release artifact is invalid", invalid);
        }
    }

    private Map<String, Object> releaseDetailView(ReleaseRecord release) throws IOException {
        Map<String, Object> view = new LinkedHashMap<>(releaseView(release));
        view.put("manifest", json.readTree(release.manifestJson()));
        view.put("report", json.readTree(release.reportJson()));
        view.put("comparison", json.readTree(release.comparisonJson()));
        return view;
    }

    private WorkspaceState parseWorkspaceState(JsonNode body) throws IOException {
        Long projectId = nullableLong(body, "activeProjectId");
        String runId = optionalText(body, "activeScanRunId");
        Long assetId = nullableLong(body, "selectedAssetId");
        Long findingId = nullableLong(body, "selectedFindingId");
        JsonNode filters = body.has("filters") ? body.get("filters") : json.createObjectNode();
        JsonNode queue = body.has("queue") ? body.get("queue") : json.createArrayNode();
        if (!filters.isObject()) throw new IllegalArgumentException("filters must be an object");
        if (!queue.isArray()) throw new IllegalArgumentException("queue must be an array");

        if (projectId != null && localProjects.findByProjectId(projectId).isEmpty()) {
            throw new IllegalArgumentException("Unknown active project " + projectId);
        }
        if (runId != null) {
            if (projectId == null) throw new IllegalArgumentException("A scan requires an active project");
            ScanRun run = scans.findById(runId)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown active scan " + runId));
            if (run.projectId() != projectId) throw new IllegalArgumentException("Scan does not belong to project");
        }
        if (assetId != null) {
            if (runId == null) throw new IllegalArgumentException("A selected asset requires an active scan");
            ScanAsset asset = scans.findAsset(assetId)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown selected asset " + assetId));
            if (!runId.equals(asset.scanRunId())) throw new IllegalArgumentException("Asset does not belong to scan");
        }
        if (findingId != null) {
            if (assetId == null) throw new IllegalArgumentException("A selected finding requires a selected asset");
            var finding = scans.findFinding(findingId)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown selected finding " + findingId));
            if (finding.scanAssetId() != assetId) {
                throw new IllegalArgumentException("Finding does not belong to selected asset");
            }
        }
        return new WorkspaceState(projectId, runId, assetId, findingId,
                json.writeValueAsString(filters), json.writeValueAsString(queue), java.time.Instant.now());
    }

    private Map<String, Object> workspaceView(WorkspaceState state) throws IOException {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("activeProjectId", state == null ? null : state.activeProjectId());
        view.put("activeScanRunId", state == null ? null : state.activeScanRunId());
        view.put("selectedAssetId", state == null ? null : state.selectedAssetId());
        view.put("selectedFindingId", state == null ? null : state.selectedFindingId());
        view.put("filters", state == null ? json.createObjectNode() : json.readTree(state.filtersJson()));
        view.put("queue", state == null ? json.createArrayNode() : json.readTree(state.queueJson()));
        view.put("updatedAt", state == null ? null : state.updatedAt());
        return view;
    }

    private Map<String, Object> animationComparisonView(AnimationComparisonRecord record) throws IOException {
        JsonNode result = json.readTree(record.resultJson());
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", record.id());
        view.put("projectId", record.projectId());
        view.put("sourceAssetId", record.sourceAssetId());
        view.put("candidateAssetId", record.candidateAssetId());
        view.put("sourceName", record.sourceName());
        view.put("candidateName", record.candidateName());
        view.put("sourceDuration", record.sourceDuration());
        view.put("candidateDuration", record.candidateDuration());
        view.put("sourceFingerprint", record.sourceFingerprint());
        view.put("candidateFingerprint", record.candidateFingerprint());
        view.put("overallPercent", record.overallScore());
        view.put("posePercent", record.poseScore());
        view.put("timingPercent", record.timingScore());
        view.put("coveragePercent", record.coverageScore());
        view.put("overallScore", record.overallScore());
        view.put("poseScore", record.poseScore());
        view.put("timingScore", record.timingScore());
        view.put("coverageScore", record.coverageScore());
        view.put("exactCurveData", record.exactCurveData());
        view.put("verdict", verdictLabel(result.path("verdict").asText("")));
        view.put("algorithmVersion", record.algorithmVersion());
        view.put("createdAt", record.createdAt());
        view.put("result", result);
        view.put("creatorFlowUrl", origin + "/#workspace?view=motion");
        return view;
    }

    private Map<String, Object> snapshotView(MotionSnapshotRecord record) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", record.id());
        view.put("projectId", record.projectId());
        view.put("assetId", record.assetId());
        view.put("kind", record.kind().wire());
        view.put("sourceComparisonId", record.sourceComparisonId());
        view.put("name", record.name());
        view.put("duration", record.duration());
        view.put("fingerprint", record.fingerprint());
        view.put("algorithmVersion", record.algorithmVersion());
        view.put("supersedesSnapshotId", record.supersedesSnapshotId());
        view.put("status", record.status().name());
        view.put("createdAt", record.createdAt());
        return view;
    }

    /** Never includes the token or its hash — only what the UI needs to list and revoke. */
    private static Map<String, Object> pluginPairingView(PluginPairingService.PairingView view) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", view.id());
        map.put("issuedAt", view.issuedAt());
        map.put("expiresAt", view.expiresAt());
        map.put("status", view.status().name());
        return map;
    }

    private static String verdictLabel(String verdict) {
        return switch (verdict) {
            case "EXACT_CURVE_DATA" -> "Exact curve data — provenance required";
            case "HIGH_SIMILARITY" -> "Strong structural match — investigate";
            case "MODERATE_SIMILARITY" -> "Substantial motion overlap";
            case "LOW_SIMILARITY" -> "Low resemblance in this comparison";
            default -> "Motion comparison recorded";
        };
    }

    private static int roundedPercent(double value) {
        return (int) Math.round(Math.max(0.0, Math.min(100.0, value)));
    }

    private PluginPairingService.Pairing requirePluginPairing(HttpExchange exchange) {
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        String token = authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)
                ? authorization.substring(7).strip() : null;
        Optional<PluginPairingService.Pairing> pairing = pluginPairings.authenticate(token);
        if (pairing.isEmpty()) {
            exchange.getResponseHeaders().set("WWW-Authenticate", "Bearer realm=\"CreatorFlow Studio bridge\"");
            throw new HttpError(401, "A valid CreatorFlow Studio pairing is required");
        }
        return pairing.orElseThrow();
    }

    private void requireSession(HttpExchange exchange) {
        String expected = sessionToken.get();
        String actual = cookies(exchange).get(COOKIE_NAME);
        if (expected == null || !constantTimeEquals(expected, actual)) {
            throw new HttpError(401, "Desktop session is required");
        }
    }

    private void requireSameOriginWhenPresent(HttpExchange exchange) {
        String requestOrigin = exchange.getRequestHeaders().getFirst("Origin");
        if (requestOrigin != null && !origin.toString().equals(requestOrigin)) {
            throw new HttpError(403, "Cross-origin requests are not allowed");
        }
    }

    private void requireMutation(HttpExchange exchange) {
        requireMethod(exchange, "POST");
        String requestOrigin = exchange.getRequestHeaders().getFirst("Origin");
        if (!origin.toString().equals(requestOrigin)) {
            throw new HttpError(403, "A same-origin Origin header is required");
        }
        String expected = csrfToken.get();
        String supplied = exchange.getRequestHeaders().getFirst("X-CreatorFlow-CSRF");
        if (expected == null || !constantTimeEquals(expected, supplied)) {
            throw new HttpError(403, "CSRF token is invalid");
        }
    }

    private static void requireMethod(HttpExchange exchange, String expected) {
        if (!expected.equals(exchange.getRequestMethod())) throw new HttpError(405, "Method not allowed");
    }

    private JsonNode readJson(HttpExchange exchange) throws IOException {
        return readJson(exchange, MAX_REQUEST_BYTES);
    }

    private JsonNode readJson(HttpExchange exchange, int maxBytes) throws IOException {
        byte[] bytes = readLimited(exchange.getRequestBody(), maxBytes);
        if (bytes.length == 0) return json.createObjectNode();
        try {
            return json.readTree(bytes);
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            throw new IllegalArgumentException("Request body must be valid JSON");
        }
    }

    private void sendJson(HttpExchange exchange, int status, Object body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        sendBytes(exchange, status, json.writeValueAsBytes(body));
    }

    private static void sendJsonArtifact(HttpExchange exchange, String exactJson,
                                         String fileName) throws IOException {
        byte[] bytes = exactJson.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + fileName + "\"");
        sendBytes(exchange, 200, bytes);
    }

    private static void sendBytes(HttpExchange exchange, int status, byte[] bytes) throws IOException {
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static byte[] readLimited(InputStream input, int max) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > max) throw new HttpError(413, "Request body is too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static String decodedPath(HttpExchange exchange) {
        try {
            String raw = exchange.getRequestURI().getRawPath();
            return URLDecoder.decode(raw.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new HttpError(400, "Invalid URL encoding");
        }
    }

    private static Map<String, String> query(String rawQuery) {
        Map<String, String> values = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isBlank()) return values;
        for (String pair : rawQuery.split("&")) {
            String[] parts = pair.split("=", 2);
            String key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
            String value = parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "";
            values.put(key, value);
        }
        return values;
    }

    private static Map<String, String> cookies(HttpExchange exchange) {
        Map<String, String> cookies = new LinkedHashMap<>();
        List<String> headers = exchange.getRequestHeaders().get("Cookie");
        if (headers == null) return cookies;
        for (String header : headers) {
            for (String cookie : header.split(";")) {
                String[] parts = cookie.strip().split("=", 2);
                if (parts.length == 2) cookies.put(parts[0], parts[1]);
            }
        }
        return cookies;
    }

    private static List<String> segments(String path) {
        List<String> segments = new ArrayList<>();
        for (String segment : path.split("/")) if (!segment.isBlank()) segments.add(segment);
        return segments;
    }

    private static String text(JsonNode body, String field, String fallback) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) return fallback;
        if (!value.isTextual() || value.asText().isBlank()) {
            throw new IllegalArgumentException(field + " must be non-blank text");
        }
        return value.asText().strip();
    }

    private static String requiredText(JsonNode body, String field) {
        String value = text(body, field, null);
        if (value == null) throw new IllegalArgumentException(field + " is required");
        return value;
    }

    private static String optionalText(JsonNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw new IllegalArgumentException(field + " must be text or null");
        return value.asText().isBlank() ? null : value.asText().strip();
    }

    private static Long nullableLong(JsonNode body, String field) {
        JsonNode value = body.get(field);
        if (value == null || value.isNull()) return null;
        if (!value.canConvertToLong() || value.asLong() < 1) {
            throw new IllegalArgumentException(field + " must be a positive integer or null");
        }
        return value.asLong();
    }

    private static String artifactName(String releaseName, String suffix) {
        String safe = releaseName.toLowerCase(java.util.Locale.ROOT)
                .replaceAll("[^a-z0-9._-]+", "-")
                .replaceAll("^-+|-+$", "");
        if (safe.isBlank()) safe = "release";
        return safe + "-" + suffix + ".json";
    }

    private static int integer(String value, int fallback) {
        if (value == null || value.isBlank()) return fallback;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Expected an integer query parameter");
        }
    }

    private static boolean constantTimeEquals(String expected, String supplied) {
        if (supplied == null) return false;
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8));
    }

    private static String secret() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static Path normalizeStaticRoot(Path root) {
        if (root == null) return null;
        try {
            Path real = root.toRealPath();
            if (!Files.isDirectory(real)) throw new IllegalArgumentException("Web root is not a directory: " + root);
            return real;
        } catch (IOException e) {
            throw new IllegalArgumentException("Web root cannot be opened: " + root, e);
        }
    }

    private static String contentType(String path) {
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json") || lower.endsWith(".gltf")) return "application/json; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".avif")) return "image/avif";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".wasm")) return "application/wasm";
        if (lower.endsWith(".glb")) return "model/gltf-binary";
        if (lower.endsWith(".bin") || lower.endsWith(".fbx") || lower.endsWith(".psd")) {
            return "application/octet-stream";
        }
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".mp4") || lower.endsWith(".mov")) return "video/mp4";
        return "application/octet-stream";
    }

    private static void addSecurityHeaders(Headers headers) {
        headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                + "font-src 'self'; media-src 'self' blob:; connect-src 'self'; "
                + "worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; "
                + "base-uri 'none'; form-action 'self'");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Referrer-Policy", "no-referrer");
        headers.set("Cross-Origin-Resource-Policy", "same-origin");
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null ? "Invalid request" : error.getMessage();
    }

    private void ensureStarted() {
        if (server == null) throw new IllegalStateException("Local bridge is not started");
    }

    @Override
    public synchronized void close() {
        if (server != null) {
            server.stop(Math.toIntExact(Duration.ofSeconds(1).toSeconds()));
            server = null;
        }
        coordinator.close();
        httpExecutor.shutdownNow();
        sessionToken.set(null);
        csrfToken.set(null);
    }

    private static final class HttpError extends RuntimeException {
        private final int status;

        private HttpError(int status, String message) {
            super(message);
            this.status = status;
        }
    }
}
