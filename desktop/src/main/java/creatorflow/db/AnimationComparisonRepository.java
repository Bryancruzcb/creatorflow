package creatorflow.db;

import creatorflow.workflow.AnimationComparisonRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persists immutable summaries and detailed results without retaining raw joint curves. */
public final class AnimationComparisonRepository {

    private final Connection connection;

    public AnimationComparisonRepository(Database database) {
        this.connection = database.connection();
    }

    public AnimationComparisonRecord insert(long projectId,
                                            String sourceAssetId, String candidateAssetId,
                                            String sourceName, String candidateName,
                                            double sourceDuration, double candidateDuration,
                                            String sourceFingerprint, String candidateFingerprint,
                                            int overallScore, int poseScore, int timingScore,
                                            int coverageScore, boolean exactCurveData,
                                            String resultJson, String algorithmVersion) {
        AnimationComparisonRecord record = new AnimationComparisonRecord(
                UUID.randomUUID().toString(), projectId,
                requireText(sourceAssetId, "source asset ID"),
                requireText(candidateAssetId, "candidate asset ID"),
                displayName(sourceName, sourceAssetId), displayName(candidateName, candidateAssetId),
                finiteNonNegative(sourceDuration, "source duration"),
                finiteNonNegative(candidateDuration, "candidate duration"),
                requireText(sourceFingerprint, "source fingerprint"),
                requireText(candidateFingerprint, "candidate fingerprint"),
                score(overallScore, "overall score"), score(poseScore, "pose score"),
                score(timingScore, "timing score"), score(coverageScore, "coverage score"),
                exactCurveData, requireText(resultJson, "comparison result"),
                requireText(algorithmVersion, "algorithm version"), Instant.now());
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO animation_comparisons(
                      id, project_id, source_asset_id, candidate_asset_id, source_name, candidate_name,
                      source_duration, candidate_duration, source_fingerprint, candidate_fingerprint,
                      overall_score, pose_score, timing_score, coverage_score, exact_curve_data,
                      result_json, algorithm_version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")) {
                statement.setString(1, record.id());
                statement.setLong(2, record.projectId());
                statement.setString(3, record.sourceAssetId());
                statement.setString(4, record.candidateAssetId());
                statement.setString(5, record.sourceName());
                statement.setString(6, record.candidateName());
                statement.setDouble(7, record.sourceDuration());
                statement.setDouble(8, record.candidateDuration());
                statement.setString(9, record.sourceFingerprint());
                statement.setString(10, record.candidateFingerprint());
                statement.setInt(11, record.overallScore());
                statement.setInt(12, record.poseScore());
                statement.setInt(13, record.timingScore());
                statement.setInt(14, record.coverageScore());
                statement.setInt(15, record.exactCurveData() ? 1 : 0);
                statement.setString(16, record.resultJson());
                statement.setString(17, record.algorithmVersion());
                statement.setString(18, record.createdAt().toString());
                statement.executeUpdate();
                return record;
            } catch (SQLException error) {
                throw new IllegalStateException("Could not persist animation comparison", error);
            }
        }
    }

    public Optional<AnimationComparisonRecord> findById(String id) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM animation_comparisons WHERE id = ?")) {
                statement.setString(1, requireText(id, "comparison ID"));
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not load animation comparison", error);
            }
        }
    }

    public List<AnimationComparisonRecord> forProject(long projectId, int limit, int offset) {
        int safeLimit = Math.max(1, Math.min(limit, 100));
        int safeOffset = Math.max(0, offset);
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM animation_comparisons
                    WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?""")) {
                statement.setLong(1, projectId);
                statement.setInt(2, safeLimit);
                statement.setInt(3, safeOffset);
                try (ResultSet result = statement.executeQuery()) {
                    List<AnimationComparisonRecord> records = new ArrayList<>();
                    while (result.next()) records.add(map(result));
                    return records;
                }
            } catch (SQLException error) {
                throw new IllegalStateException("Could not list animation comparisons", error);
            }
        }
    }

    private static AnimationComparisonRecord map(ResultSet result) throws SQLException {
        return new AnimationComparisonRecord(
                result.getString("id"), result.getLong("project_id"),
                result.getString("source_asset_id"), result.getString("candidate_asset_id"),
                result.getString("source_name"), result.getString("candidate_name"),
                result.getDouble("source_duration"), result.getDouble("candidate_duration"),
                result.getString("source_fingerprint"), result.getString("candidate_fingerprint"),
                result.getInt("overall_score"), result.getInt("pose_score"),
                result.getInt("timing_score"), result.getInt("coverage_score"),
                result.getInt("exact_curve_data") != 0, result.getString("result_json"),
                result.getString("algorithm_version"), Instant.parse(result.getString("created_at")));
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }

    private static String displayName(String value, String fallback) {
        return value == null || value.isBlank() ? requireText(fallback, "asset ID") : value.strip();
    }

    private static double finiteNonNegative(double value, String label) {
        if (!Double.isFinite(value) || value < 0) throw new IllegalArgumentException(label + " is invalid");
        return value;
    }

    private static int score(int value, String label) {
        if (value < 0 || value > 100) throw new IllegalArgumentException(label + " is invalid");
        return value;
    }
}
