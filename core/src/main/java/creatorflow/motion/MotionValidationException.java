package creatorflow.motion;

/**
 * Signals that normalized motion data cannot be compared safely.
 */
public final class MotionValidationException extends IllegalArgumentException {

    public MotionValidationException(String message) {
        super(message);
    }
}
