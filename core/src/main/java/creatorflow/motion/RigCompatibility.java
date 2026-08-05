package creatorflow.motion;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.TreeSet;

/**
 * Structural rig-compatibility check: does the rig even have the joints this animation animates?
 *
 * <p>Roblox's engine answers this question by not answering it. An animation whose channels name
 * joints a rig does not have still loads, still plays, still reports a sane {@code Length} and a
 * true {@code IsPlaying} — the unmatched channels are simply ignored, with no error and no warning
 * (the Phase B Task 0 spike confirmed this live). So a live playback probe reports {@code ok:true}
 * for a clip that visibly does nothing on the rig it was tested against. This class supplies the
 * missing dimension by comparing joint <em>names</em>: what fraction of the animation's channels
 * has somewhere to land.
 *
 * <p>Pure and Studio-free on purpose. It reads the joint paths already present in a
 * {@link NormalizedAnimation} and compares them against a {@link RigSkeleton}, so it produces
 * evidence for every comparison — including comparisons where no live probe ran at all.
 */
public final class RigCompatibility {

    /**
     * Below this percentage of bound channels, the rig is reported as a warning rather than left to
     * imply playability.
     *
     * <p>Chosen against the two shapes that actually occur:
     *
     * <ul>
     *   <li>A clip authored for the rig binds <em>every</em> channel — 100%. Compatible work sits at
     *       the top of the range, not near the threshold.
     *   <li>A rig-type mismatch binds 12–28%: {@code HumanoidRootPart} and {@code Head} are the only
     *       names R6 and R15 spell the same way, so an R15 clip on an R6 dummy binds 2 of 16 and an
     *       R6 clip on an R15 dummy binds 2 of 7.
     * </ul>
     *
     * <p>75% sits clear of both. It fires when at least a quarter of the authored motion is being
     * silently discarded — the point at which the animation someone reviewed is not the animation
     * that plays — and stays quiet for a clip carrying a couple of prop or accessory channels a
     * stock dummy has no part for, which is ordinary authoring and would otherwise cry wolf on every
     * comparison until people learned to ignore the row.
     *
     * <p>Not frozen the way {@code CURVE_SAMPLES_PER_SECOND} is: nothing fingerprints from it and no
     * stored record is invalidated by changing it. It is re-derived for every view of a comparison.
     */
    public static final int MIN_BOUND_PERCENT = 75;

    /** How many unbound joint names a report carries as examples. The counts are never capped. */
    public static final int MAX_LISTED_UNBOUND_JOINTS = 12;

    private RigCompatibility() {
    }

    /** Checks every joint path the animation keys, across all of its keyframes. */
    public static RigBindingReport check(NormalizedAnimation animation, RigSkeleton rig) {
        if (animation == null) {
            throw new MotionValidationException("animation is required");
        }
        List<String> jointPaths = new ArrayList<>();
        for (NormalizedKeyframe keyframe : animation.keyframes()) {
            for (NormalizedPose pose : keyframe.poses()) {
                jointPaths.add(pose.jointPath());
            }
        }
        return check(jointPaths, rig);
    }

    /**
     * Checks a collection of joint paths — repeats and hierarchy prefixes included, since the same
     * joint is keyed on many keyframes and arrives as a full {@code Root/Torso/Left Arm} path.
     */
    public static RigBindingReport check(Collection<String> jointPaths, RigSkeleton rig) {
        if (rig == null) {
            throw new MotionValidationException("rig is required");
        }
        if (jointPaths == null) {
            throw new MotionValidationException("jointPaths is required");
        }
        // Sorted sets throughout: the channel set is what is measured, and a stable order makes the
        // listed examples the same for the same clip every time it is read.
        TreeSet<String> channels = new TreeSet<>();
        for (String jointPath : jointPaths) {
            String jointName = leafJointName(jointPath);
            if (!jointName.isEmpty()) {
                channels.add(jointName);
            }
        }
        TreeSet<String> unbound = new TreeSet<>();
        int bound = 0;
        for (String jointName : channels) {
            if (rig.hasJoint(jointName)) {
                bound++;
            } else {
                unbound.add(jointName);
            }
        }
        List<String> listed = unbound.stream().limit(MAX_LISTED_UNBOUND_JOINTS).toList();
        return new RigBindingReport(rig.name(), channels.size(), bound, listed);
    }

    /**
     * The segment a Pose actually binds on. Joint paths arrive as the Studio plugin's
     * {@code appendPose} builds them — the Pose hierarchy joined with {@code /} — and only the last
     * segment names the joint; the rest is the ancestry it hangs from.
     */
    private static String leafJointName(String jointPath) {
        if (jointPath == null) {
            return "";
        }
        String trimmed = jointPath.strip();
        int lastSeparator = trimmed.lastIndexOf('/');
        return lastSeparator < 0 ? trimmed : trimmed.substring(lastSeparator + 1).strip();
    }
}
