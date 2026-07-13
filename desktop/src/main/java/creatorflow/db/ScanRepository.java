package creatorflow.db;

import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.workflow.ScanAccounting;
import creatorflow.workflow.ScanAsset;
import creatorflow.workflow.ScanFinding;
import creatorflow.workflow.ScanRun;
import creatorflow.workflow.ScanState;
import creatorflow.workflow.SourceEvidenceRecord;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Stores immutable scan snapshots separately from the legacy imported-asset library. */
public final class ScanRepository {

    private final Connection connection;

    public ScanRepository(Database database) {
        this.connection = database.connection();
    }

    public ScanRun create(long projectId, Path root, String releaseName,
                          List<String> exclusions, List<String> supportedFormats) {
        String id = UUID.randomUUID().toString();
        Instant now = Instant.now();
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO scan_runs(id, project_id, project_root, release_name,
                                          exclusions_json, supported_formats_json, state, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""")) {
                statement.setString(1, id);
                statement.setLong(2, projectId);
                statement.setString(3, root.toAbsolutePath().normalize().toString());
                statement.setString(4, requireText(releaseName, "release name"));
                statement.setString(5, SqlJson.strings(exclusions));
                statement.setString(6, SqlJson.strings(supportedFormats));
                statement.setString(7, ScanState.QUEUED.name());
                statement.setString(8, now.toString());
                statement.executeUpdate();
                return findByIdInternal(id).orElseThrow();
            } catch (SQLException e) {
                throw new IllegalStateException("Could not create scan run", e);
            }
        }
    }

    public void markStarted(String runId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE scan_runs SET state = ?, started_at = ? WHERE id = ? AND state = 'QUEUED'""")) {
                statement.setString(1, ScanState.RUNNING.name());
                statement.setString(2, Instant.now().toString());
                statement.setString(3, runId);
                statement.executeUpdate();
                if (findByIdInternal(runId).isEmpty()) throw unknownRun(runId);
            } catch (SQLException e) {
                throw new IllegalStateException("Could not start scan " + runId, e);
            }
        }
    }

    public boolean requestCancellation(String runId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE scan_runs SET state = ?
                    WHERE id = ? AND state IN ('QUEUED', 'RUNNING')""")) {
                statement.setString(1, ScanState.CANCELLATION_REQUESTED.name());
                statement.setString(2, runId);
                return statement.executeUpdate() == 1;
            } catch (SQLException e) {
                throw new IllegalStateException("Could not request scan cancellation", e);
            }
        }
    }

    public void updateProgress(String runId, int discovered, int processed, long bytesProcessed,
                               List<String> warnings) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE scan_runs SET discovered_count = ?, processed_count = ?,
                                         bytes_processed = ?, warnings_json = ?
                    WHERE id = ? AND state IN ('RUNNING', 'CANCELLATION_REQUESTED')""")) {
                statement.setInt(1, Math.max(0, discovered));
                statement.setInt(2, Math.max(0, processed));
                statement.setLong(3, Math.max(0, bytesProcessed));
                statement.setString(4, SqlJson.strings(warnings));
                statement.setString(5, runId);
                statement.executeUpdate();
            } catch (SQLException e) {
                throw new IllegalStateException("Could not update scan progress", e);
            }
        }
    }

    public void complete(String runId, CreativeManifest manifest, ScanAccounting accounting,
                         List<String> warnings) {
        finish(runId, manifest, accounting, warnings, ScanState.COMPLETED);
    }

    public void finishCancelled(String runId, CreativeManifest partialManifest, ScanAccounting accounting,
                                List<String> warnings) {
        finish(runId, partialManifest, accounting, warnings, ScanState.CANCELLED);
    }

    private void finish(String runId, CreativeManifest manifest, ScanAccounting accounting,
                        List<String> warnings, ScanState terminalState) {
        if (terminalState != ScanState.COMPLETED && terminalState != ScanState.CANCELLED) {
            throw new IllegalArgumentException("Scan snapshot can only finish completed or cancelled");
        }
        synchronized (connection) {
            ScanRun existing = findByIdInternal(runId).orElseThrow(() ->
                    new IllegalArgumentException("Unknown scan run " + runId));
            if (existing.state().terminal()) {
                throw new IllegalStateException("Completed scan snapshots are immutable");
            }
            boolean previousAutoCommit;
            try {
                previousAutoCommit = connection.getAutoCommit();
                connection.setAutoCommit(false);
                deleteSnapshot(runId);
                int ordinal = 1;
                for (AssetEntry asset : manifest.assets()) {
                    long assetId = insertAsset(runId, ordinal, asset);
                    insertFindings(assetId, asset);
                    insertEvidence(assetId, asset, manifest.generatedAt());
                    ordinal++;
                }
                try (PreparedStatement statement = connection.prepareStatement("""
                        UPDATE scan_runs SET state = ?, discovered_count = ?, processed_count = ?,
                            bytes_processed = ?, supported_count = ?, ignored_count = ?, excluded_count = ?,
                            unreadable_count = ?, missing_dependency_count = ?, failed_count = ?,
                            warnings_json = ?, error_message = NULL, completed_at = ?
                        WHERE id = ? AND state IN ('QUEUED', 'RUNNING', 'CANCELLATION_REQUESTED')""")) {
                    statement.setString(1, terminalState.name());
                    statement.setInt(2, accounting.supported());
                    statement.setInt(3, manifest.assets().size() + accounting.unreadable() + accounting.failed());
                    statement.setLong(4, accounting.bytesProcessed());
                    statement.setInt(5, accounting.supported());
                    statement.setInt(6, accounting.ignored());
                    statement.setInt(7, accounting.excluded());
                    statement.setInt(8, accounting.unreadable());
                    statement.setInt(9, accounting.missingDependencies());
                    statement.setInt(10, accounting.failed());
                    statement.setString(11, SqlJson.strings(warnings));
                    statement.setString(12, Instant.now().toString());
                    statement.setString(13, runId);
                    if (statement.executeUpdate() != 1) throw new SQLException("Scan run cannot be finished " + runId);
                }
                connection.commit();
                connection.setAutoCommit(previousAutoCommit);
            } catch (SQLException e) {
                rollbackQuietly();
                autoCommitQuietly();
                throw new IllegalStateException("Could not persist completed scan " + runId, e);
            }
        }
    }

    public void markCancelled(String runId, List<String> warnings) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE scan_runs SET state = ?, warnings_json = ?, completed_at = ?
                    WHERE id = ? AND state IN ('QUEUED', 'RUNNING', 'CANCELLATION_REQUESTED')""")) {
                statement.setString(1, ScanState.CANCELLED.name());
                statement.setString(2, SqlJson.strings(warnings));
                statement.setString(3, Instant.now().toString());
                statement.setString(4, runId);
                statement.executeUpdate();
                if (findByIdInternal(runId).isEmpty()) throw unknownRun(runId);
            } catch (SQLException e) {
                throw new IllegalStateException("Could not mark scan cancelled", e);
            }
        }
    }

    public void markFailed(String runId, String errorMessage, List<String> warnings) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE scan_runs SET state = ?, error_message = ?, warnings_json = ?, completed_at = ?
                    WHERE id = ? AND state IN ('QUEUED', 'RUNNING', 'CANCELLATION_REQUESTED')""")) {
                statement.setString(1, ScanState.FAILED.name());
                statement.setString(2, requireText(errorMessage, "error message"));
                statement.setString(3, SqlJson.strings(warnings));
                statement.setString(4, Instant.now().toString());
                statement.setString(5, runId);
                statement.executeUpdate();
                if (findByIdInternal(runId).isEmpty()) throw unknownRun(runId);
            } catch (SQLException e) {
                throw new IllegalStateException("Could not mark scan failed", e);
            }
        }
    }

    public Optional<ScanRun> findById(String runId) {
        synchronized (connection) {
            return findByIdInternal(runId);
        }
    }

    public Optional<ScanRun> latestForProject(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM scan_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1""")) {
                statement.setLong(1, projectId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(mapRun(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load latest scan", e);
            }
        }
    }

    public List<ScanAsset> listAssets(String runId, int limit, int offset) {
        int safeLimit = Math.max(1, Math.min(limit, 500));
        int safeOffset = Math.max(0, offset);
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM scan_assets WHERE scan_run_id = ?
                    ORDER BY ordinal LIMIT ? OFFSET ?""")) {
                statement.setString(1, runId);
                statement.setInt(2, safeLimit);
                statement.setInt(3, safeOffset);
                try (ResultSet result = statement.executeQuery()) {
                    List<ScanAsset> assets = new ArrayList<>();
                    while (result.next()) assets.add(mapAsset(result));
                    return assets;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list scan assets", e);
            }
        }
    }

    public List<ScanAsset> listAllAssets(String runId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM scan_assets WHERE scan_run_id = ? ORDER BY ordinal""")) {
                statement.setString(1, runId);
                try (ResultSet result = statement.executeQuery()) {
                    List<ScanAsset> assets = new ArrayList<>();
                    while (result.next()) assets.add(mapAsset(result));
                    return assets;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list complete scan snapshot", e);
            }
        }
    }

    public Optional<ScanAsset> findAsset(long assetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM scan_assets WHERE id = ?")) {
                statement.setLong(1, assetId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(mapAsset(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load scan asset", e);
            }
        }
    }

    public List<ScanFinding> findingsFor(long assetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM scan_findings WHERE scan_asset_id = ? ORDER BY id")) {
                statement.setLong(1, assetId);
                try (ResultSet result = statement.executeQuery()) {
                    List<ScanFinding> findings = new ArrayList<>();
                    while (result.next()) {
                        findings.add(new ScanFinding(result.getLong("id"), assetId,
                                result.getString("code"), result.getString("severity"),
                                result.getString("message"), nullableInt(result, "matched_asset_ordinal"),
                                result.getString("match_layer"), nullableInt(result, "match_distance")));
                    }
                    return findings;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list scan findings", e);
            }
        }
    }

    public Map<Long, List<ScanFinding>> findingsForRun(String runId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT f.* FROM scan_findings f
                    JOIN scan_assets a ON a.id = f.scan_asset_id
                    WHERE a.scan_run_id = ? ORDER BY a.ordinal, f.id""")) {
                statement.setString(1, runId);
                try (ResultSet result = statement.executeQuery()) {
                    Map<Long, List<ScanFinding>> findings = new LinkedHashMap<>();
                    while (result.next()) {
                        ScanFinding finding = mapFinding(result);
                        findings.computeIfAbsent(finding.scanAssetId(), ignored -> new ArrayList<>()).add(finding);
                    }
                    findings.replaceAll((ignored, values) -> List.copyOf(values));
                    return Map.copyOf(findings);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list scan findings", e);
            }
        }
    }

    public Optional<ScanFinding> findFinding(long findingId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM scan_findings WHERE id = ?")) {
                statement.setLong(1, findingId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(mapFinding(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load scan finding", e);
            }
        }
    }

    public Optional<SourceEvidenceRecord> evidenceFor(long assetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM source_evidence WHERE scan_asset_id = ? ORDER BY recorded_at DESC LIMIT 1""")) {
                statement.setLong(1, assetId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(mapEvidence(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load source evidence", e);
            }
        }
    }

    public List<SourceEvidenceRecord> evidenceHistory(long assetId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM source_evidence WHERE scan_asset_id = ?
                    ORDER BY recorded_at, id""")) {
                statement.setLong(1, assetId);
                try (ResultSet result = statement.executeQuery()) {
                    List<SourceEvidenceRecord> records = new ArrayList<>();
                    while (result.next()) records.add(mapEvidence(result));
                    return records;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load source evidence history", e);
            }
        }
    }

    public Map<Long, SourceEvidenceRecord> latestEvidenceForRun(String runId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM (
                      SELECT e.*, ROW_NUMBER() OVER (
                        PARTITION BY e.scan_asset_id ORDER BY e.recorded_at DESC, e.id DESC
                      ) AS evidence_rank
                      FROM source_evidence e
                      JOIN scan_assets a ON a.id = e.scan_asset_id
                      WHERE a.scan_run_id = ?
                    ) WHERE evidence_rank = 1 ORDER BY scan_asset_id""")) {
                statement.setString(1, runId);
                try (ResultSet result = statement.executeQuery()) {
                    Map<Long, SourceEvidenceRecord> records = new LinkedHashMap<>();
                    while (result.next()) {
                        SourceEvidenceRecord record = mapEvidence(result);
                        records.put(record.scanAssetId(), record);
                    }
                    return Map.copyOf(records);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load latest source evidence for scan", e);
            }
        }
    }

    public SourceEvidenceRecord appendEvidence(long assetId, SourceEvidence evidence) {
        java.util.Objects.requireNonNull(evidence, "evidence");
        synchronized (connection) {
            if (findAsset(assetId).isEmpty()) throw new IllegalArgumentException("Unknown scan asset " + assetId);
            Instant recordedAt = Instant.now();
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO source_evidence(scan_asset_id, source_name, license_name,
                                                evidence_url, resolved, recorded_at)
                    VALUES (?, ?, ?, ?, ?, ?)""", Statement.RETURN_GENERATED_KEYS)) {
                statement.setLong(1, assetId);
                statement.setString(2, evidence.source());
                statement.setString(3, evidence.license());
                statement.setString(4, evidence.evidenceUrl());
                statement.setInt(5, evidence.resolved() ? 1 : 0);
                statement.setString(6, recordedAt.toString());
                statement.executeUpdate();
                try (ResultSet keys = statement.getGeneratedKeys()) {
                    if (!keys.next()) throw new SQLException("Source evidence insert did not return an id");
                    return new SourceEvidenceRecord(keys.getLong(1), assetId, evidence.source(),
                            evidence.license(), evidence.evidenceUrl(), evidence.resolved(), recordedAt);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not append source evidence", e);
            }
        }
    }

    private Optional<ScanRun> findByIdInternal(String runId) {
        try (PreparedStatement statement = connection.prepareStatement("SELECT * FROM scan_runs WHERE id = ?")) {
            statement.setString(1, runId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(mapRun(result)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not load scan run", e);
        }
    }

    private void deleteSnapshot(String runId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "DELETE FROM scan_assets WHERE scan_run_id = ?")) {
            statement.setString(1, runId);
            statement.executeUpdate();
        }
    }

    private long insertAsset(String runId, int ordinal, AssetEntry asset) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO scan_assets(scan_run_id, ordinal, relative_path, file_name, file_type,
                    size_bytes, sha256, width, height, dhash, phash, audio_fp, verification, findings_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", Statement.RETURN_GENERATED_KEYS)) {
            statement.setString(1, runId);
            statement.setInt(2, ordinal);
            statement.setString(3, asset.path());
            statement.setString(4, asset.fileName());
            statement.setString(5, asset.fileType());
            statement.setLong(6, asset.sizeBytes());
            statement.setString(7, asset.sha256());
            statement.setInt(8, asset.width());
            statement.setInt(9, asset.height());
            statement.setString(10, asset.fingerprints().dHash());
            statement.setString(11, asset.fingerprints().pHash());
            statement.setString(12, asset.fingerprints().audio());
            statement.setString(13, asset.verification().name());
            statement.setString(14, SqlJson.strings(asset.findings()));
            statement.executeUpdate();
            try (ResultSet keys = statement.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Scan asset insert did not return an id");
                return keys.getLong(1);
            }
        }
    }

    private void insertFindings(long assetId, AssetEntry asset) throws SQLException {
        String severity = switch (asset.verification()) {
            case CLEAR -> "INFO";
            case SIMILAR -> "REVIEW";
            case DUPLICATE -> "BLOCKING";
        };
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO scan_findings(scan_asset_id, code, severity, message,
                    matched_asset_ordinal, match_layer, match_distance)
                VALUES (?, ?, ?, ?, ?, ?, ?)""")) {
            for (String finding : asset.findings()) {
                statement.setLong(1, assetId);
                statement.setString(2, "VERIFICATION_FINDING");
                statement.setString(3, severity);
                statement.setString(4, finding);
                statement.setNull(5, java.sql.Types.INTEGER);
                statement.setNull(6, java.sql.Types.VARCHAR);
                statement.setNull(7, java.sql.Types.INTEGER);
                statement.addBatch();
            }
            for (CreativeManifest.Match match : asset.matches()) {
                statement.setLong(1, assetId);
                statement.setString(2, "MATCH_" + match.layer().toUpperCase());
                statement.setString(3, severity);
                statement.setString(4, match.note());
                statement.setLong(5, match.matchedAssetId());
                statement.setString(6, match.layer());
                statement.setInt(7, match.distance());
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private void insertEvidence(long assetId, AssetEntry asset, Instant recordedAt) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO source_evidence(scan_asset_id, source_name, license_name,
                                            evidence_url, resolved, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?)""")) {
            statement.setLong(1, assetId);
            statement.setString(2, asset.source().source());
            statement.setString(3, asset.source().license());
            statement.setString(4, asset.source().evidenceUrl());
            statement.setInt(5, asset.source().resolved() ? 1 : 0);
            statement.setString(6, recordedAt.toString());
            statement.executeUpdate();
        }
    }

    private static ScanRun mapRun(ResultSet result) throws SQLException {
        return new ScanRun(
                result.getString("id"), result.getLong("project_id"),
                Path.of(result.getString("project_root")), result.getString("release_name"),
                SqlJson.strings(result.getString("exclusions_json")),
                SqlJson.strings(result.getString("supported_formats_json")),
                ScanState.valueOf(result.getString("state")), result.getInt("discovered_count"),
                result.getInt("processed_count"), result.getLong("bytes_processed"),
                result.getInt("supported_count"), result.getInt("ignored_count"),
                result.getInt("excluded_count"), result.getInt("unreadable_count"),
                result.getInt("missing_dependency_count"), result.getInt("failed_count"),
                SqlJson.strings(result.getString("warnings_json")), result.getString("error_message"),
                Instant.parse(result.getString("created_at")), instant(result, "started_at"),
                instant(result, "completed_at"));
    }

    private static ScanAsset mapAsset(ResultSet result) throws SQLException {
        return new ScanAsset(result.getLong("id"), result.getString("scan_run_id"),
                result.getInt("ordinal"), result.getString("relative_path"),
                result.getString("file_name"), result.getString("file_type"),
                result.getLong("size_bytes"), result.getString("sha256"),
                result.getInt("width"), result.getInt("height"), result.getString("dhash"),
                result.getString("phash"), result.getString("audio_fp"),
                VerificationStatus.valueOf(result.getString("verification")),
                SqlJson.strings(result.getString("findings_json")));
    }

    private static ScanFinding mapFinding(ResultSet result) throws SQLException {
        return new ScanFinding(result.getLong("id"), result.getLong("scan_asset_id"),
                result.getString("code"), result.getString("severity"), result.getString("message"),
                nullableInt(result, "matched_asset_ordinal"), result.getString("match_layer"),
                nullableInt(result, "match_distance"));
    }

    private static SourceEvidenceRecord mapEvidence(ResultSet result) throws SQLException {
        return new SourceEvidenceRecord(result.getLong("id"), result.getLong("scan_asset_id"),
                result.getString("source_name"), result.getString("license_name"),
                result.getString("evidence_url"), result.getInt("resolved") != 0,
                Instant.parse(result.getString("recorded_at")));
    }

    private static Instant instant(ResultSet result, String column) throws SQLException {
        String value = result.getString(column);
        return value == null ? null : Instant.parse(value);
    }

    private static Integer nullableInt(ResultSet result, String column) throws SQLException {
        int value = result.getInt(column);
        return result.wasNull() ? null : value;
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }

    private static SQLException unknownRun(String runId) {
        return new SQLException("Unknown scan run " + runId);
    }

    private void rollbackQuietly() {
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // original failure is more useful
        }
    }

    private void autoCommitQuietly() {
        try {
            connection.setAutoCommit(true);
        } catch (SQLException ignored) {
            // surfaced by the next database operation
        }
    }
}
