package creatorflow.db;

import creatorflow.model.Asset;
import creatorflow.model.AssetMatch;
import creatorflow.model.VerificationStatus;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

public final class AssetRepository {

    private final Connection conn;

    public AssetRepository(Database database) {
        this.conn = database.connection();
    }

    /** Inserts the asset and its match evidence in one transaction; returns the asset with its id. */
    public Asset insert(Asset asset, List<AssetMatch> matches) {
        String assetSql = """
                INSERT INTO assets(project_id, file_name, stored_path, file_type, size_bytes,
                                   width, height, sha256, dhash, phash, audio_fp,
                                   license, ownership_declared, status, findings, added_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""";
        String matchSql = """
                INSERT INTO asset_matches(asset_id, matched_asset_id, matched_file_name, layer, distance, note)
                VALUES (?,?,?,?,?,?)""";
        try {
            conn.setAutoCommit(false);
            long id;
            try (PreparedStatement ps = conn.prepareStatement(assetSql, Statement.RETURN_GENERATED_KEYS)) {
                ps.setLong(1, asset.projectId());
                ps.setString(2, asset.fileName());
                ps.setString(3, asset.storedPath());
                ps.setString(4, asset.fileType());
                ps.setLong(5, asset.sizeBytes());
                ps.setInt(6, asset.width());
                ps.setInt(7, asset.height());
                ps.setString(8, asset.sha256());
                setNullableLong(ps, 9, asset.dHash());
                setNullableLong(ps, 10, asset.pHash());
                setNullableLong(ps, 11, asset.audioFp());
                ps.setString(12, asset.license());
                ps.setInt(13, asset.ownershipDeclared() ? 1 : 0);
                ps.setString(14, asset.status().name());
                ps.setString(15, asset.findings());
                ps.setString(16, asset.addedAt().toString());
                ps.executeUpdate();
                try (ResultSet keys = ps.getGeneratedKeys()) {
                    keys.next();
                    id = keys.getLong(1);
                }
            }
            try (PreparedStatement ps = conn.prepareStatement(matchSql)) {
                for (AssetMatch match : matches) {
                    ps.setLong(1, id);
                    ps.setLong(2, match.matchedAssetId());
                    ps.setString(3, match.matchedFileName());
                    ps.setString(4, match.layer());
                    ps.setInt(5, match.distance());
                    ps.setString(6, match.note());
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn.commit();
            return asset.withId(id);
        } catch (SQLException e) {
            rollbackQuietly();
            throw new IllegalStateException("Could not save asset " + asset.fileName(), e);
        } finally {
            autoCommitQuietly();
        }
    }

    public List<Asset> findAll() {
        return query("SELECT * FROM assets ORDER BY added_at DESC, id DESC");
    }

    public List<Asset> findRecent(int limit) {
        return query("SELECT * FROM assets ORDER BY added_at DESC, id DESC LIMIT " + limit);
    }

    public List<Asset> findByProject(long projectId) {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT * FROM assets WHERE project_id = ? ORDER BY added_at DESC, id DESC")) {
            ps.setLong(1, projectId);
            try (ResultSet rs = ps.executeQuery()) {
                return mapAll(rs);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not list assets for project " + projectId, e);
        }
    }

    public List<Asset> findFlagged() {
        return query("SELECT * FROM assets WHERE status != 'CLEAR' ORDER BY added_at DESC, id DESC");
    }

    public List<AssetMatch> matchesFor(long assetId) {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT * FROM asset_matches WHERE asset_id = ? ORDER BY distance, id")) {
            ps.setLong(1, assetId);
            try (ResultSet rs = ps.executeQuery()) {
                List<AssetMatch> matches = new ArrayList<>();
                while (rs.next()) {
                    matches.add(new AssetMatch(
                            rs.getLong("matched_asset_id"),
                            rs.getString("matched_file_name"),
                            rs.getString("layer"),
                            rs.getInt("distance"),
                            rs.getString("note")));
                }
                return matches;
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not load matches for asset " + assetId, e);
        }
    }

    public int count() {
        return intQuery("SELECT COUNT(*) FROM assets");
    }

    public long totalSizeBytes() {
        return intQuery("SELECT COALESCE(SUM(size_bytes), 0) FROM assets");
    }

    public Map<VerificationStatus, Integer> countByStatus() {
        Map<VerificationStatus, Integer> counts = new EnumMap<>(VerificationStatus.class);
        for (VerificationStatus status : VerificationStatus.values()) {
            counts.put(status, 0);
        }
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT status, COUNT(*) FROM assets GROUP BY status");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                counts.put(VerificationStatus.valueOf(rs.getString(1)), rs.getInt(2));
            }
            return counts;
        } catch (SQLException e) {
            throw new IllegalStateException("Could not count assets by status", e);
        }
    }

    private List<Asset> query(String sql) {
        try (PreparedStatement ps = conn.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            return mapAll(rs);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not query assets", e);
        }
    }

    private int intQuery(String sql) {
        try (PreparedStatement ps = conn.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not query assets", e);
        }
    }

    private static List<Asset> mapAll(ResultSet rs) throws SQLException {
        List<Asset> assets = new ArrayList<>();
        while (rs.next()) {
            assets.add(new Asset(
                    rs.getLong("id"),
                    rs.getLong("project_id"),
                    rs.getString("file_name"),
                    rs.getString("stored_path"),
                    rs.getString("file_type"),
                    rs.getLong("size_bytes"),
                    rs.getInt("width"),
                    rs.getInt("height"),
                    rs.getString("sha256"),
                    getNullableLong(rs, "dhash"),
                    getNullableLong(rs, "phash"),
                    getNullableLong(rs, "audio_fp"),
                    rs.getString("license"),
                    rs.getInt("ownership_declared") != 0,
                    VerificationStatus.valueOf(rs.getString("status")),
                    rs.getString("findings"),
                    Instant.parse(rs.getString("added_at"))));
        }
        return assets;
    }

    private static void setNullableLong(PreparedStatement ps, int index, Long value) throws SQLException {
        if (value == null) {
            ps.setNull(index, java.sql.Types.BIGINT);
        } else {
            ps.setLong(index, value);
        }
    }

    private static Long getNullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private void rollbackQuietly() {
        try {
            conn.rollback();
        } catch (SQLException ignored) {
            // already failing; the original exception is the one that matters
        }
    }

    private void autoCommitQuietly() {
        try {
            conn.setAutoCommit(true);
        } catch (SQLException ignored) {
            // connection is likely broken; surfaced by the next query
        }
    }
}
