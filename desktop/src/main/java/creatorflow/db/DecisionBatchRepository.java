package creatorflow.db;

import creatorflow.workflow.DecisionBatchKind;
import creatorflow.workflow.DecisionBatchRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Insert-only record of batch acts. Like {@link DecisionRepository} it exposes no update and no
 * delete: a batch that turned out to be wrong is undone the same way a single decision is — by a
 * later superseding decision on each asset — not by editing what was recorded.
 */
public final class DecisionBatchRepository {

    private final Connection connection;

    public DecisionBatchRepository(Database database) {
        this.connection = database.connection();
    }

    public DecisionBatchRecord insert(String scanRunId, DecisionBatchKind kind, String groupCode,
                                      String action, String rationale, int assetCount) {
        DecisionBatchRecord record = new DecisionBatchRecord(UUID.randomUUID().toString(),
                requireText(scanRunId, "scan run"), java.util.Objects.requireNonNull(kind, "kind"),
                requireText(groupCode, "group code"), requireText(action, "action"),
                requireText(rationale, "rationale"), assetCount, Instant.now());
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO decision_batches(id, scan_run_id, kind, group_code, action,
                                                 rationale, asset_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""")) {
                statement.setString(1, record.id());
                statement.setString(2, record.scanRunId());
                statement.setString(3, record.kind().name());
                statement.setString(4, record.groupCode());
                statement.setString(5, record.action());
                statement.setString(6, record.rationale());
                statement.setInt(7, record.assetCount());
                statement.setString(8, Timestamps.text(record.createdAt()));
                statement.executeUpdate();
                return record;
            } catch (SQLException e) {
                throw new IllegalStateException("Could not record decision batch", e);
            }
        }
    }

    public Optional<DecisionBatchRecord> findById(String batchId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM decision_batches WHERE id = ?")) {
                statement.setString(1, batchId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load decision batch", e);
            }
        }
    }

    /** Every batch recorded against one scan, newest first. */
    public List<DecisionBatchRecord> forRun(String scanRunId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM decision_batches WHERE scan_run_id = ?
                    ORDER BY created_at DESC, rowid DESC""")) {
                statement.setString(1, scanRunId);
                try (ResultSet result = statement.executeQuery()) {
                    List<DecisionBatchRecord> records = new ArrayList<>();
                    while (result.next()) records.add(map(result));
                    return records;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list decision batches", e);
            }
        }
    }

    private static DecisionBatchRecord map(ResultSet result) throws SQLException {
        return new DecisionBatchRecord(result.getString("id"), result.getString("scan_run_id"),
                DecisionBatchKind.valueOf(result.getString("kind")), result.getString("group_code"),
                result.getString("action"), result.getString("rationale"),
                result.getInt("asset_count"), Instant.parse(result.getString("created_at")));
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }
}
