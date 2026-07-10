package creatorflow.db;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

/** Owns the SQLite connection and the schema. */
public final class Database implements AutoCloseable {

    private final Connection connection;

    public Database(Path dbFile) {
        try {
            connection = DriverManager.getConnection("jdbc:sqlite:" + dbFile);
            try (Statement st = connection.createStatement()) {
                st.execute("PRAGMA foreign_keys = ON");
            }
            createSchema();
        } catch (SQLException e) {
            throw new IllegalStateException("Could not open database at " + dbFile, e);
        }
    }

    private void createSchema() throws SQLException {
        try (Statement st = connection.createStatement()) {
            st.execute("""
                    CREATE TABLE IF NOT EXISTS projects (
                      id          INTEGER PRIMARY KEY AUTOINCREMENT,
                      name        TEXT NOT NULL UNIQUE,
                      description TEXT NOT NULL DEFAULT '',
                      created_at  TEXT NOT NULL
                    )""");
            st.execute("""
                    CREATE TABLE IF NOT EXISTS assets (
                      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                      project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                      file_name          TEXT NOT NULL,
                      stored_path        TEXT NOT NULL,
                      file_type          TEXT NOT NULL,
                      size_bytes         INTEGER NOT NULL,
                      width              INTEGER NOT NULL DEFAULT 0,
                      height             INTEGER NOT NULL DEFAULT 0,
                      sha256             TEXT NOT NULL,
                      dhash              INTEGER,
                      phash              INTEGER,
                      audio_fp           INTEGER,
                      license            TEXT NOT NULL,
                      ownership_declared INTEGER NOT NULL,
                      status             TEXT NOT NULL,
                      findings           TEXT NOT NULL DEFAULT '',
                      added_at           TEXT NOT NULL
                    )""");
            st.execute("""
                    CREATE TABLE IF NOT EXISTS asset_matches (
                      id                INTEGER PRIMARY KEY AUTOINCREMENT,
                      asset_id          INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                      matched_asset_id  INTEGER NOT NULL,
                      matched_file_name TEXT NOT NULL,
                      layer             TEXT NOT NULL,
                      distance          INTEGER NOT NULL,
                      note              TEXT NOT NULL DEFAULT ''
                    )""");
            st.execute("CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id)");
            st.execute("CREATE INDEX IF NOT EXISTS idx_assets_sha ON assets(sha256)");
            st.execute("CREATE INDEX IF NOT EXISTS idx_matches_asset ON asset_matches(asset_id)");
        }
    }

    public Connection connection() {
        return connection;
    }

    @Override
    public void close() {
        try {
            connection.close();
        } catch (SQLException e) {
            // closing on shutdown; nothing sensible left to do
        }
    }
}
