package creatorflow.motion;

import java.util.List;

/** Evidence-oriented output from the normalized motion comparison engine. */
public record MotionComparisonResult(
        String algorithmVersion,
        String sourceAssetId,
        String candidateAssetId,
        String sourceFingerprint,
        String candidateFingerprint,
        double overallPercent,
        double posePercent,
        double timingPercent,
        double coveragePercent,
        boolean exactCurveData,
        MotionVerdict verdict,
        List<MotionJointScore> jointScores,
        List<MotionFrameScore> frameScores,
        List<String> limitations) {

    public MotionComparisonResult {
        algorithmVersion = MotionValidation.requireText(algorithmVersion, "algorithmVersion");
        sourceAssetId = MotionValidation.requireText(sourceAssetId, "sourceAssetId");
        candidateAssetId = MotionValidation.requireText(candidateAssetId, "candidateAssetId");
        sourceFingerprint = MotionValidation.requireText(sourceFingerprint, "sourceFingerprint");
        candidateFingerprint = MotionValidation.requireText(candidateFingerprint, "candidateFingerprint");
        MotionValidation.requirePercent(overallPercent, "overallPercent");
        MotionValidation.requirePercent(posePercent, "posePercent");
        MotionValidation.requirePercent(timingPercent, "timingPercent");
        MotionValidation.requirePercent(coveragePercent, "coveragePercent");
        if (verdict == null) {
            throw new MotionValidationException("verdict is required");
        }
        jointScores = jointScores == null ? List.of() : List.copyOf(jointScores);
        frameScores = frameScores == null ? List.of() : List.copyOf(frameScores);
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }

    /** Compatibility alias for callers that use score-oriented naming. */
    public double overallScore() {
        return overallPercent;
    }

    /** Compatibility alias for callers that use score-oriented naming. */
    public double poseScore() {
        return posePercent;
    }

    /** Compatibility alias for callers that use score-oriented naming. */
    public double timingScore() {
        return timingPercent;
    }

    /** Compatibility alias for callers that use score-oriented naming. */
    public double coverageScore() {
        return coveragePercent;
    }
}
