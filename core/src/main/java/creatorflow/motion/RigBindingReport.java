package creatorflow.motion;

import java.util.List;

/**
 * How much of one animation's channel set a given rig can actually bind.
 *
 * <p>This is a structural answer, not a playback one. It says nothing about whether the clip loads
 * or plays — {@code probePlayability} in the Studio plugin answers that, and answers it {@code true}
 * even for a clip whose channels bind to nothing (see
 * {@code docs/superpowers/plans/2026-07-31-phaseB-task0-spike-note.md}, finding 3: Roblox neither
 * errors nor warns when an animation's channels do not match a rig's joints; it silently plays the
 * ones that do). The two facts are reported side by side and never merged: "it loaded" and "most of
 * it binds to this rig" are different claims and a person deciding on a release needs both.
 *
 * @param rig           the skeleton this was measured against ({@code R6}, {@code R15}, …)
 * @param channels      distinct joint names the animation targets
 * @param boundChannels how many of those the rig has a joint for
 * @param unboundJoints the names with no place on this rig, sorted, capped at
 *                      {@link RigCompatibility#MAX_LISTED_UNBOUND_JOINTS} — evidence for whoever
 *                      reads the row, never the measurement itself
 */
public record RigBindingReport(String rig, int channels, int boundChannels, List<String> unboundJoints) {

    public RigBindingReport {
        rig = MotionValidation.requireText(rig, "rig name");
        if (channels < 0 || boundChannels < 0 || boundChannels > channels) {
            throw new MotionValidationException("bound channels must be between 0 and the channel count");
        }
        unboundJoints = unboundJoints == null ? List.of() : List.copyOf(unboundJoints);
    }

    /**
     * Percentage of channels that bind, <em>floored</em>.
     *
     * <p>Floored rather than rounded so the number shown never contradicts the warning beside it:
     * 149 of 200 channels is 74.5%, which rounds up to the threshold value of 75% while still being
     * under it. A row reading "75% of channels bind" next to a below-threshold warning is a row
     * nobody can act on.
     */
    public int boundPercent() {
        return channels == 0 ? 0 : boundChannels * 100 / channels;
    }

    /**
     * Whether this rig binds too little of the clip to call it playable there.
     *
     * <p>False for a clip with no channels at all: nothing was observed, so there is nothing to
     * warn about — the same discipline {@link PlaybackSettings#unknown()} applies.
     */
    public boolean belowThreshold() {
        return channels > 0 && boundPercent() < RigCompatibility.MIN_BOUND_PERCENT;
    }
}
