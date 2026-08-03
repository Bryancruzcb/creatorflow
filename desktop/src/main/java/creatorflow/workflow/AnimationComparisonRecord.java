package creatorflow.workflow;

import creatorflow.motion.PlaybackSettings;
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
        PlaybackSettings sourceSettings,
        PlaybackSettings candidateSettings,
        String playabilityJsonRaw,
        String sourceClipKindRaw,
        String candidateClipKindRaw,
        Instant createdAt) {

    /** Raw playability JSON, if a probe ran for this comparison — absent for anything checked before this field existed. */
    public java.util.Optional<String> playabilityJson() {
        return java.util.Optional.ofNullable(playabilityJsonRaw);
    }

    /** "KEYFRAME" or "CURVE_SAMPLED" — absent for comparisons made before Phase C shipped. */
    public java.util.Optional<String> sourceClipKind() {
        return java.util.Optional.ofNullable(sourceClipKindRaw);
    }

    /** "KEYFRAME" or "CURVE_SAMPLED" — absent for comparisons made before Phase C shipped. */
    public java.util.Optional<String> candidateClipKind() {
        return java.util.Optional.ofNullable(candidateClipKindRaw);
    }
}
