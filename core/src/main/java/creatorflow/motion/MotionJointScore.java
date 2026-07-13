package creatorflow.motion;

/** Aggregate comparison measurements for one normalized joint path. */
public record MotionJointScore(
        String jointPath,
        boolean presentInSource,
        boolean presentInCandidate,
        double posePercent,
        double meanPositionDelta,
        double maxPositionDelta,
        double meanRotationDeltaDegrees,
        double maxRotationDeltaDegrees) {

    public MotionJointScore {
        jointPath = MotionValidation.requireText(jointPath, "jointPath");
        MotionValidation.requirePercent(posePercent, "posePercent");
        requireNonNegativeFinite(meanPositionDelta, "meanPositionDelta");
        requireNonNegativeFinite(maxPositionDelta, "maxPositionDelta");
        requireNonNegativeFinite(meanRotationDeltaDegrees, "meanRotationDeltaDegrees");
        requireNonNegativeFinite(maxRotationDeltaDegrees, "maxRotationDeltaDegrees");
    }

    private static void requireNonNegativeFinite(double value, String field) {
        MotionValidation.requireFinite(value, field);
        if (value < 0.0) {
            throw new MotionValidationException(field + " must not be negative");
        }
    }
}
