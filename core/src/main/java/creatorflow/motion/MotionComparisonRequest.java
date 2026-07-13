package creatorflow.motion;

/** Two normalized animations to compare. */
public record MotionComparisonRequest(
        NormalizedAnimation source,
        NormalizedAnimation candidate) {

    public MotionComparisonRequest {
        if (source == null) {
            throw new MotionValidationException("source animation is required");
        }
        if (candidate == null) {
            throw new MotionValidationException("candidate animation is required");
        }
    }
}
