package creatorflow;

import creatorflow.db.AssetRepository;
import creatorflow.db.AnimationComparisonRepository;
import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionBatchRepository;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.MotionSnapshotRepository;
import creatorflow.db.OwnershipVerificationRepository;
import creatorflow.db.PluginPairingRepository;
import creatorflow.db.ProjectRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.bridge.JavaFxProjectPicker;
import creatorflow.bridge.LocalBridgeServer;
import creatorflow.bridge.OwnershipVerification;
import creatorflow.bridge.PluginPairingService;
import creatorflow.bridge.ScanCoordinator;
import creatorflow.service.AssetImporter;
import creatorflow.service.DemoSeeder;
import creatorflow.service.LibraryPaths;
import creatorflow.service.opencloud.OpenCloudClient;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.opencloud.OwnershipVerifier;
import creatorflow.service.team.HttpTeamClient;
import creatorflow.service.team.TeamSettings;
import creatorflow.verification.OriginalityEngine;
import creatorflow.workflow.BatchDecisionService;
import creatorflow.workflow.ReleaseExportService;
import java.nio.file.Path;
import java.util.function.Supplier;
import javafx.stage.Window;

/** Wires the application graph: paths, database, repositories, engine, importer, team store. */
public final class AppContext implements AutoCloseable {

    private final LibraryPaths paths;
    private final Database database;
    private final ProjectRepository projects;
    private final AssetRepository assets;
    private final TeamSettings teamSettings;
    private final OpenCloudSettings openCloudSettings;
    private final AssetImporter importer;
    private final LocalProjectRepository localProjects;
    private final ScanRepository scans;
    private final DecisionRepository decisions;
    private final ReleaseRepository releases;
    private final AuditRepository audit;
    private final WorkspaceStateRepository workspaceState;
    private final AnimationComparisonRepository animationComparisons;
    private final MotionSnapshotRepository motionSnapshots;
    private final PluginPairingService pluginPairings;
    private final ReleaseExportService releaseExports;
    private final BatchDecisionService batchDecisions;
    private final OwnershipVerificationRepository ownershipVerifications;
    private LocalBridgeServer bridge;

    private AppContext(LibraryPaths paths) {
        this.paths = paths;
        this.database = new Database(paths.dbFile());
        this.projects = new ProjectRepository(database);
        this.assets = new AssetRepository(database);
        this.teamSettings = new TeamSettings(paths.dataDir());
        this.openCloudSettings = new OpenCloudSettings(paths.dataDir());
        /*
         * The importer no longer carries a community-registry client.
         *
         * That client can no longer be configured from anywhere in the UI — the Settings card it
         * lived on is now the team provenance store — and the legacy routes it calls are off by
         * default on a Phase E server. A machine with a leftover registry.properties would
         * therefore have added "Community registry unreachable" to the findings of every single
         * import, forever. The code stays in service/registry (dormant, still exercised by
         * RegistryEscalationTest through its own injected clients); its status noise does not.
         */
        this.importer = new AssetImporter(assets, new OriginalityEngine(), paths.libraryDir());
        this.localProjects = new LocalProjectRepository(database);
        this.scans = new ScanRepository(database);
        this.decisions = new DecisionRepository(database);
        this.releases = new ReleaseRepository(database);
        this.audit = new AuditRepository(database);
        this.workspaceState = new WorkspaceStateRepository(database);
        this.animationComparisons = new AnimationComparisonRepository(database);
        this.motionSnapshots = new MotionSnapshotRepository(database);
        this.pluginPairings = new PluginPairingService(new PluginPairingRepository(database));
        this.ownershipVerifications = new OwnershipVerificationRepository(database);
        this.releaseExports = new ReleaseExportService(database, localProjects, scans, decisions,
                releases, audit, ownershipVerifications);
        this.batchDecisions = new BatchDecisionService(database, scans, decisions,
                new DecisionBatchRepository(database), audit, releaseExports);
    }

    public static AppContext create() {
        return new AppContext(new LibraryPaths().ensure());
    }

    /** Demo data helps first-run demos and screenshot generation; never touches a non-empty library. */
    public void seedDemoIfRequested() {
        boolean requested = Boolean.getBoolean(DemoSeeder.DEMO_PROPERTY)
                || System.getProperty("creatorflow.screenshot.dir") != null;
        if (requested) {
            new DemoSeeder(projects, assets, importer, paths.dataDir()).seedIfEmpty();
        }
    }

    public LibraryPaths paths() {
        return paths;
    }

    public ProjectRepository projects() {
        return projects;
    }

    public AssetRepository assets() {
        return assets;
    }

    public AssetImporter importer() {
        return importer;
    }

    public TeamSettings teamSettings() {
        return teamSettings;
    }

    public OpenCloudSettings openCloudSettings() {
        return openCloudSettings;
    }

    public synchronized LocalBridgeServer startLocalBridge(Supplier<Window> owner) {
        if (bridge != null) return bridge;
        String webRootValue = System.getProperty(LocalBridgeServer.WEB_ROOT_PROPERTY);
        Path webRoot = webRootValue == null || webRootValue.isBlank() ? null : Path.of(webRootValue);
        ScanCoordinator coordinator = new ScanCoordinator(scans, localProjects, audit);
        // The verifier owns the only live Open Cloud HTTP client; the bridge holds it behind the
        // narrow OwnershipVerification seam so the verify route is the single live-call site.
        OwnershipVerification ownershipVerifier =
                new OwnershipVerifier(new OpenCloudClient(openCloudSettings))::verify;
        // The team client is the only outbound path to a provenance store, exactly as
        // OpenCloudClient is the only outbound path to Roblox: the React workspace talks to
        // 127.0.0.1 and nothing else.
        bridge = new LocalBridgeServer(new JavaFxProjectPicker(owner), localProjects, scans,
                decisions, releases, workspaceState, animationComparisons, motionSnapshots,
                pluginPairings, releaseExports, batchDecisions, openCloudSettings, teamSettings,
                new HttpTeamClient(teamSettings), ownershipVerifier,
                ownershipVerifications, coordinator, webRoot).start();
        return bridge;
    }

    public ScanRepository scans() {
        return scans;
    }

    public DecisionRepository decisions() {
        return decisions;
    }

    public ReleaseRepository releases() {
        return releases;
    }

    public WorkspaceStateRepository workspaceState() {
        return workspaceState;
    }

    public ReleaseExportService releaseExports() {
        return releaseExports;
    }

    @Override
    public void close() {
        if (bridge != null) {
            bridge.close();
            bridge = null;
        }
        database.close();
    }
}
