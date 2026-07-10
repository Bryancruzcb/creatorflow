package creatorflow;

import creatorflow.db.AssetRepository;
import creatorflow.db.Database;
import creatorflow.db.ProjectRepository;
import creatorflow.service.AssetImporter;
import creatorflow.service.DemoSeeder;
import creatorflow.service.LibraryPaths;
import creatorflow.service.registry.HttpRegistryClient;
import creatorflow.service.registry.RegistrySettings;
import creatorflow.verification.OriginalityEngine;

/** Wires the application graph: paths, database, repositories, engine, importer, registry. */
public final class AppContext implements AutoCloseable {

    private final LibraryPaths paths;
    private final Database database;
    private final ProjectRepository projects;
    private final AssetRepository assets;
    private final RegistrySettings registrySettings;
    private final AssetImporter importer;

    private AppContext(LibraryPaths paths) {
        this.paths = paths;
        this.database = new Database(paths.dbFile());
        this.projects = new ProjectRepository(database);
        this.assets = new AssetRepository(database);
        this.registrySettings = new RegistrySettings(paths.dataDir());
        this.importer = new AssetImporter(assets, new OriginalityEngine(), paths.libraryDir(),
                new HttpRegistryClient(registrySettings));
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

    @Override
    public void close() {
        database.close();
    }
}
