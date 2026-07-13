package creatorflow.db;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.function.Supplier;

/** Owns the SQLite connection and applies the numbered desktop schema migrations. */
public final class Database implements AutoCloseable {

    private final Connection connection;

    public Database(Path dbFile) {
        try {
            connection = DriverManager.getConnection("jdbc:sqlite:" + dbFile);
            try (Statement st = connection.createStatement()) {
                st.execute("PRAGMA foreign_keys = ON");
                st.execute("PRAGMA journal_mode = WAL");
                st.execute("PRAGMA busy_timeout = 5000");
            }
            new SchemaMigrator(connection).migrate();
        } catch (SQLException e) {
            throw new IllegalStateException("Could not open database at " + dbFile, e);
        }
    }

    public Connection connection() {
        return connection;
    }

    /** Runs repository operations as one connection-serialized SQLite transaction. */
    public <T> T transaction(Supplier<T> work) {
        synchronized (connection) {
            try {
                boolean previousAutoCommit = connection.getAutoCommit();
                if (!previousAutoCommit) return work.get();
                connection.setAutoCommit(false);
                try {
                    T result = work.get();
                    connection.commit();
                    return result;
                } catch (RuntimeException | Error failure) {
                    connection.rollback();
                    throw failure;
                } finally {
                    connection.setAutoCommit(true);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not complete database transaction", e);
            }
        }
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
