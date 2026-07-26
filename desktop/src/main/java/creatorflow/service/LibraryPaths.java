package creatorflow.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Where CreatorFlow keeps its data. Defaults to {@code ~/.creatorflow};
 * override with {@code -Dcreatorflow.data.dir=...} (used by tests, demo mode
 * and screenshot generation to keep the real library untouched).
 */
public final class LibraryPaths {

    public static final String DATA_DIR_PROPERTY = "creatorflow.data.dir";

    private final Path dataDir;

    public LibraryPaths() {
        String override = System.getProperty(DATA_DIR_PROPERTY);
        this.dataDir = override != null && !override.isBlank()
                ? Path.of(override)
                : Path.of(System.getProperty("user.home"), ".creatorflow");
    }

    public LibraryPaths(Path dataDir) {
        this.dataDir = dataDir;
    }

    public LibraryPaths ensure() {
        try {
            Files.createDirectories(libraryDir());
        } catch (IOException e) {
            throw new IllegalStateException("Could not create data directory " + dataDir, e);
        }
        return this;
    }

    public Path dataDir() {
        return dataDir;
    }

    public Path dbFile() {
        return dataDir.resolve("creatorflow.db");
    }

    public Path libraryDir() {
        return dataDir.resolve("library");
    }
}
