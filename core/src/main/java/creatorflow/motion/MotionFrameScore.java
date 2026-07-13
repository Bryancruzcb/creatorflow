package creatorflow.motion;

/** Transform score at one normalized sample across the two animation timelines. */
public record MotionFrameScore(
        int sampleIndex,
        double normalizedTime,
        double sourceTime,
        double candidateTime,
        double posePercent,
        int comparedJointCount) {

    public MotionFrameScore {
        if (sampleIndex < 0) {
            throw new MotionValidationException("sampleIndex must not be negative");
        }
        MotionValidation.requireFinite(normalizedTime, "normalizedTime");
        if (normalizedTime < 0.0 || normalizedTime > 1.0) {
            throw new MotionValidationException("normalizedTime must be between 0 and 1");
        }
        MotionValidation.requireFinite(sourceTime, "sourceTime");
        MotionValidation.requireFinite(candidateTime, "candidateTime");
        MotionValidation.requirePercent(posePercent, "posePercent");
        if (comparedJointCount < 0) {
            throw new MotionValidationException("comparedJointCount must not be negative");
        }
    }
}
