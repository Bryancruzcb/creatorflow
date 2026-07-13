package creatorflow;

import creatorflow.db.AssetRepository;
import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.ProjectRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.db.WorkspaceStateRepository;
import creatorflow.bridge.JavaFxProjectPicker;
import creatorflow.bridge.LocalBridgeServer;
import creatorflow.bridge.ScanCoordinator;
import creatorflow.service.AssetImporter;
import creatorflow.service.DemoSeeder;
import creatorflow.service.LibraryPaths;
import creatorflow.service.registry.HttpRegistryClient;
import creatorflow.service.registry.RegistrySettings;
import creatorflow.verification.OriginalityEngine;
import creatorflow.workflow.ReleaseExportService;
import java.nio.file.Path;
import java.util.function.Supplier;
import javafx.stage.Window;

/** Wires the application graph: paths, database, repositories, engine, importer, registry. */
public final class AppContext implements AutoCloseable {

    private final LibraryPaths paths;
    private final Database database;
    private final ProjectRepository projects;
    private final AssetRepository assets;
    private final RegistrySettings registrySettings;
    private final AssetImporter importer;
    private final LocalProjectRepository localProjects;
    private final ScanRepository scans;
    private final DecisionRepository decisions;
    private final ReleaseRepository releases;
    private final AuditRepository audit;
    private final WorkspaceStateRepository workspaceState;
    private final ReleaseExportService releaseExports;
    private LocalBridgeServer bridge;

    private AppContext(LibraryPaths paths) {
        this.paths = paths;
        this.database = new Database(paths.dbFile());
        this.projects = new ProjectRepository(database);
        this.assets = new AssetRepository(database);
        this.registrySettings = new RegistrySettings(paths.dataDir());
        this.importer = new AssetImporter(assets, new OriginalityEngine(), paths.libraryDir(),
                new HttpRegistryClient(registrySettings));
        this.localProjects = new LocalProjectRepository(database);
        this.scans = new ScanRepository(database);
        this.decisions = new DecisionRepository(database);
        this.releases = new ReleaseRepository(database);
        this.audit = new AuditRepository(database);
        this.workspaceState = new WorkspaceStateRepository(database);
        this.releaseExports = new ReleaseExportService(database, localProjects, scans, decisions,
                releases, audit);
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

    public RegistrySettings registrySettings() {
        return registrySettings;
    }

    public synchronized LocalBridgeServer startLocalBridge(Supplier<Window> owner) {
        if (bridge != null) return bridge;
        Path webRoot = System.getProperty(LocalBridgeServer.WEB_ROOT_PROPERTY) == null
                ? null : Path.of(System.getProperty(LocalBridgeServer.WEB_ROOT_PROPERTY));
        ScanCoordinator coordinator = new ScanCoordinator(scans, localProjects, audit);
        bridge = new LocalBridgeServer(new JavaFxProjectPicker(owner), localProjects, scans,
                decisions, releases, workspaceState, releaseExports, coordinator, webRoot).start();
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
