package creatorflow.motion;

import java.util.List;

/**
 * Result of engine v2, shaped to match the TypeScript {@code MotionComparisonV2} interface it is
 * parity-locked against.
 *
 * <p>Field names follow the TS side (notably {@code engineVersion}, not {@code algorithmVersion})
 * because this is a port and a reader comparing the two files should not have to translate names.
 * The bridge maps {@code engineVersion} onto the stored record's algorithm-version column.
 *
 * <p>{@code limitations} has no TS counterpart and is deliberately excluded from the parity
 * comparison: it is evidence-record prose for a person, not a computed number.
 */
public record MotionComparisonV2Result(
        String engineVersion,
        String sourceAssetId,
        String candidateAssetId,
        String sourceFingerprint,
        String candidateFingerprint,
        double overallPercent,
        double posePercent,
        double timingPercent,
        double coveragePercent,
        double durationPercent,
        double warpScore,
        boolean exactCurveData,
        MotionVerdict verdict,
        List<MotionJointScore> jointScores,
        List<FrameScore> frameScores,
        int commonJointCount,
        int allJointCount,
        boolean mirrored,
        List<String> limitations) {

    public MotionComparisonV2Result {
        jointScores = List.copyOf(jointScores);
        frameScores = List.copyOf(frameScores);
        limitations = List.copyOf(limitations);
    }

    /**
     * v2 reports only the index and the score per frame.
     *
     * <p>v1's per-frame source/candidate times are meaningless here: after DTW the frame is no
     * longer one point in time on each clip, it is a set of aligned pairs. Reporting a single
     * candidate time for it would be inventing a number, so the fields are absent rather than
     * filled in.
     */
    public record FrameScore(int sampleIndex, double posePercent) {
    }
}
