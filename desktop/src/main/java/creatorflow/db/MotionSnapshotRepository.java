package creatorflow.db;

import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.MotionSnapshotStatus;
import creatorflow.motion.MotionSnapshots;
import creatorflow.motion.PlaybackSettings;
import creatorflow.workflow.MotionSnapshotRecord;
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

/**
 * Immutable, project-and-asset-scoped animation snapshots. Capturing a new snapshot of a kind
 * supersedes the asset's previous current one (recording the link) but never rewrites it, and
 * classifies the new fingerprint against the previous as FIRST/UNCHANGED/CHANGED.
 */
public final class MotionSnapshotRepository {

    private final Connection connection;

    public MotionSnapshotRepository(Database database) {
        this.connection = database.connection();
    }

    public MotionSnapshotRecord capture(long projectId, String assetId, MotionSnapshotKind kind,
                                        String sourceComparisonId, String name, double duration,
                                        String fingerprint, String algorithmVersion,
                                        PlaybackSettings settings) {
        String asset = requireText(assetId, "asset ID");
        if (kind == null) throw new IllegalArgumentException("snapshot kind is required");
        String print = requireText(fingerprint, "fingerprint");
        MotionSnapshotRecord record = new MotionSnapshotRecord(
                UUID.randomUUID().toString(), projectId, asset, kind,
                blankToNull(sourceComparisonId), displayName(name, asset),
                finiteNonNegative(duration, "duration"), print,
                requireText(algorithmVersion, "algorithm version"),
                null, MotionSnapshotStatus.FIRST_SNAPSHOT,
                settings == null ? PlaybackSettings.unknown() : settings, Instant.now());
        synchronized (connection) {
            // Find-current and insert must be atomic so two captures can't both supersede the
            // same prior snapshot; the bridge serializes on this connection.
            Optional<MotionSnapshotRecord> previous = currentLocked(projectId, asset, kind);
            // Compare playback settings as well as curve data: a flipped Looped changes how the
            // clip plays without touching a single curve value, and drift detection must see it.
            MotionSnapshotStatus status = MotionSnapshots.classify(
                    previous.map(MotionSnapshotRecord::fingerprint).orElse(null),
                    previous.map(MotionSnapshotRecord::settings).orElse(PlaybackSettings.unknown()),
                    print, record.settings());
            MotionSnapshotRecord toInsert = new MotionSnapshotRecord(
                    record.id(), projectId, asset, kind, record.sourceComparisonId(), record.name(),
                    record.duration(), print, record.algorithmVersion(),
                    previous.map(MotionSnapshotRecord::id).orElse(null), status,
                    record.settings(), record.createdAt());
            insertLocked(toInsert);
            return toInsert;
        }
    }

    public Optional<MotionSnapshotRecord> findById(String id) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM motion_snapshots WHERE id = ?")) {
                statement.setString(1, requireText(id, "snapshot ID"));
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not load motion snapshot", error);
            }
        }
    }

    public Optional<MotionSnapshotRecord> current(long projectId, String assetId, MotionSnapshotKind kind) {
        synchronized (connection) {
            return currentLocked(projectId, requireText(assetId, "asset ID"), kind);
        }
    }

    /** The newest snapshot per (asset, kind) for the project — the set of live references. */
    public List<MotionSnapshotRecord> currentForProject(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM motion_snapshots
                    WHERE project_id = ? ORDER BY created_at DESC, rowid DESC""")) {
                statement.setLong(1, projectId);
                try (ResultSet result = statement.executeQuery()) {
                    Map<String, MotionSnapshotRecord> newest = new LinkedHashMap<>();
                    while (result.next()) {
                        MotionSnapshotRecord record = map(result);
                        newest.putIfAbsent(record.assetId() + "::" + record.kind(), record);
                    }
                    return new ArrayList<>(newest.values());
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not list motion snapshots", error);
            }
        }
    }

    public List<MotionSnapshotRecord> history(long projectId, String assetId, MotionSnapshotKind kind,
                                              int limit, int offset) {
        if (kind == null) throw new IllegalArgumentException("snapshot kind is required");
        int safeLimit = Math.max(1, Math.min(limit, 100));
        int safeOffset = Math.max(0, offset);
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM motion_snapshots
                    WHERE project_id = ? AND asset_id = ? AND kind = ?
                    ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?""")) {
                statement.setLong(1, projectId);
                statement.setString(2, requireText(assetId, "asset ID"));
                statement.setString(3, kind.wire());
                statement.setInt(4, safeLimit);
                statement.setInt(5, safeOffset);
                try (ResultSet result = statement.executeQuery()) {
                    List<MotionSnapshotRecord> records = new ArrayList<>();
                    while (result.next()) records.add(map(result));
                    return records;
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not list motion snapshot history", error);
            }
        }
    }

    private Optional<MotionSnapshotRecord> currentLocked(long projectId, String assetId,
                                                         MotionSnapshotKind kind) {
        if (kind == null) throw new IllegalArgumentException("snapshot kind is required");
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT * FROM motion_snapshots
                WHERE project_id = ? AND asset_id = ? AND kind = ?
                ORDER BY created_at DESC, rowid DESC LIMIT 1""")) {
            statement.setLong(1, projectId);
            statement.setString(2, assetId);
            statement.setString(3, kind.wire());
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(map(result)) : Optional.empty();
            }
        } catch (SQLException error) {
            throw new IllegalStateException("Could not load current motion snapshot", error);
        }
    }

    private void insertLocked(MotionSnapshotRecord record) {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO motion_snapshots(
                  id, project_id, asset_id, kind, source_comparison_id, name, duration,
                  fingerprint, algorithm_version, supersedes_snapshot_id, status, created_at,
                  looped, priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")) {
            statement.setString(1, record.id());
            statement.setLong(2, record.projectId());
            statement.setString(3, record.assetId());
            statement.setString(4, record.kind().wire());
            statement.setString(5, record.sourceComparisonId());
            statement.setString(6, record.name());
            statement.setDouble(7, record.duration());
            statement.setString(8, record.fingerprint());
            statement.setString(9, record.algorithmVersion());
            statement.setString(10, record.supersedesSnapshotId());
            statement.setString(11, record.status().name());
            statement.setString(12, Timestamps.text(record.createdAt()));
            Boolean looped = record.settings().looped();
            if (looped == null) {
                statement.setNull(13, java.sql.Types.INTEGER);
            } else {
                statement.setInt(13, looped ? 1 : 0);
            }
            statement.setString(14, record.settings().priority());
            statement.executeUpdate();
        } catch (SQLException error) {
            throw new IllegalStateException("Could not persist motion snapshot", error);
        }
    }

    private static MotionSnapshotRecord map(ResultSet result) throws SQLException {
        return new MotionSnapshotRecord(
                result.getString("id"), result.getLong("project_id"), result.getString("asset_id"),
                MotionSnapshotKind.valueOf(result.getString("kind")),
                result.getString("source_comparison_id"), result.getString("name"),
                result.getDouble("duration"), result.getString("fingerprint"),
                result.getString("algorithm_version"), result.getString("supersedes_snapshot_id"),
                MotionSnapshotStatus.valueOf(result.getString("status")),
                readSettings(result),
                Instant.parse(result.getString("created_at")));
    }

    /** Reads the tri-state playback settings; SQL NULL means "not recorded", never "false". */
    private static PlaybackSettings readSettings(ResultSet result) throws SQLException {
        int looped = result.getInt("looped");
        Boolean loopedOrNull = result.wasNull() ? null : looped != 0;
        return new PlaybackSettings(loopedOrNull, result.getString("priority"));
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String displayName(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.strip();
    }

    private static double finiteNonNegative(double value, String label) {
        if (!Double.isFinite(value) || value < 0) throw new IllegalArgumentException(label + " is invalid");
        return value;
    }
}
