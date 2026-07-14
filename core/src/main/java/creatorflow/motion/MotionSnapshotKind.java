package creatorflow.motion;

import java.util.Locale;

/**
 * The role an immutable animation snapshot plays for its asset: the reference a
 * creator has vouched for ({@code LAST_KNOWN_GOOD}) or the version handed off to
 * Studio ({@code LAST_PUBLISHED}). A future comparison can be checked against
 * either to prove an animation has or has not drifted since.
 */
public enum MotionSnapshotKind {
    LAST_KNOWN_GOOD,
    LAST_PUBLISHED;

    /** Parses the wire spelling case-insensitively, rejecting anything unknown. */
    public static MotionSnapshotKind fromWire(String value) {
        String normalized = MotionValidation.requireText(value, "snapshot kind")
                .toUpperCase(Locale.ROOT);
        try {
            return valueOf(normalized);
        } catch (IllegalArgumentException unknown) {
            throw new MotionValidationException("Unknown snapshot kind: " + value);
        }
    }

    public String wire() {
        return name();
    }
}
