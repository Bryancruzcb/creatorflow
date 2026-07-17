package creatorflow.db;

import creatorflow.workflow.PluginPairingRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Persists plugin pairings by their SHA-256 token hash only — the raw token is never written
 * here. Mirrors {@link MotionSnapshotRepository}: a shared {@link Database} connection, hand-rolled
 * SQL under {@code synchronized (connection)}.
 */
public final class PluginPairingRepository {

    private final Connection connection;

    public PluginPairingRepository(Database database) {
        this.connection = database.connection();
    }

    public PluginPairingRecord insert(String id, long projectId, String tokenHash,
                                      Instant issuedAt, Instant expiresAt) {
        String pairingId = requireText(id, "pairing ID");
        String hash = requireText(tokenHash, "token hash");
        if (issuedAt == null) throw new IllegalArgumentException("issued-at is required");
        if (expiresAt == null) throw new IllegalArgumentException("expires-at is required");
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO plugin_pairings(id, project_id, token_hash, issued_at, expires_at, revoked_at)
                    VALUES (?, ?, ?, ?, ?, NULL)""")) {
                statement.setString(1, pairingId);
                statement.setLong(2, projectId);
                statement.setString(3, hash);
                statement.setString(4, issuedAt.toString());
                statement.setString(5, expiresAt.toString());
                statement.executeUpdate();
            } catch (SQLException error) {
                throw new IllegalStateException("Could not persist plugin pairing", error);
            }
        }
        return new PluginPairingRecord(pairingId, projectId, hash, issuedAt, expiresAt, null);
    }

    /** The active row for a token hash: not revoked and not yet expired. */
    public Optional<PluginPairingRecord> findActiveByTokenHash(String tokenHash) {
        String hash = requireText(tokenHash, "token hash");
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM plugin_pairings
                    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?""")) {
                statement.setString(1, hash);
                statement.setString(2, Instant.now().toString());
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not look up plugin pairing", error);
            }
        }
    }

    /** Every pairing for the project, newest first — including revoked/expired ones for UI status. */
    public List<PluginPairingRecord> listForProject(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM plugin_pairings
                    WHERE project_id = ? ORDER BY issued_at DESC, rowid DESC""")) {
                statement.setLong(1, projectId);
                try (ResultSet result = statement.executeQuery()) {
                    List<PluginPairingRecord> records = new ArrayList<>();
                    while (result.next()) records.add(map(result));
                    return records;
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not list plugin pairings", error);
            }
        }
    }

    /**
     * Soft-deletes an active pairing by id, scoped to the owning project. Returns whether a row
     * was actually revoked — a pairing id that exists but belongs to a different project changes
     * 0 rows and returns false, so ownership is enforced here rather than solely at the HTTP
     * route layer.
     */
    public boolean revoke(String id, long projectId, Instant revokedAt) {
        String pairingId = requireText(id, "pairing ID");
        if (revokedAt == null) throw new IllegalArgumentException("revoked-at is required");
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE plugin_pairings SET revoked_at = ?
                    WHERE id = ? AND project_id = ? AND revoked_at IS NULL""")) {
                statement.setString(1, revokedAt.toString());
                statement.setString(2, pairingId);
                statement.setLong(3, projectId);
                return statement.executeUpdate() > 0;
            } catch (SQLException error) {
                throw new IllegalStateException("Could not revoke plugin pairing", error);
            }
        }
    }

    private static PluginPairingRecord map(ResultSet result) throws SQLException {
        String revokedAt = result.getString("revoked_at");
        return new PluginPairingRecord(
                result.getString("id"),
                result.getLong("project_id"),
                result.getString("token_hash"),
                Instant.parse(result.getString("issued_at")),
                Instant.parse(result.getString("expires_at")),
                revokedAt == null ? null : Instant.parse(revokedAt));
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }
}
