package creatorflow.motion;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Mirror canonicalization for the Java side of engine v2 — a faithful port of
 * frontend/src/motion/mirrorCanonical.ts.
 *
 * <p>PORT CONTRACT: this must agree with the TypeScript module joint-for-joint and bit-for-bit.
 * The reasoning for the algorithm lives in the TS file and is not duplicated here; what follows
 * records only the things that are easy to get wrong when translating it.
 *
 * <ul>
 *   <li>{@code jointsOf} walks keyframes and poses in their ORIGINAL order, not sorted order, so
 *       the pairing sees the same joint list the TS Set-insertion order produces. The resulting
 *       map is order-independent as a mapping, but keeping the walk identical means a future
 *       order-sensitive change cannot silently diverge on one side only.</li>
 *   <li>The {@code Left}/{@code Right} rule replaces the FIRST occurrence only, because
 *       JavaScript's {@code String.replace} with a non-global regex does. {@code replaceAll}
 *       would rename both halves of a name like {@code LeftHandLeftThumb} and stop matching.</li>
 *   <li>Negative zero is normalized back to positive zero, because {@code -0.0} breaks the
 *       exact-equality round-trip the fingerprint depends on.</li>
 * </ul>
 */
final class MirrorCanonical {

    /** @see frontend/src/motion/mirrorCanonical.ts MIRROR_MIN_PAIRS */
    static final int MIRROR_MIN_PAIRS = 2;

    /** Row-major 3x3 entries inside the 12-component transform that R -> M R M negates. */
    private static final int[] NEGATED_ROTATION_INDICES = {4, 5, 6, 9};

    private static final Pattern TRAILING_SIDE = Pattern.compile("^(.*)([LR])$");
    private static final Pattern INFIX_SIDE = Pattern.compile("^(.*_)([LR])(_.*)$");
    private static final Pattern SIDE_WORD = Pattern.compile("Left|Right");
    private static final Pattern NUMERIC_SUFFIX = Pattern.compile("_\\d+$");

    private MirrorCanonical() {
    }

    private static String withoutSuffix(String name) {
        return NUMERIC_SUFFIX.matcher(name).replaceAll("");
    }

    /** Flips the first Left/Right word, mirroring JS replace() with a non-global regex. */
    private static String flipSideWord(String name) {
        Matcher matcher = SIDE_WORD.matcher(name);
        if (!matcher.find()) {
            return name;
        }
        String side = matcher.group();
        return name.substring(0, matcher.start())
                + ("Left".equals(side) ? "Right" : "Left")
                + name.substring(matcher.end());
    }

    /**
     * Pairs left/right joints from the names in one clip, keeping only MUTUAL pairs.
     *
     * <p>A one-way guess would rename a joint onto a name that is not there, which does not read as
     * a failed mirror — it reads as a coverage drop, i.e. a wrong answer with a plausible excuse.
     */
    static Map<String, String> buildMirrorMap(List<String> joints) {
        Set<String> present = new LinkedHashSet<>(joints);
        Map<String, String> candidates = new LinkedHashMap<>();

        for (String joint : joints) {
            Matcher trailing = TRAILING_SIDE.matcher(joint);
            if (trailing.matches()) {
                String swapped = trailing.group(1) + ("L".equals(trailing.group(2)) ? "R" : "L");
                if (present.contains(swapped)) {
                    candidates.put(joint, swapped);
                    continue;
                }
            }
            Matcher infix = INFIX_SIDE.matcher(joint);
            if (infix.matches()) {
                String swapped = infix.group(1)
                        + ("L".equals(infix.group(2)) ? "R" : "L")
                        + infix.group(3);
                if (present.contains(swapped)) {
                    candidates.put(joint, swapped);
                    continue;
                }
            }
            if (SIDE_WORD.matcher(joint).find()) {
                String wanted = flipSideWord(withoutSuffix(joint));
                List<String> matches = new ArrayList<>();
                for (String other : joints) {
                    if (!other.equals(joint) && withoutSuffix(other).equals(wanted)) {
                        matches.add(other);
                    }
                }
                if (matches.size() == 1) {
                    candidates.put(joint, matches.getFirst());
                }
            }
        }

        Map<String, String> mutual = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : candidates.entrySet()) {
            if (entry.getKey().equals(candidates.get(entry.getValue()))) {
                mutual.put(entry.getKey(), entry.getValue());
            }
        }
        return mutual;
    }

    /** Every joint the clip animates, in first-seen order. */
    private static List<String> jointsOf(NormalizedAnimation clip) {
        Set<String> joints = new LinkedHashSet<>();
        for (NormalizedKeyframe keyframe : clip.keyframes()) {
            for (NormalizedPose pose : keyframe.poses()) {
                joints.add(pose.jointPath());
            }
        }
        return new ArrayList<>(joints);
    }

    /**
     * The clip as it would read if performed mirror-image, or {@code null} when it cannot be
     * mirrored meaningfully.
     *
     * <p>Null rather than the clip unchanged: an unmirrorable clip must not be scored a second time
     * against a near-identical copy of itself, which is a free extra draw at the maximum.
     *
     * <p>{@code against} is the clip this one is about to be compared with, and its joint names take
     * part in the pairing. A clip that animates one arm contains no left/right pair to find, because
     * the counterpart joint is never keyed — so pairing must read both clips. That is also what the
     * hypothesis says: "the candidate's left arm is doing what the source's right arm did" is a
     * claim about two clips, so it cannot be tested from one of them.
     */
    static NormalizedAnimation mirrorNormalized(NormalizedAnimation clip, NormalizedAnimation against) {
        Set<String> pairingJoints = new LinkedHashSet<>(jointsOf(clip));
        if (against != null) {
            pairingJoints.addAll(jointsOf(against));
        }
        Map<String, String> swap = buildMirrorMap(new ArrayList<>(pairingJoints));
        if (swap.size() < MIRROR_MIN_PAIRS) {
            return null;
        }

        List<NormalizedKeyframe> keyframes = new ArrayList<>(clip.keyframes().size());
        for (NormalizedKeyframe keyframe : clip.keyframes()) {
            List<NormalizedPose> poses = new ArrayList<>(keyframe.poses().size());
            for (NormalizedPose pose : keyframe.poses()) {
                List<Double> transform = new ArrayList<>(pose.transform());
                transform.set(0, negateKeepingPositiveZero(transform.get(0)));
                for (int index : NEGATED_ROTATION_INDICES) {
                    transform.set(index, negateKeepingPositiveZero(transform.get(index)));
                }
                poses.add(new NormalizedPose(
                        swap.getOrDefault(pose.jointPath(), pose.jointPath()),
                        transform,
                        pose.weight(),
                        pose.easingStyle(),
                        pose.easingDirection()));
            }
            keyframes.add(new NormalizedKeyframe(keyframe.time(), poses));
        }

        return new NormalizedAnimation(
                clip.assetId(), clip.name(), clip.duration(), clip.looped(), clip.priority(), keyframes);
    }

    /** -0.0 breaks exact-equality round-trips downstream; keep zeros positive. */
    private static double negateKeepingPositiveZero(double value) {
        return value == 0.0 ? 0.0 : -value;
    }
}
