package creatorflow.db;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;

/** Minimal transactional migration runner for the desktop-owned SQLite database. */
final class SchemaMigrator {

    private static final List<Migration> MIGRATIONS = List.of(
            new Migration(1, "legacy_library", "/creatorflow/db/migrations/V001__legacy_library.sql"),
            new Migration(2, "local_workflow", "/creatorflow/db/migrations/V002__local_workflow.sql"),
            new Migration(3, "workspace_state", "/creatorflow/db/migrations/V003__workspace_state.sql"),
            new Migration(4, "release_artifacts", "/creatorflow/db/migrations/V004__release_artifacts.sql"));

    private final Connection connection;

    SchemaMigrator(Connection connection) {
        this.connection = connection;
    }

    void migrate() throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                      version      INTEGER PRIMARY KEY,
                      description  TEXT NOT NULL,
                      applied_at   TEXT NOT NULL
                    )""");
        }

        int current = currentVersion();
        for (Migration migration : MIGRATIONS) {
            if (migration.version() > current) {
                apply(migration);
            }
        }
    }

    private int currentVersion() throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(
                     "SELECT COALESCE(MAX(version), 0) FROM schema_migrations")) {
            return result.next() ? result.getInt(1) : 0;
        }
    }

    private void apply(Migration migration) throws SQLException {
        boolean previousAutoCommit = connection.getAutoCommit();
        connection.setAutoCommit(false);
        try {
            for (String sql : statements(readResource(migration.resource()))) {
                try (Statement statement = connection.createStatement()) {
                    statement.execute(sql);
                }
            }
            try (PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO schema_migrations(version, description, applied_at) VALUES (?, ?, ?)")) {
                statement.setInt(1, migration.version());
                statement.setString(2, migration.description());
                statement.setString(3, Instant.now().toString());
                statement.executeUpdate();
            }
            connection.commit();
        } catch (SQLException | RuntimeException e) {
            connection.rollback();
            if (e instanceof SQLException sqlException) throw sqlException;
            throw e;
        } finally {
            connection.setAutoCommit(previousAutoCommit);
        }
    }

    private static String readResource(String resource) {
        try (InputStream input = SchemaMigrator.class.getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing migration resource " + resource);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Could not read migration resource " + resource, e);
        }
    }

    /** Migrations intentionally avoid triggers and semicolons inside string literals. */
    private static List<String> statements(String script) {
        String withoutComments = script.lines()
                .filter(line -> !line.stripLeading().startsWith("--"))
                .collect(java.util.stream.Collectors.joining("\n"));
        return java.util.Arrays.stream(withoutComments.split(";"))
                .map(String::strip)
                .filter(statement -> !statement.isEmpty())
                .toList();
    }

    private record Migration(int version, String description, String resource) {
    }
}
