package creatorflow.workflow;

import java.time.Instant;

/** Immutable local evidence produced by one Roblox animation comparison. */
public record AnimationComparisonRecord(
        String id,
        long projectId,
        String sourceAssetId,
        String candidateAssetId,
        String sourceName,
        String candidateName,
        double sourceDuration,
        double candidateDuration,
        String sourceFingerprint,
        String candidateFingerprint,
        int overallScore,
        int poseScore,
        int timingScore,
        int coverageScore,
        boolean exactCurveData,
        String resultJson,
        String algorithmVersion,
        Instant createdAt) {
}
