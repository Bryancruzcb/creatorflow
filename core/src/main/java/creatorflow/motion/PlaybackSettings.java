package creatorflow.motion;

/**
 * An animation's playback settings — the properties that change how a clip plays without changing
 * a single curve value.
 *
 * <p>These sit deliberately <em>outside</em> {@link MotionComparisonEngine#fingerprint}. That
 * digest covers curve data only, and that is the honest thing for it to cover: two clips with
 * identical curves and different loop flags genuinely do have identical curve data, which is what
 * an {@code EXACT_CURVE_DATA} verdict says. Folding playback settings into the fingerprint would
 * make that verdict wrong in the other direction.
 *
 * <p>But "did this animation change since the last known good?" is a different question from "are
 * these two clips the same curve", and for that question a flipped {@code Looped} very much is a
 * change. So the settings are recorded beside the fingerprint and compared separately — see
 * {@link MotionSnapshots#classify(String, PlaybackSettings, String, PlaybackSettings)}.
 *
 * <p>{@link #unknown()} represents a snapshot taken before these were recorded. Unknown is never
 * reported as a change: the tool cannot claim a difference it never observed.
 */
public record PlaybackSettings(Boolean looped, String priority) {

    private static final PlaybackSettings UNKNOWN = new PlaybackSettings(null, null);

    public PlaybackSettings {
        priority = priority == null || priority.isBlank() ? null : priority.strip();
    }

    /** Nothing was recorded — neither equal to nor different from any other value. */
    public static PlaybackSettings unknown() {
        return UNKNOWN;
    }

    public static PlaybackSettings of(boolean looped, String priority) {
        return new PlaybackSettings(looped, priority);
    }

    /** True when at least one setting was actually observed. */
    public boolean isKnown() {
        return looped != null || priority != null;
    }

    /**
     * Whether this differs from {@code other} in a way worth reporting. Only settings observed on
     * <em>both</em> sides are compared, so an upgrade that starts recording a setting does not
     * retroactively read as drift.
     */
    public boolean differsFrom(PlaybackSettings other) {
        if (other == null) return false;
        if (looped != null && other.looped != null && !looped.equals(other.looped)) return true;
        return priority != null && other.priority != null && !priority.equals(other.priority);
    }
}
