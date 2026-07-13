package creatorflow.db;

import creatorflow.workflow.ReleaseRecord;
import creatorflow.workflow.ReleaseSummary;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persists immutable, byte-exact manifest, policy-report, and comparison artifacts. */
public final class ReleaseRepository {

    private final Connection connection;

    public ReleaseRepository(Database database) {
        this.connection = database.connection();
    }

    public ReleaseRecord insert(String scanRunId, String releaseName, String manifestJson,
                                String policyResult, String reportJson, String comparisonJson) {
        ReleaseRecord release = new ReleaseRecord(UUID.randomUUID().toString(),
                requireText(scanRunId, "scan run"), requireText(releaseName, "release name"),
                requireText(manifestJson, "manifest"), requireText(policyResult, "policy result"),
                requireText(reportJson, "policy report"), requireText(comparisonJson, "comparison"),
                Instant.now());
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO releases(id, scan_run_id, release_name, manifest_json, policy_result,
                                         report_json, comparison_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""")) {
                statement.setString(1, release.id());
                statement.setString(2, release.scanRunId());
                statement.setString(3, release.releaseName());
                statement.setString(4, release.manifestJson());
                statement.setString(5, release.policyResult());
                statement.setString(6, release.reportJson());
                statement.setString(7, release.comparisonJson());
                statement.setString(8, release.createdAt().toString());
                statement.executeUpdate();
                return release;
            } catch (SQLException e) {
                throw new IllegalStateException("Could not persist release", e);
            }
        }
    }

    public Optional<ReleaseRecord> findById(String releaseId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM releases WHERE id = ?")) {
                statement.setString(1, releaseId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load release", e);
            }
        }
    }

    public List<ReleaseRecord> forScan(String scanRunId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM releases WHERE scan_run_id = ? ORDER BY created_at DESC, rowid DESC""")) {
                statement.setString(1, scanRunId);
                return list(statement);
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list releases", e);
            }
        }
    }

    public List<ReleaseRecord> forProject(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT r.* FROM releases r
                    JOIN scan_runs s ON s.id = r.scan_run_id
                    WHERE s.project_id = ? ORDER BY r.created_at DESC, r.rowid DESC""")) {
                statement.setLong(1, projectId);
                return list(statement);
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list project releases", e);
            }
        }
    }

    public List<ReleaseSummary> summariesForProject(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT r.id, r.scan_run_id, r.release_name, r.policy_result,
                           r.comparison_json, r.created_at
                    FROM releases r JOIN scan_runs s ON s.id = r.scan_run_id
                    WHERE s.project_id = ? ORDER BY r.created_at DESC, r.rowid DESC""")) {
                statement.setLong(1, projectId);
                try (ResultSet result = statement.executeQuery()) {
                    List<ReleaseSummary> summaries = new ArrayList<>();
                    while (result.next()) {
                        summaries.add(new ReleaseSummary(result.getString("id"),
                                result.getString("scan_run_id"), result.getString("release_name"),
                                result.getString("policy_result"), result.getString("comparison_json"),
                                Instant.parse(result.getString("created_at"))));
                    }
                    return summaries;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list project release summaries", e);
            }
        }
    }

    public Optional<ReleaseRecord> latestForProject(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT r.* FROM releases r
                    JOIN scan_runs s ON s.id = r.scan_run_id
                    WHERE s.project_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1""")) {
                statement.setLong(1, projectId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load latest project release", e);
            }
        }
    }

    private static List<ReleaseRecord> list(PreparedStatement statement) throws SQLException {
        try (ResultSet result = statement.executeQuery()) {
            List<ReleaseRecord> releases = new ArrayList<>();
            while (result.next()) releases.add(map(result));
            return releases;
        }
    }

    private static ReleaseRecord map(ResultSet result) throws SQLException {
        return new ReleaseRecord(result.getString("id"), result.getString("scan_run_id"),
                result.getString("release_name"), result.getString("manifest_json"),
                result.getString("policy_result"), result.getString("report_json"),
                result.getString("comparison_json"), Instant.parse(result.getString("created_at")));
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }
}
