package creatorflow.db;

import creatorflow.manifest.OwnershipEvidence;
import creatorflow.ownership.OwnershipOutcome;
import creatorflow.workflow.OwnershipVerificationRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Insert-only ledger of Open Cloud ownership verifications, mirroring the hand-rolled SQL and
 * {@code synchronized (connection)} pattern of {@link LocalProjectRepository} /
 * {@link MotionSnapshotRepository}. There is no update or delete: re-verifying an asset appends a
 * new row, and the newest row per asset is the current answer. Rows disappear only when their scan
 * asset (and thus its scan run / project) is deleted, via the {@code ON DELETE CASCADE} chain.
 *
 * <p><strong>Latest-per-asset determinism.</strong> Both {@link #latestForAsset(long)} and
 * {@link #latestForRun(String)} order by {@code checked_at DESC} then {@code rowid DESC}. The
 * {@code rowid} tiebreak is the insertion-order key: when two verifications carry the identical
 * {@code checked_at} stamp, the one inserted <em>last</em> (the most recent observation) wins,
 * deterministically. (This is the #28 "latest-inserted wins" fix applied to a {@code TEXT} UUID
 * primary key — the same {@code created_at DESC, rowid DESC} tiebreak {@link MotionSnapshotRepository}
 * uses; ordering on the random UUID {@code id} would not track insertion order.)
 */
public final class OwnershipVerificationRepository {

    private final Connection connection;

    public OwnershipVerificationRepository(Database database) {
        this.connection = database.connection();
    }

    /**
     * Append one verification for a scan asset. {@code universeId} is passed alongside the evidence
     * because it identifies which experience the creator was checked against and is not carried on
     * {@link OwnershipEvidence} itself. The evidence must be an actual observation — a non-null
     * {@code robloxAssetId} (something was checked) and a non-null {@code checkedAt} (a point in
     * time).
     *
     * <p>Only the parsed facts are persisted. The ledger keeps no raw upstream response body: it
     * never had a writer, and an audit trail that is only written on the calls that happened to
     * succeed would be worse than none.
     */
    public OwnershipVerificationRecord insert(long scanAssetId, long universeId,
                                              OwnershipEvidence evidence) {
        Objects.requireNonNull(evidence, "evidence");
        if (evidence.robloxAssetId() == null) {
            throw new IllegalArgumentException(
                    "ownership evidence must carry the checked roblox asset id to be persisted");
        }
        if (evidence.outcome() == null) {
            throw new IllegalArgumentException("ownership evidence must carry an outcome");
        }
        if (evidence.checkedAt() == null) {
            throw new IllegalArgumentException("ownership evidence must carry a checkedAt timestamp");
        }
        OwnershipVerificationRecord record = new OwnershipVerificationRecord(
                UUID.randomUUID().toString(), scanAssetId, evidence.robloxAssetId(), universeId,
                evidence.creatorType(), evidence.creatorId(), evidence.assetType(),
                evidence.moderationState(), evidence.ownerType(), evidence.ownerId(),
                evidence.memberRank(), evidence.outcome(), evidence.checkedAt());
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO ownership_verifications(
                      id, scan_asset_id, roblox_asset_id, universe_id, creator_type, creator_id,
                      asset_type, moderation_state, owner_type, owner_id, member_rank, outcome,
                      checked_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")) {
                statement.setString(1, record.id());
                statement.setLong(2, record.scanAssetId());
                statement.setLong(3, record.robloxAssetId());
                statement.setLong(4, record.universeId());
                statement.setString(5, record.creatorType());
                setNullableLong(statement, 6, record.creatorId());
                statement.setString(7, record.assetType());
                statement.setString(8, record.moderationState());
                statement.setString(9, record.ownerType());
                setNullableLong(statement, 10, record.ownerId());
                setNullableInt(statement, 11, record.memberRank());
                statement.setString(12, record.outcome().name());
                statement.setString(13, record.checkedAt().toString());
                statement.executeUpdate();
            } catch (SQLException error) {
                throw new IllegalStateException("Could not persist ownership verification", error);
            }
        }
        return record;
    }

    /**
     * The full verification history for one scan asset, newest first (the same
     * {@code checked_at DESC, rowid DESC} ordering {@link #latestForAsset(long)} uses, so the first
     * element is always the current answer). Empty when the asset was never verified. This backs the
     * bridge's history route, which never exposes the API key.
     */
    public java.util.List<OwnershipVerificationRecord> historyForAsset(long scanAssetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM ownership_verifications
                    WHERE scan_asset_id = ?
                    ORDER BY checked_at DESC, rowid DESC""")) {
                statement.setLong(1, scanAssetId);
                try (ResultSet result = statement.executeQuery()) {
                    java.util.List<OwnershipVerificationRecord> records = new java.util.ArrayList<>();
                    while (result.next()) {
                        records.add(map(result));
                    }
                    return java.util.List.copyOf(records);
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not load ownership verification history", error);
            }
        }
    }

    /** The most recent verification for one scan asset, if any. */
    public Optional<OwnershipVerificationRecord> latestForAsset(long scanAssetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM ownership_verifications
                    WHERE scan_asset_id = ?
                    ORDER BY checked_at DESC, rowid DESC LIMIT 1""")) {
                statement.setLong(1, scanAssetId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not load latest ownership verification", error);
            }
        }
    }

    /**
     * The most recent verification per scan asset across a whole scan run, keyed by scan asset id.
     * Assets without any verification are simply absent from the map. Mirrors
     * {@link ScanRepository#latestEvidenceForRun(String)}'s {@code ROW_NUMBER()} window with the
     * insertion-order ({@code rowid}) tiebreak.
     */
    public Map<Long, OwnershipVerificationRecord> latestForRun(String scanRunId) {
        String runId = requireText(scanRunId, "scan run ID");
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM (
                      SELECT v.*, ROW_NUMBER() OVER (
                        PARTITION BY v.scan_asset_id ORDER BY v.checked_at DESC, v.rowid DESC
                      ) AS verification_rank
                      FROM ownership_verifications v
                      JOIN scan_assets a ON a.id = v.scan_asset_id
                      WHERE a.scan_run_id = ?
                    ) WHERE verification_rank = 1 ORDER BY scan_asset_id""")) {
                statement.setString(1, runId);
                try (ResultSet result = statement.executeQuery()) {
                    Map<Long, OwnershipVerificationRecord> records = new LinkedHashMap<>();
                    while (result.next()) {
                        OwnershipVerificationRecord record = map(result);
                        records.put(record.scanAssetId(), record);
                    }
                    return Map.copyOf(records);
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not load latest ownership verifications for scan", error);
            }
        }
    }

    private static OwnershipVerificationRecord map(ResultSet result) throws SQLException {
        return new OwnershipVerificationRecord(
                result.getString("id"),
                result.getLong("scan_asset_id"),
                result.getLong("roblox_asset_id"),
                result.getLong("universe_id"),
                result.getString("creator_type"),
                nullableLong(result, "creator_id"),
                result.getString("asset_type"),
                result.getString("moderation_state"),
                result.getString("owner_type"),
                nullableLong(result, "owner_id"),
                nullableInt(result, "member_rank"),
                OwnershipOutcome.valueOf(result.getString("outcome")),
                Instant.parse(result.getString("checked_at")));
    }

    private static void setNullableLong(PreparedStatement statement, int index, Long value) throws SQLException {
        if (value == null) statement.setNull(index, Types.INTEGER);
        else statement.setLong(index, value);
    }

    private static void setNullableInt(PreparedStatement statement, int index, Integer value) throws SQLException {
        if (value == null) statement.setNull(index, Types.INTEGER);
        else statement.setInt(index, value);
    }

    private static Long nullableLong(ResultSet result, String column) throws SQLException {
        long value = result.getLong(column);
        return result.wasNull() ? null : value;
    }

    private static Integer nullableInt(ResultSet result, String column) throws SQLException {
        int value = result.getInt(column);
        return result.wasNull() ? null : value;
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }
}
