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
import creatorflow.db.OwnershipVerificationRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.OwnershipEvidence;
import creatorflow.manifest.ReleaseGate;
import creatorflow.manifest.ScanOptions;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.opencloud.RateLimitedException;
import creatorflow.service.team.TeamClient;
import creatorflow.service.team.TeamSettings;
import creatorflow.service.team.TeamStatus;
import creatorflow.motion.MotionComparisonEngine;
import creatorflow.motion.MotionComparisonEngineV2;
import creatorflow.motion.MotionComparisonRequest;
import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.NormalizedAnimation;
import creatorflow.motion.PlaybackSettings;
import creatorflow.workflow.AnimationComparisonRecord;
import creatorflow.workflow.BatchDecisionService;
import creatorflow.workflow.MotionSnapshotRecord;
import creatorflow.workflow.DecisionBatchRecord;
import creatorflow.workflow.DecisionRecord;
import creatorflow.workflow.DecisionType;
import creatorflow.workflow.GatePreview;
import creatorflow.workflow.ReviewGroups;
import creatorflow.workflow.LocalProject;
import creatorflow.workflow.OwnershipVerificationRecord;
import creatorflow.workflow.ReleaseBundle;
import creatorflow.workflow.ReleaseExportService;
import creatorflow.workflow.ReleaseRecord;
import creatorflow.workflow.ReleaseSummary;
import creatorflow.workflow.ScanAsset;
// Caught rather than IllegalStateException on every route that answers 409 for a run that is not a
// completed immutable scan: Database.transaction wraps any SQLException into an
// IllegalStateException, so the broader catch reported disk and busy failures as state conflicts.
import creatorflow.workflow.ScanNotReleasableException;
import creatorflow.workflow.ScanRun;
import creatorflow.workflow.SourceEvidenceRecord;
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
import java.time.Instant;
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
    /**
     * Whether a CURVE_SAMPLED side may be pinned as a drift-detection snapshot.
     *
     * <p>Snapshots decide UNCHANGED/CHANGED by fingerprint equality alone, so pinning a side whose
     * fingerprint wobbled run-to-run would report "this animation changed" when nothing did — the
     * worst class of output this app can produce. Phase C's Task 0 spike measured it rather than
     * assuming: 31 samples across a clip came back bit-identical twice within a run AND across a
     * full register/refetch round trip, live in Studio on 2026-08-02
     * (docs/superpowers/plans/2026-08-01-phaseC-task0-spike-note.md, §4). Sampling is
     * deterministic, so this ships {@code true} — a known-safe capability does not ship disabled.
     *
     * <p>It stays a constant rather than disappearing: if that confidence is ever invalidated (a
     * Roblox sampling change, a new interpolation path), flipping this to {@code false} re-blocks
     * pinning in one line.
     *
     * <p>The flip only blocks NEW pins — snapshot rows carry no clip kind of their own. Already-pinned
     * sampled snapshots are still identifiable: join {@code motion_snapshots.source_comparison_id} to
     * {@code animation_comparisons.id} and read {@code source_clip_kind} / {@code candidate_clip_kind}
     * for the side the snapshot's {@code asset_id} matches. That is the recovery path for auditing or
     * retiring existing rows after a flip; it is a query, not a column, until one is needed.
     *
     * <p>Scope of the evidence behind {@code true}: ONE fixture, on ONE Studio version, on one machine
     * (spike note §4). That is enough to ship, not enough to stop watching. Roblox updates Studio's
     * animation stack on its own schedule, and a curve evaluator change would show up here as pinned
     * sampled snapshots reporting CHANGED on untouched assets. Re-run the spike's serialize-and-compare
     * check after a Studio update before trusting a CHANGED verdict on a sampled snapshot.
     */
    private static final boolean CURVE_SAMPLED_SNAPSHOTS_ALLOWED = true;
    private static final Pattern PROJECT_SCANS = Pattern.compile("^/api/v1/projects/(\\d+)/scan-runs$");
    private static final Pattern PROJECT_ASSETS = Pattern.compile("^/api/v1/projects/(\\d+)/assets$");
    private static final Pattern PROJECT_RELEASES = Pattern.compile("^/api/v1/projects/(\\d+)/releases$");
    private static final Pattern PROJECT_GATE_PREVIEW = Pattern.compile("^/api/v1/projects/(\\d+)/gate-preview$");
    private static final Pattern PROJECT_PLUGIN_PAIRING = Pattern.compile("^/api/v1/projects/(\\d+)/plugin-pairings$");
    private static final Pattern PROJECT_PLUGIN_PAIRING_REVOKE =
            Pattern.compile("^/api/v1/projects/(\\d+)/plugin-pairings/([a-f0-9-]+)/revoke$");
    private static final Pattern PROJECT_EXPERIENCE = Pattern.compile("^/api/v1/projects/(\\d+)/experience$");
    private static final Pattern PROJECT_MOTION_COMPARISONS = Pattern.compile("^/api/v1/projects/(\\d+)/motion-comparisons$");
    private static final Pattern PROJECT_ANIMATION_SNAPSHOTS = Pattern.compile("^/api/v1/projects/(\\d+)/animation-snapshots$");
    private static final Pattern SCAN = Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)$");
    private static final Pattern SCAN_EVENTS = Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/events$");
    private static final Pattern SCAN_CANCEL = Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/cancel$");
    // Scoped to a scan run rather than a project: a group is only meaningful against one immutable
    // snapshot, and every id in a batch is a scan asset id belonging to it.
    private static final Pattern SCAN_REVIEW_GROUPS =
            Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/review-groups$");
    private static final Pattern SCAN_BATCH_DECISIONS =
            Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/batch-decisions$");
    private static final Pattern SCAN_BATCH_SOURCE_EVIDENCE =
            Pattern.compile("^/api/v1/scan-runs/([a-f0-9-]+)/batch-source-evidence$");
    private static final Pattern ASSET = Pattern.compile("^/api/v1/assets/(\\d+)$");
    private static final Pattern ASSET_DECISIONS = Pattern.compile("^/api/v1/assets/(\\d+)/decisions$");
    private static final Pattern ASSET_EVIDENCE = Pattern.compile("^/api/v1/assets/(\\d+)/source-evidence$");
    private static final Pattern ASSET_VERIFY_OWNERSHIP =
            Pattern.compile("^/api/v1/assets/(\\d+)/verify-ownership$");
    private static final Pattern ASSET_OWNERSHIP_VERIFICATIONS =
            Pattern.compile("^/api/v1/assets/(\\d+)/ownership-verifications$");
    private static final Pattern RELEASE_MANIFEST = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)/manifest$");
    private static final Pattern RELEASE_REPORT = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)/report$");
    private static final Pattern RELEASE_PUBLISHED_VERSION = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)/published-version$");
    private static final Pattern RELEASE = Pattern.compile("^/api/v1/releases/([a-f0-9-]+)$");
    private static final Pattern MOTION_COMPARISON = Pattern.compile("^/api/v1/motion-comparisons/([a-f0-9-]+)$");
    private static final Pattern TEAM_CLAIM_RETRACT =
            Pattern.compile("^/api/v1/team/provenance-claims/(\\d+)/retract$");
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
    private final BatchDecisionService batchDecisions;
    private final OpenCloudSettings openCloudSettings;
    private final TeamSettings teamSettings;
    private final TeamClient team;
    private final OwnershipVerification ownershipVerifier;
    private final OwnershipVerificationRepository ownershipVerifications;
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
                             ReleaseExportService releaseExports,
                             BatchDecisionService batchDecisions,
                             OpenCloudSettings openCloudSettings,
                             TeamSettings teamSettings,
                             TeamClient team,
                             OwnershipVerification ownershipVerifier,
                             OwnershipVerificationRepository ownershipVerifications,
                             ScanCoordinator coordinator,
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
        this.batchDecisions = java.util.Objects.requireNonNull(batchDecisions, "batchDecisions");
        this.openCloudSettings = java.util.Objects.requireNonNull(openCloudSettings, "openCloudSettings");
        this.teamSettings = java.util.Objects.requireNonNull(teamSettings, "teamSettings");
        this.team = java.util.Objects.requireNonNull(team, "team");
        this.ownershipVerifier = java.util.Objects.requireNonNull(ownershipVerifier, "ownershipVerifier");
        this.ownershipVerifications =
                java.util.Objects.requireNonNull(ownershipVerifications, "ownershipVerifications");
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
            /*
             * Engine v2, the same algorithm every browser surface uses (issue #102).
             *
             * This route scored on v1 until now, so a comparison submitted from Studio and the same
             * comparison run in the web UI returned different percentages — and a mirrored copy was
             * caught in the browser while staying invisible here. v1 remains in the tree as the
             * parity oracle the TypeScript port is proven against; it is no longer what a person is
             * shown. The two v2 implementations are bound by
             * frontend/src/motion/parity/v2Parity.test.ts.
             */
            var result = MotionComparisonEngineV2.compare(request);
            NormalizedAnimation source = request.source();
            NormalizedAnimation candidate = request.candidate();
            JsonNode playabilityNode = body.path("playability");
            String playabilityJson = playabilityNode.isMissingNode() || playabilityNode.isNull()
                    ? null : playabilityNode.toString();
            String sourceKind = clipKind(text(body, "sourceKind", null), "sourceKind");
            String candidateKind = clipKind(text(body, "candidateKind", null), "candidateKind");
            AnimationComparisonRecord stored = animationComparisons.insert(
                    pairing.projectId(), source.assetId(), candidate.assetId(),
                    source.name(), candidate.name(), source.duration(), candidate.duration(),
                    result.sourceFingerprint(), result.candidateFingerprint(),
                    roundedPercent(result.overallPercent()), roundedPercent(result.posePercent()),
                    roundedPercent(result.timingPercent()), roundedPercent(result.coveragePercent()),
                    result.exactCurveData(), json.writeValueAsString(result), result.engineVersion(),
                    PlaybackSettings.of(source.looped(), source.priority()),
                    PlaybackSettings.of(candidate.looped(), candidate.priority()),
                    playabilityJson, sourceKind, candidateKind);
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

    /**
     * Allow-list for a clip-provenance value, so the column can only ever hold a kind this app
     * knows how to reason about.
     *
     * <p>An allow-list rather than a check at the point of use: {@code CURVE_SAMPLED_SNAPSHOTS_ALLOWED}
     * blocks pinning by testing the stored value AGAINST the literal "CURVE_SAMPLED", so a plugin
     * sending "curve_sampled" — or any other spelling — would walk straight past that guard the day
     * it is ever flipped shut. A kill-switch that fails open is not a kill-switch. Rejecting the
     * unknown value here means the guard only has two possible inputs to reason about.
     *
     * <p>Null stays legal: plugins built before this field existed send no kind at all, and their
     * comparisons are still valid evidence.
     */
    private static String clipKind(String value, String field) {
        if (value == null) return null;
        if (!"KEYFRAME".equals(value) && !"CURVE_SAMPLED".equals(value)) {
            throw new IllegalArgumentException(field + " must be \"KEYFRAME\" or \"CURVE_SAMPLED\"");
        }
        return value;
    }

    private void routeApi(HttpExchange exchange, String path) throws IOException {
        if ("/api/v1/session".equals(path)) {
            requireMethod(exchange, "GET");
            // openCloudKeyConfigured is a BOOLEAN ONLY: whether a key exists, so the workspace can
            // disable the verify action with an honest reason instead of only failing after the
            // click (the 409 stays the fallback). The key itself never crosses this bridge — not
            // masked, not prefixed, not length-hinted. Nothing here is derived from the key value.
            sendJson(exchange, 200, Map.of(
                    "csrfToken", csrfToken.get(),
                    "origin", origin.toString(),
                    "openCloudKeyConfigured", openCloudSettings.isConfigured()));
            return;
        }
        if ("/api/v1/team".equals(path)) {
            requireMethod(exchange, "GET");
            teamStatus(exchange);
            return;
        }
        if ("/api/v1/team/provenance-lookup".equals(path)) {
            teamLookup(exchange);
            return;
        }
        if ("/api/v1/team/provenance-claims".equals(path)) {
            teamShare(exchange);
            return;
        }
        Matcher retract = TEAM_CLAIM_RETRACT.matcher(path);
        if (retract.matches()) {
            teamRetract(exchange, Long.parseLong(retract.group(1)));
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
                String requestedClipKind = "source".equalsIgnoreCase(side)
                        ? comparison.sourceClipKind().orElse(null)
                        : comparison.candidateClipKind().orElse(null);
                if (!CURVE_SAMPLED_SNAPSHOTS_ALLOWED && "CURVE_SAMPLED".equals(requestedClipKind)) {
                    throw new HttpError(400,
                            "This side was read by sampling a CurveAnimation, not an exact keyframe read. "
                                    + "Pinning it as a drift-detection reference isn't reliable yet.");
                }
                MotionSnapshotRecord snapshot = switch (side.toLowerCase(java.util.Locale.ROOT)) {
                    case "source" -> motionSnapshots.capture(projectId, comparison.sourceAssetId(), kind,
                            comparisonId, comparison.sourceName(), comparison.sourceDuration(),
                            comparison.sourceFingerprint(), comparison.algorithmVersion(),
                            comparison.sourceSettings());
                    case "candidate" -> motionSnapshots.capture(projectId, comparison.candidateAssetId(), kind,
                            comparisonId, comparison.candidateName(), comparison.candidateDuration(),
                            comparison.candidateFingerprint(), comparison.algorithmVersion(),
                            comparison.candidateSettings());
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

        // Before PROJECT_RELEASES on purpose: this is the read-only sibling of that route's POST,
        // and reading it next to the thing it previews is how it stays that way. A GET with no CSRF
        // header, like every other GET here — it evaluates the gate and writes nothing at all.
        matcher = PROJECT_GATE_PREVIEW.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            long projectId = Long.parseLong(matcher.group(1));
            LocalProject project = localProjects.findByProjectId(projectId)
                    .orElseThrow(() -> new HttpError(404, "Local project not found"));
            // Run selection mirrors the releases POST exactly, so a preview and the release built
            // moments later cannot silently pick different runs.
            String runId = query(exchange.getRequestURI().getRawQuery()).get("scanRunId");
            if (runId == null) runId = project.activeScanRunId();
            if (runId == null) runId = scans.latestForProject(projectId).map(ScanRun::id).orElse(null);
            if (runId == null) throw new HttpError(409, "Project has no scan to release");
            scans.findById(runId).orElseThrow(() -> new HttpError(404, "Scan run not found"));
            try {
                sendJson(exchange, 200, gatePreviewView(releaseExports.preview(projectId, runId)));
            } catch (ScanNotReleasableException conflict) {
                throw new HttpError(409, safeMessage(conflict));
            }
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
                } catch (ScanNotReleasableException conflict) {
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
        // The three group-review routes, all before the bare SCAN matcher exactly as SCAN_EVENTS and
        // SCAN_CANCEL are. The project is resolved from the run rather than taken from the client:
        // a batch is scoped to one immutable scan, and that is the only id it should have to hold.
        matcher = SCAN_REVIEW_GROUPS.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            ScanRun run = scans.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Scan run not found"));
            try {
                sendJson(exchange, 200, reviewGroupsView(
                        batchDecisions.reviewGroups(run.projectId(), run.id())));
            } catch (ScanNotReleasableException conflict) {
                throw new HttpError(409, safeMessage(conflict));
            }
            return;
        }

        matcher = SCAN_BATCH_DECISIONS.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            ScanRun run = scans.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Scan run not found"));
            JsonNode body = readJson(exchange);
            ReleaseGate.Code code = reviewGroupCode(body);
            DecisionType type = batchDecisionType(body);
            String rationale = requiredText(body, "rationale");
            List<BatchDecisionService.DecisionBatchEntry> entries = new ArrayList<>();
            for (JsonNode asset : batchAssets(body)) {
                entries.add(new BatchDecisionService.DecisionBatchEntry(
                        requiredAssetId(asset), optionalText(asset, "supersedesDecisionId")));
            }
            try {
                sendJson(exchange, 201, decisionBatchView(batchDecisions.recordDecisions(
                        run.projectId(), run.id(), code, type, rationale, entries)));
            } catch (BatchDecisionService.BatchDriftException drift) {
                sendJson(exchange, 409, driftView(drift));
            } catch (ScanNotReleasableException conflict) {
                throw new HttpError(409, safeMessage(conflict));
            }
            return;
        }

        matcher = SCAN_BATCH_SOURCE_EVIDENCE.matcher(path);
        if (matcher.matches()) {
            requireMutation(exchange);
            ScanRun run = scans.findById(matcher.group(1))
                    .orElseThrow(() -> new HttpError(404, "Scan run not found"));
            JsonNode body = readJson(exchange);
            ReleaseGate.Code code = reviewGroupCode(body);
            String rationale = requiredText(body, "rationale");
            List<BatchDecisionService.SourceEvidenceBatchEntry> entries = new ArrayList<>();
            for (JsonNode asset : batchAssets(body)) {
                entries.add(new BatchDecisionService.SourceEvidenceBatchEntry(
                        requiredAssetId(asset), nullableLong(asset, "latestSourceEvidenceId")));
            }
            try {
                sendJson(exchange, 201, sourceEvidenceBatchView(batchDecisions.recordSourceEvidence(
                        run.projectId(), run.id(), code, optionalText(body, "source"),
                        optionalText(body, "license"), optionalText(body, "evidenceUrl"),
                        rationale, entries)));
            } catch (BatchDecisionService.BatchDriftException drift) {
                sendJson(exchange, 409, driftView(drift));
            } catch (ScanNotReleasableException conflict) {
                throw new HttpError(409, safeMessage(conflict));
            }
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
                sendJson(exchange, 200, Map.of("items",
                        decisions.historyFor(assetId).stream().map(this::decisionView).toList()));
            } else {
                requireMutation(exchange);
                JsonNode body = readJson(exchange);
                DecisionType type = DecisionType.valueOf(requiredText(body, "type"));
                String reason = requiredText(body, "reason");
                String supersedes = text(body, "supersedesDecisionId", null);
                sendJson(exchange, 201, decisionView(supersedes == null
                        ? decisions.append(assetId, type, reason)
                        : decisions.supersede(supersedes, type, reason)));
            }
            return;
        }
        matcher = ASSET_EVIDENCE.matcher(path);
        if (matcher.matches()) {
            long assetId = Long.parseLong(matcher.group(1));
            if (scans.findAsset(assetId).isEmpty()) throw new HttpError(404, "Scan asset not found");
            if ("GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 200, Map.of("items",
                        scans.evidenceHistory(assetId).stream().map(this::sourceEvidenceView).toList()));
            } else {
                requireMutation(exchange);
                JsonNode body = readJson(exchange);
                SourceEvidence evidence = new SourceEvidence(optionalText(body, "source"),
                        optionalText(body, "license"), optionalText(body, "evidenceUrl"));
                sendJson(exchange, 201, sourceEvidenceView(scans.appendEvidence(assetId, evidence)));
            }
            return;
        }
        matcher = ASSET_VERIFY_OWNERSHIP.matcher(path);
        if (matcher.matches()) {
            verifyOwnership(exchange, Long.parseLong(matcher.group(1)));
            return;
        }
        matcher = ASSET_OWNERSHIP_VERIFICATIONS.matcher(path);
        if (matcher.matches()) {
            requireMethod(exchange, "GET");
            long assetId = Long.parseLong(matcher.group(1));
            if (scans.findAsset(assetId).isEmpty()) throw new HttpError(404, "Scan asset not found");
            sendJson(exchange, 200, Map.of("items", ownershipVerifications.historyForAsset(assetId).stream()
                    .map(LocalBridgeServer::ownershipVerificationView).toList()));
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
            response.put("sourceEvidence", scans.evidenceFor(assetId)
                    .map(this::sourceEvidenceView).orElse(null));
            response.put("latestDecision", decisions.latestFor(assetId)
                    .map(this::decisionView).orElse(null));
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

    /**
     * What this machine is connected to, and — live — how many people are in that team.
     *
     * <p>{@code keyStorageMode} is a label, and {@code configured} is a BOOLEAN ONLY: the team
     * store's API key never crosses this bridge, not masked, not prefixed, not length-hinted. That
     * is the {@code openCloudKeyConfigured} precedent, applied to the second secret this app holds.
     *
     * <p>{@code memberCount} is fetched live and is null whenever {@code status} is not
     * {@code OK} — there is no cached copy of it, because Phase E caches nothing about a team.
     */
    private void teamStatus(HttpExchange exchange) throws IOException {
        TeamClient.TeamDescription description = team.describe();
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("configured", teamSettings.isConfigured());
        view.put("baseUrl", teamSettings.baseUrl());
        view.put("teamId", teamSettings.teamId());
        view.put("teamName", teamSettings.teamName().isBlank() ? null : teamSettings.teamName());
        view.put("memberCount", description.memberCount());
        view.put("keyStorageMode", teamSettings.storageMode().name());
        view.put("status", description.status().name());
        view.put("message", description.message());
        sendJson(exchange, 200, view);
    }

    /**
     * The team lookup: one fingerprint, one team, every non-retracted claim for it.
     *
     * <p><strong>This route always answers 200, including when the store could not be reached.</strong>
     * That is the whole design, not laziness about error codes: "we asked and nobody has it" and
     * "we could not ask" are different facts, and an HTTP error carrying no body would leave the
     * UI free to render the second as the first. So the answer is always
     * {@code {status, claims}} and {@code claims} is meaningful only when {@code status} is
     * {@code OK}.
     *
     * <p>{@code algorithmVersion} is accepted and echoed back, never sent upstream and never used
     * to filter. It is the version of the fingerprint being looked up, so the UI can classify each
     * returned row against it — same version is a match, a different recognized one is "not
     * comparable", an unrecognized one is an unknown format. Doing that classification here, or on
     * the server, would mean dropping rows a person needed to see.
     */
    private void teamLookup(HttpExchange exchange) throws IOException {
        requireMutation(exchange);
        JsonNode body = readJson(exchange);
        // Normalized once, here, so the seam below is always "lowercase 64-hex" and the echoed
        // value is the same string that was actually looked up. The client validates it again —
        // it is a public entry point in its own right — but it never sees a mixed-case one.
        String fingerprint = requiredText(body, "fingerprint").toLowerCase(java.util.Locale.ROOT);
        String algorithmVersion = optionalText(body, "algorithmVersion");
        TeamClient.LookupResult result = team.lookup(fingerprint);
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("status", result.status().name());
        view.put("fingerprint", fingerprint);
        view.put("algorithmVersion", algorithmVersion);
        view.put("claims", result.claims().stream().map(LocalBridgeServer::claimView).toList());
        view.put("message", result.message());
        sendJson(exchange, 200, view);
    }

    /**
     * Shares one local snapshot's fingerprint with the team.
     *
     * <p><strong>The fingerprint, algorithm version, clip name and duration are read from the local
     * {@code motion_snapshots} row, never from the request.</strong> The browser supplies a
     * snapshot id and the optional DECLARED text a person typed, and nothing else — so the
     * frontend cannot publish a fingerprint the desktop did not compute, however the request is
     * crafted. {@code observedAt} is the snapshot's own capture time: the honest answer to "when
     * did you observe this", and DECLARED because it comes from this machine's clock.
     */
    private void teamShare(HttpExchange exchange) throws IOException {
        requireMutation(exchange);
        JsonNode body = readJson(exchange);
        String snapshotId = requiredText(body, "snapshotId");
        MotionSnapshotRecord snapshot = motionSnapshots.findById(snapshotId)
                .orElseThrow(() -> new HttpError(404, "Animation snapshot not found"));

        TeamClient.ShareResult result = team.share(new TeamClient.ShareRequest(
                snapshot.fingerprint(),
                snapshot.algorithmVersion(),
                snapshot.name(),
                snapshot.duration(),
                nullableLong(body, "robloxAssetId"),
                optionalText(body, "ownershipContext"),
                optionalText(body, "declaredSource"),
                optionalText(body, "declaredLicense"),
                optionalText(body, "declaredNote"),
                snapshot.createdAt()));

        if (result.status() != TeamStatus.OK) {
            throw teamFailure(result.status(), result.message());
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("status", result.status().name());
        view.put("claim", claimView(result.claim()));
        view.put("alreadyShared", result.alreadyShared());
        view.put("declarationsDiffer", result.declarationsDiffer());
        sendJson(exchange, result.alreadyShared() ? 200 : 201, view);
    }

    /** The kill switch. Removes a claim from future lookups; it cannot recall a copy already read. */
    private void teamRetract(HttpExchange exchange, long claimId) throws IOException {
        requireMutation(exchange);
        JsonNode body = readJson(exchange);
        String reason = requiredText(body, "reason");
        TeamClient.RetractResult result = team.retract(claimId, reason);
        if (result.status() != TeamStatus.OK) {
            throw teamFailure(result.status(), result.message());
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("status", result.status().name());
        view.put("claim", claimView(result.claim()));
        sendJson(exchange, 200, view);
    }

    /**
     * A failed write, mapped so the UI can tell a fixable refusal from an unreachable store.
     *
     * <p>Only the write paths reach here. The read path never fails the request at all — see
     * {@link #teamLookup}.
     */
    private static HttpError teamFailure(TeamStatus status, String message) {
        String text = message == null || message.isBlank()
                ? "The team provenance store could not complete that." : message;
        return switch (status) {
            case NOT_CONFIGURED -> new HttpError(409, text);
            case UNAUTHORIZED -> new HttpError(502, text);
            case REJECTED -> new HttpError(400, text);
            default -> new HttpError(503, text);
        };
    }

    /**
     * One claim as the workspace sees it.
     *
     * <p>Carries {@code algorithmVersion} verbatim so the UI classifies rather than assumes, and
     * carries no verdict, score, distance or rank — there is none to carry. The VERIFIED facts
     * (the fingerprint matched; when the server recorded it) and the DECLARED ones (everything a
     * person typed) are separate fields precisely so the UI can keep them visibly apart.
     */
    private static Map<String, Object> claimView(TeamClient.ClaimRecord claim) {
        if (claim == null) return null;
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", claim.id());
        view.put("memberUsername", claim.memberUsername());
        view.put("isYours", claim.isYours());
        // The server's own author-or-OWNER answer, carried rather than re-derived here: the
        // workspace has no idea what role this account holds, and guessing would either hide the
        // kill switch from an owner or offer it where it will 403.
        view.put("canRetract", claim.canRetract());
        view.put("algorithmVersion", claim.algorithmVersion());
        view.put("clipName", claim.clipName());
        view.put("durationSeconds", claim.durationSeconds());
        view.put("robloxAssetId", claim.robloxAssetId());
        view.put("ownershipContext", claim.ownershipContext());
        view.put("declaredSource", claim.declaredSource());
        view.put("declaredLicense", claim.declaredLicense());
        view.put("declaredNote", claim.declaredNote());
        view.put("observedAt", claim.observedAt());
        view.put("recordedAt", claim.recordedAt());
        return view;
    }

    /**
     * The single live Open Cloud call site. Verifies who created the animation {@code robloxAssetId}
     * (supplied in the request body) against who owns the scan asset's bound experience, persists the
     * observation to the insert-only ledger, and returns the stored view. Honesty is load-bearing:
     * <ul>
     *   <li>No configured key ⇒ 409 (nothing can be verified yet) — never a false result.</li>
     *   <li>A rate-limit (429) is surfaced distinctly with a retry hint, not folded into a failure.</li>
     *   <li>Any other API failure becomes a persisted {@code UNVERIFIABLE} (the verifier's job),
     *       never a false {@code VERIFIED}.</li>
     * </ul>
     * Export never reaches here — it reads persisted rows only, keeping the manifest deterministic.
     */
    private void verifyOwnership(HttpExchange exchange, long assetId) throws IOException {
        requireMutation(exchange);
        ScanAsset asset = scans.findAsset(assetId)
                .orElseThrow(() -> new HttpError(404, "Scan asset not found"));
        if (!openCloudSettings.isConfigured()) {
            throw new HttpError(409, "Add a Roblox Open Cloud API key in Settings before verifying ownership.");
        }
        ScanRun run = scans.findById(asset.scanRunId())
                .orElseThrow(() -> new HttpError(404, "Scan run not found"));
        LocalProject project = localProjects.findByProjectId(run.projectId())
                .orElseThrow(() -> new HttpError(404, "Local project not found"));

        // The animation id is DECLARED: it comes from the request body, i.e. a person typed it into
        // the ownership panel while looking at this file. CreatorFlow cannot derive a Roblox asset id
        // from a scanned file, so nothing here ties the two together beyond that human claim — which
        // is why the persisted row and every view of it carry an explicit assetIdSource.
        JsonNode body = readJson(exchange);
        Long robloxAssetId = nullableLong(body, "robloxAssetId");
        Long universeId = project.universeId();
        if (robloxAssetId == null || universeId == null) {
            // A point-in-time ownership check needs both a real Roblox animation id to look up and a
            // bound experience to check its creator against. Missing either is a precondition failure,
            // not a bad request.
            throw new HttpError(404,
                    "This asset needs an animation id and a bound experience to verify ownership.");
        }

        OwnershipEvidence evidence;
        try {
            evidence = ownershipVerifier.verify(robloxAssetId, universeId, Instant.now());
        } catch (RateLimitedException rateLimited) {
            Map<String, Object> retry = new LinkedHashMap<>();
            retry.put("error", "Roblox Open Cloud is rate-limiting requests. Wait a moment and try again.");
            if (rateLimited.retryAfter() != null) {
                retry.put("retryAfterSeconds", rateLimited.retryAfter().toSeconds());
            }
            sendJson(exchange, 429, retry);
            return;
        }
        OwnershipVerificationRecord record = ownershipVerifications.insert(assetId, universeId, evidence);
        sendJson(exchange, 201, ownershipVerificationView(record));
    }

    /**
     * The persisted verification as the UI sees it: the parsed facts and nothing else. It never
     * carries the API key, and there is no raw upstream body to leak — the ledger stores only the
     * facts it parsed.
     *
     * <p>Carries {@code assetIdSource} so the UI renders the file-to-animation link honestly: the
     * ownership facts are CreatorFlow's own, but the id they are about was typed in by a person.
     */
    private static Map<String, Object> ownershipVerificationView(OwnershipVerificationRecord record) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", record.id());
        view.put("scanAssetId", record.scanAssetId());
        view.put("robloxAssetId", record.robloxAssetId());
        view.put("assetIdSource", record.assetIdSource());
        view.put("universeId", record.universeId());
        view.put("creatorType", record.creatorType());
        view.put("creatorId", record.creatorId());
        view.put("assetType", record.assetType());
        view.put("moderationState", record.moderationState());
        view.put("ownerType", record.ownerType());
        view.put("ownerId", record.ownerId());
        view.put("memberRank", record.memberRank());
        view.put("outcome", record.outcome().name());
        view.put("verified", record.verified());
        view.put("checkedAt", record.checkedAt());
        return view;
    }

    /**
     * Where an event stream should resume from.
     *
     * <p>The stream labels every event with an {@code id:} line, which exists so a dropped
     * connection can pick up where it left off. A browser's {@code EventSource} reconnects by
     * re-requesting the <em>same URL</em> — so any {@code ?after=} it originally carried is stale —
     * and puts its position in the {@code Last-Event-ID} header instead. Reading only the query
     * parameter meant every reconnect restarted at 0 and replayed the whole buffer (capped at
     * {@code MAX_REPLAY_EVENTS}), so the header wins when present.
     */
    private static long resumeFrom(HttpExchange exchange) {
        String lastEventId = exchange.getRequestHeaders().getFirst("Last-Event-ID");
        if (lastEventId != null && !lastEventId.isBlank()) {
            try {
                long parsed = Long.parseLong(lastEventId.strip());
                if (parsed > 0) return parsed;
            } catch (NumberFormatException ignored) {
                // A malformed header is not worth failing the stream over: fall through to
                // ?after=, and to a full replay if that is absent too.
            }
        }
        return integer(query(exchange.getRequestURI().getRawQuery()).get("after"), 0);
    }

    private void streamEvents(HttpExchange exchange, String runId) throws IOException {
        scans.findById(runId).orElseThrow(() -> new HttpError(404, "Scan run not found"));
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Accel-Buffering", "no");
        exchange.sendResponseHeaders(200, 0);
        long last = resumeFrom(exchange);
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

    /**
     * The gate's own report, plus one added field: {@code scanAssetId}.
     *
     * <p>That field is the entire reason this route exists rather than the workspace parsing the
     * downloadable {@code gate-report.json}. The gate is keyed by manifest {@code path}; every
     * decision affordance in the workspace is keyed by a numeric scan-asset id; and the assets list
     * is paged (100 default, 500 max), so a browser cannot reliably resolve a path to an id on a
     * large project. The mapping is done here, from the same {@code listAllAssets} the export walks.
     *
     * <p>An unmapped path emits {@code null}, never a guess — a wrong id would put a person's
     * decision on the wrong file. A path that somehow appears twice in one run is treated the same
     * way: {@link Map#merge} removes the entry when the remapping function returns {@code null}, so
     * an ambiguous path resolves to nothing rather than to whichever row was seen first.
     *
     * <p>The field is {@code path} here and {@code assetPath} in a manifest's embedded gate block
     * ({@code CreativeManifest.Gate.Reason}). That split is deliberate and stays: this is a report,
     * so it uses the report's name. Unifying them would be a schema change.
     *
     * <p>The mapping itself lives in {@link ScanRepository#assetIdsByPath} because the review-groups
     * route needs the identical translation; two copies would be two chances to disagree about which
     * file a person's decision lands on.
     */
    private Map<String, Object> gatePreviewView(GatePreview preview) {
        Map<String, Long> assetIdsByPath = scans.assetIdsByPath(preview.scanRunId());
        List<Map<String, Object>> violations = preview.report().violations().stream()
                .map(violation -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("code", violation.code().name());
                    row.put("path", violation.path());
                    row.put("verification", violation.verification().name());
                    row.put("decision", violation.decision().name());
                    row.put("message", violation.message());
                    row.put("scanAssetId", assetIdsByPath.get(violation.path()));
                    return row;
                })
                .toList();
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("scanRunId", preview.scanRunId());
        view.put("release", preview.releaseName());
        // Wall-clock, and it lives only in this response: a preview is a point-in-time check, and
        // nothing here is ever written into an exported artifact (those stay derived from the
        // scan's completedAt so re-exports stay byte-identical).
        view.put("evaluatedAt", preview.report().evaluatedAt());
        view.put("passed", preview.report().passed());
        view.put("summary", preview.report().summary());
        view.put("violations", violations);
        return view;
    }

    /**
     * The gate's violations bucketed by rule, plus, per group, the short list of actions that may be
     * batched on it.
     *
     * <p>{@code batchableActions} is served rather than inferred by the client for one reason: the
     * same table decides what the panel renders and what every write accepts
     * ({@link BatchDecisionService#batchableActions}), so a UI that offered something the server
     * refuses — or hid something it allows — would be a bug in one place rather than a disagreement
     * between two. An empty list is a refusal, and {@code BLOCKED_DECISION} always has one.
     *
     * <p>Each asset carries {@code latestDecisionId} and {@code latestSourceEvidenceId}. They are not
     * decoration: a batch request echoes them back, and the server rejects the whole batch if
     * anything moved meanwhile. It also carries {@code alsoStandingCodes}, the other rules the same
     * file is standing under, because excluding is asset-level at the gate — a file standing
     * elsewhere cannot be batch-excluded, and the panel has to be able to say why.
     */
    private static Map<String, Object> reviewGroupsView(ReviewGroups groups) {
        List<Map<String, Object>> rendered = groups.groups().stream()
                .map(group -> {
                    Map<String, Object> view = new LinkedHashMap<>();
                    view.put("code", group.code());
                    view.put("message", group.message());
                    view.put("batchableActions", group.batchableActions());
                    view.put("assets", group.assets().stream().map(asset -> {
                        Map<String, Object> row = new LinkedHashMap<>();
                        row.put("scanAssetId", asset.scanAssetId());
                        row.put("relativePath", asset.relativePath());
                        row.put("fileName", asset.fileName());
                        row.put("fileType", asset.fileType());
                        row.put("sha256", asset.sha256());
                        row.put("verification", asset.verification());
                        row.put("decision", asset.decision());
                        row.put("message", asset.message());
                        row.put("latestDecisionId", asset.latestDecisionId());
                        row.put("latestSourceEvidenceId", asset.latestSourceEvidenceId());
                        // The other rules this same file is standing under. The panel needs them to
                        // show why a file cannot be batch-excluded; the refusal itself is enforced
                        // server-side regardless of what the panel renders.
                        row.put("alsoStandingCodes", asset.alsoStandingCodes());
                        return row;
                    }).toList());
                    return view;
                })
                .toList();
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("scanRunId", groups.scanRunId());
        view.put("gateResult", groups.passed() ? "PASS" : "BLOCKED");
        view.put("evaluatedAt", groups.evaluatedAt());
        view.put("groups", rendered);
        return view;
    }

    /**
     * The receipt for a decision batch: the batch row, and every per-asset decision it wrote.
     *
     * <p>The decisions are returned in full, all of them, because the count is the honest headline
     * of what just happened — {@code assetCount} decisions were recorded, each with its own id and
     * its own place in that file's history, all carrying this one rationale.
     */
    private Map<String, Object> decisionBatchView(BatchDecisionService.DecisionBatchResult result) {
        Map<String, Object> view = batchView(result.batch());
        view.put("decisions", result.decisions().stream().map(this::decisionView).toList());
        return view;
    }

    private Map<String, Object> sourceEvidenceBatchView(
            BatchDecisionService.SourceEvidenceBatchResult result) {
        Map<String, Object> view = batchView(result.batch());
        view.put("sourceEvidence", result.evidence().stream().map(this::sourceEvidenceView).toList());
        return view;
    }

    /**
     * One decision as every reader of a file's history sees it: the record, plus how big the batch it
     * came from was.
     *
     * <p>{@code batchAssetCount} exists so the marker can say "recorded as part of a 12-file batch"
     * rather than only "part of a batch". That number is the disclosure — it is what tells a reader
     * this judgement was one of twelve made in one act, which is precisely what an undisclosed batch
     * hides. Null when the decision was made one file at a time, and also when the batch row cannot
     * be read: an honest unknown, never a guessed 1.
     */
    private Map<String, Object> decisionView(DecisionRecord decision) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", decision.id());
        view.put("scanAssetId", decision.scanAssetId());
        view.put("type", decision.type().name());
        view.put("reason", decision.reason());
        view.put("supersedesDecisionId", decision.supersedesDecisionId());
        view.put("createdAt", decision.createdAt());
        view.put("batchId", decision.batchId());
        view.put("batchAssetCount", batchAssetCount(decision.batchId()));
        return view;
    }

    /** The same disclosure for a source declaration made over several files at once. */
    private Map<String, Object> sourceEvidenceView(SourceEvidenceRecord evidence) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", evidence.id());
        view.put("scanAssetId", evidence.scanAssetId());
        view.put("source", evidence.source());
        view.put("license", evidence.license());
        view.put("evidenceUrl", evidence.evidenceUrl());
        view.put("resolved", evidence.resolved());
        view.put("recordedAt", evidence.recordedAt());
        view.put("batchId", evidence.batchId());
        view.put("batchAssetCount", batchAssetCount(evidence.batchId()));
        return view;
    }

    private Integer batchAssetCount(String batchId) {
        return batchDecisions.findBatch(batchId).map(DecisionBatchRecord::assetCount).orElse(null);
    }

    private static Map<String, Object> batchView(DecisionBatchRecord batch) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("batchId", batch.id());
        view.put("scanRunId", batch.scanRunId());
        view.put("kind", batch.kind().name());
        view.put("code", batch.groupCode());
        view.put("action", batch.action());
        view.put("rationale", batch.rationale());
        view.put("assetCount", batch.assetCount());
        view.put("createdAt", batch.createdAt());
        return view;
    }

    /** A rejected batch: the reason, and exactly which files moved. Nothing was written. */
    private static Map<String, Object> driftView(BatchDecisionService.BatchDriftException drift) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("error", drift.getMessage());
        view.put("driftedAssetIds", drift.driftedAssetIds());
        return view;
    }

    private static ReleaseGate.Code reviewGroupCode(JsonNode body) {
        String value = requiredText(body, "code");
        for (ReleaseGate.Code code : ReleaseGate.Code.values()) {
            if (code.name().equals(value)) return code;
        }
        throw new IllegalArgumentException("code must be one of the release gate's own violation codes");
    }

    /**
     * The requested decision type, parsed but not yet vetted — {@link BatchDecisionService} owns the
     * allow-list, so there is exactly one place that decides what may be batched.
     */
    private static DecisionType batchDecisionType(JsonNode body) {
        String value = requiredText(body, "type");
        for (DecisionType type : DecisionType.values()) {
            if (type.name().equals(value)) return type;
        }
        throw new IllegalArgumentException("type must be a decision type");
    }

    private static JsonNode batchAssets(JsonNode body) {
        JsonNode assets = body.get("assets");
        if (assets == null || !assets.isArray()) {
            throw new IllegalArgumentException("assets must be an array of files to batch");
        }
        // Bounded here as well as in the service so a hostile payload cannot make the bridge build a
        // huge entry list before the cap is applied. MAX_REQUEST_BYTES already bounds the body.
        if (assets.size() > BatchDecisionService.MAX_BATCH_ASSETS) {
            throw new IllegalArgumentException("A batch is capped at "
                    + BatchDecisionService.MAX_BATCH_ASSETS + " files so the set stays something a"
                    + " person can actually look at — narrow it and do it in passes");
        }
        return assets;
    }

    private static long requiredAssetId(JsonNode asset) {
        if (!asset.isObject()) throw new IllegalArgumentException("Each batched file must be an object");
        Long assetId = nullableLong(asset, "scanAssetId");
        if (assetId == null) throw new IllegalArgumentException("scanAssetId is required for every batched file");
        return assetId;
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
        /*
         * "These two match" and "these two match once you mirror one of them" are different claims
         * (issue #104), so the flag travels to whoever reads the record — including the Studio
         * plugin, which otherwise reports a mirrored match as a plain one.
         *
         * Read from the stored result JSON rather than a column: v1 records predate the concept
         * entirely, and absent-means-false is the right reading for them.
         */
        view.put("mirrored", result.path("mirrored").asBoolean(false));
        view.put("algorithmVersion", record.algorithmVersion());
        view.put("createdAt", record.createdAt());
        record.playabilityJson().ifPresent(raw -> {
            try {
                view.put("playability", json.readTree(raw));
            } catch (IOException error) {
                throw new IllegalStateException("Stored playability JSON is invalid", error);
            }
        });
        record.sourceClipKind().ifPresent(kind -> view.put("sourceKind", kind));
        record.candidateClipKind().ifPresent(kind -> view.put("candidateKind", kind));
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
