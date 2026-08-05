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
        String rigBindingJsonRaw,
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

    /**
     * Structural joint-overlap evidence: how much of each side binds to the stock R6/R15 skeletons.
     *
     * <p>Kept in its own column rather than folded into {@link #playabilityJson()} because the two
     * have different provenance. Playability is what the Studio plugin observed on a live rig; this
     * is derived locally from the submitted joint paths, and it exists for comparisons where no live
     * probe ever ran. Mixing them would make "a report exists for this rig" — the thing the UI reads
     * as VERIFIED — stop meaning "a live check happened".
     *
     * <p>Absent for comparisons stored before this field existed; the joint paths are not retained,
     * so it cannot be backfilled.
     */
    public java.util.Optional<String> rigBindingJson() {
        return java.util.Optional.ofNullable(rigBindingJsonRaw);
    }
}
