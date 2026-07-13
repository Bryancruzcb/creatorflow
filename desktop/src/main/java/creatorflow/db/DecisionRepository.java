package creatorflow.db;

import creatorflow.workflow.DecisionRecord;
import creatorflow.workflow.DecisionType;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Append-only decisions; this repository intentionally exposes no update or delete operation. */
public final class DecisionRepository {

    private final Connection connection;

    public DecisionRepository(Database database) {
        this.connection = database.connection();
    }

    public DecisionRecord append(long scanAssetId, DecisionType type, String reason) {
        return append(scanAssetId, type, reason, null);
    }

    public DecisionRecord supersede(String previousDecisionId, DecisionType type, String reason) {
        synchronized (connection) {
            DecisionRecord previous = findByIdInternal(previousDecisionId)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown decision " + previousDecisionId));
            return appendInternal(previous.scanAssetId(), type, reason, previous.id());
        }
    }

    public Optional<DecisionRecord> latestFor(long scanAssetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM decisions WHERE scan_asset_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1""")) {
                statement.setLong(1, scanAssetId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load latest decision", e);
            }
        }
    }

    public List<DecisionRecord> historyFor(long scanAssetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM decisions WHERE scan_asset_id = ? ORDER BY created_at, rowid""")) {
                statement.setLong(1, scanAssetId);
                try (ResultSet result = statement.executeQuery()) {
                    List<DecisionRecord> records = new ArrayList<>();
                    while (result.next()) records.add(map(result));
                    return records;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load decision history", e);
            }
        }
    }

    public Map<Long, DecisionRecord> latestForRun(String scanRunId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM (
                      SELECT d.*, ROW_NUMBER() OVER (
                        PARTITION BY d.scan_asset_id ORDER BY d.created_at DESC, d.rowid DESC
                      ) AS decision_rank
                      FROM decisions d
                      JOIN scan_assets a ON a.id = d.scan_asset_id
                      WHERE a.scan_run_id = ?
                    ) WHERE decision_rank = 1 ORDER BY scan_asset_id""")) {
                statement.setString(1, scanRunId);
                try (ResultSet result = statement.executeQuery()) {
                    Map<Long, DecisionRecord> records = new LinkedHashMap<>();
                    while (result.next()) {
                        DecisionRecord record = map(result);
                        records.put(record.scanAssetId(), record);
                    }
                    return Map.copyOf(records);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load latest decisions for scan", e);
            }
        }
    }

    private DecisionRecord append(long scanAssetId, DecisionType type, String reason,
                                  String supersedesDecisionId) {
        synchronized (connection) {
            return appendInternal(scanAssetId, type, reason, supersedesDecisionId);
        }
    }

    private DecisionRecord appendInternal(long scanAssetId, DecisionType type, String reason,
                                          String supersedesDecisionId) {
        String cleanReason = requireReason(reason);
        if (!assetExists(scanAssetId)) throw new IllegalArgumentException("Unknown scan asset " + scanAssetId);
        if (supersedesDecisionId != null) {
            DecisionRecord previous = findByIdInternal(supersedesDecisionId)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown decision " + supersedesDecisionId));
            if (previous.scanAssetId() != scanAssetId) {
                throw new IllegalArgumentException("A decision can only supersede one for the same asset");
            }
        }

        DecisionRecord record = new DecisionRecord(UUID.randomUUID().toString(), scanAssetId,
                java.util.Objects.requireNonNull(type, "type"), cleanReason,
                supersedesDecisionId, Instant.now());
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO decisions(id, scan_asset_id, decision_type, reason,
                                      supersedes_decision_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)""")) {
            statement.setString(1, record.id());
            statement.setLong(2, record.scanAssetId());
            statement.setString(3, record.type().name());
            statement.setString(4, record.reason());
            statement.setString(5, record.supersedesDecisionId());
            statement.setString(6, record.createdAt().toString());
            statement.executeUpdate();
            return record;
        } catch (SQLException e) {
            throw new IllegalStateException("Could not append decision", e);
        }
    }

    private Optional<DecisionRecord> findByIdInternal(String decisionId) {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT * FROM decisions WHERE id = ?")) {
            statement.setString(1, decisionId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(map(result)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not load decision", e);
        }
    }

    private boolean assetExists(long assetId) {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT 1 FROM scan_assets WHERE id = ?")) {
            statement.setLong(1, assetId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not validate scan asset", e);
        }
    }

    private static DecisionRecord map(ResultSet result) throws SQLException {
        return new DecisionRecord(result.getString("id"), result.getLong("scan_asset_id"),
                DecisionType.valueOf(result.getString("decision_type")), result.getString("reason"),
                result.getString("supersedes_decision_id"), Instant.parse(result.getString("created_at")));
    }

    private static String requireReason(String reason) {
        if (reason == null || reason.isBlank()) throw new IllegalArgumentException("Decision reason is required");
        return reason.strip();
    }
}
