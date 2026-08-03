// core/src/test/java/creatorflow/motion/MotionV2ParityOracle.java
package creatorflow.motion;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Cases for the engine-v2 parity oracle: every v1 case (which covers divergences 1-3 — the
 * multiplicative coverage composition, the de-weighted position blend and the banded DTW) plus
 * mirror cases, which v1's list cannot cover because not one of its animations has a left/right
 * joint name. Without these the mirror half of the Java port would be graded by nothing at all.
 *
 * <p>The mirrored candidates are built here by an INDEPENDENT reflection — negate x, negate the four
 * off-diagonal rotation entries, swap the paired names — rather than by calling
 * {@link MirrorCanonical}. Using the implementation under test to build its own fixture would grade
 * it against itself.
 *
 * <p>These fixtures do share the simplified mirror model that {@code mirrorCanonical.ts} documents
 * (local-transform reflection, not a world-space mirror re-expressed per bone rest frame). That is
 * acceptable here for a reason specific to this test's job: the question is whether Java and
 * TypeScript agree on the same input, not whether the mirror model is faithful to Roblox. The
 * model's fidelity is a separate, openly-unmeasured question recorded in the test-set README.
 */
final class MotionV2ParityOracle {

    record OracleCase(String id, String description,
                      NormalizedAnimation source, NormalizedAnimation candidate) {
    }

    private MotionV2ParityOracle() {
    }

    static List<OracleCase> cases() {
        List<OracleCase> cases = new ArrayList<>();
        for (MotionParityOracle.OracleCase shared : MotionParityOracle.cases()) {
            cases.add(new OracleCase(shared.id(), shared.description(), shared.source(), shared.candidate()));
        }

        // Two mutual pairs, asymmetric performance: the mirror is genuinely a different clip, so the
        // direct comparison collapses and the mirrored orientation should win.
        Map<String, String> armLeg = swap("ArmL", "ArmR", "LegL", "LegR");
        NormalizedAnimation trailing = asymmetric("m-trailing", "ArmL", "ArmR", "LegL", "LegR");
        cases.add(new OracleCase("v2-mirror-trailing-suffix",
                "cleanly mirrored copy, HandL/HandR-style trailing side letter",
                trailing, reflect("m-trailing-mirror", trailing, armLeg)));

        // Infix side letter between underscores, the second naming convention in the vendored rigs.
        Map<String, String> infix = swap("leg_joint_L_1", "leg_joint_R_1", "arm_joint_L_2", "arm_joint_R_2");
        NormalizedAnimation infixSource =
                asymmetric("m-infix", "leg_joint_L_1", "leg_joint_R_1", "arm_joint_L_2", "arm_joint_R_2");
        cases.add(new OracleCase("v2-mirror-infix-side-letter",
                "cleanly mirrored copy, leg_joint_L_1/leg_joint_R_1-style infix side letter",
                infixSource, reflect("m-infix-mirror", infixSource, infix)));

        // Left/Right word with DIFFERENT numeric suffixes per side, which the pairing must strip.
        Map<String, String> words = swap("LeftHand_23", "RightHand_41", "LeftFoot_7", "RightFoot_9");
        NormalizedAnimation wordSource =
                asymmetric("m-word", "LeftHand_23", "RightHand_41", "LeftFoot_7", "RightFoot_9");
        cases.add(new OracleCase("v2-mirror-left-right-word",
                "cleanly mirrored copy, LeftHand_23/RightHand_41-style word with unequal suffixes",
                wordSource, reflect("m-word-mirror", wordSource, words)));

        // NO mutual pair: buildMirrorMap comes back empty, so mirroring is refused and the direct
        // (collapsed) score must stand. This is the free-extra-draw guard actually firing.
        NormalizedAnimation unpaired = twoJointAsymmetric("m-unpaired", "Root/Hip", "Rig/Spine");
        cases.add(new OracleCase("v2-mirror-no-pairs-refused",
                "no left/right joint names at all: mirroring must be refused outright",
                unpaired, reflect("m-unpaired-mirror", unpaired, swap())));

        /*
         * ONE left/right pair, which IS allowed — and worth a case because the threshold does not
         * read the way its name suggests.
         *
         * MIRROR_MIN_PAIRS is 2, but buildMirrorMap stores both directions of every mutual pair
         * (A -> B and B -> A), so a single pair already yields size 2 and clears the guard. The
         * effective floor is one pair, not two; only a clip with no mutual pair at all is refused.
         *
         * The floor stays. Raising it would change which clips get a second orientation and
         * therefore change scores the web already ships and the scorecard already grades — a
         * product decision, not something to slip into a parity change. What was corrected instead,
         * on 2026-08-02 by owner decision, is the TypeScript comment beside the constant, which used
         * to describe a two-pair floor the code does not implement. This case keeps the floor itself
         * pinned from a test rather than from prose.
         */
        NormalizedAnimation onePair = twoJointAsymmetric("m-onepair", "ArmL", "ArmR");
        cases.add(new OracleCase("v2-mirror-single-pair-allowed",
                "one left/right pair yields two map entries, so it clears MIRROR_MIN_PAIRS",
                onePair, reflect("m-onepair-mirror", onePair, swap("ArmL", "ArmR"))));

        // Paired names present, but the candidate is an unrelated motion: the mirrored orientation
        // must lose and the direct result must be kept. This is the case that shows taking a maximum
        // has not become a free upgrade.
        cases.add(new OracleCase("v2-mirror-orientation-loses",
                "left/right names but an unrelated candidate: mirrored orientation must not win",
                asymmetric("m-lose-a", "ArmL", "ArmR", "LegL", "LegR"),
                unrelated("m-lose-b", "ArmL", "ArmR", "LegL", "LegR")));

        // Identical curve data on a mirrorable rig: exactness must short-circuit before any mirror
        // work, so `mirrored` must come back false even though the rig could be mirrored.
        NormalizedAnimation exact = asymmetric("m-exact", "ArmL", "ArmR", "LegL", "LegR");
        cases.add(new OracleCase("v2-mirror-exact-short-circuits",
                "identical curves on a mirrorable rig: exact wins before mirroring is attempted",
                exact, asymmetric("m-exact-copy", "ArmL", "ArmR", "LegL", "LegR")));

        return List.of(cases.toArray(OracleCase[]::new));
    }

    // ---------- builders ----------

    private static Map<String, String> swap(String... pairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put(pairs[i], pairs[i + 1]);
            map.put(pairs[i + 1], pairs[i]);
        }
        return map;
    }

    private static double[] yawMatrix(double degrees) {
        double angle = Math.toRadians(degrees);
        double cosine = Math.cos(angle);
        double sine = Math.sin(angle);
        return new double[] {cosine, 0.0, sine, 0.0, 1.0, 0.0, -sine, 0.0, cosine};
    }

    private static NormalizedPose pose(String path, double x, double yawDegrees) {
        double[] rotation = yawMatrix(yawDegrees);
        return new NormalizedPose(path,
                List.of(x, 0.0, 0.0,
                        rotation[0], rotation[1], rotation[2],
                        rotation[3], rotation[4], rotation[5],
                        rotation[6], rotation[7], rotation[8]),
                1.0, "Linear", "InOut");
    }

    private static NormalizedAnimation anim(String id, double duration, List<NormalizedKeyframe> frames) {
        return new NormalizedAnimation(id, "case-" + id, duration, false, "Movement", frames);
    }

    /**
     * A performance that is NOT left/right symmetric, so that mirroring it produces genuinely
     * different curve data. A symmetric performance mirrors onto itself, which would make the
     * candidate byte-identical to the source and short-circuit as exact before mirroring ran.
     */
    private static NormalizedAnimation asymmetric(String id, String leftA, String rightA, String leftB, String rightB) {
        return anim(id, 1.0, List.of(
                new NormalizedKeyframe(0.0, List.of(
                        pose(leftA, 0.30, 40.0), pose(rightA, 0.10, 10.0),
                        pose(leftB, 0.20, 25.0), pose(rightB, -0.15, -5.0))),
                new NormalizedKeyframe(0.5, List.of(
                        pose(leftA, 0.42, 55.0), pose(rightA, 0.08, -2.0),
                        pose(leftB, 0.28, 38.0), pose(rightB, -0.20, -12.0))),
                new NormalizedKeyframe(1.0, List.of(
                        pose(leftA, 0.50, 70.0), pose(rightA, 0.05, -15.0),
                        pose(leftB, 0.35, 50.0), pose(rightB, -0.25, -20.0)))));
    }

    private static NormalizedAnimation twoJointAsymmetric(String id, String left, String right) {
        return anim(id, 1.0, List.of(
                new NormalizedKeyframe(0.0, List.of(pose(left, 0.30, 40.0), pose(right, 0.10, 10.0))),
                new NormalizedKeyframe(1.0, List.of(pose(left, 0.50, 70.0), pose(right, 0.05, -15.0)))));
    }

    /** An unrelated motion on the same rig: paired names, nothing mirrored about it. */
    private static NormalizedAnimation unrelated(String id, String leftA, String rightA, String leftB, String rightB) {
        return anim(id, 1.0, List.of(
                new NormalizedKeyframe(0.0, List.of(
                        pose(leftA, -0.45, 150.0), pose(rightA, 0.40, -120.0),
                        pose(leftB, 0.05, 95.0), pose(rightB, -0.48, 170.0))),
                new NormalizedKeyframe(1.0, List.of(
                        pose(leftA, 0.47, -95.0), pose(rightA, -0.30, 160.0),
                        pose(leftB, -0.42, -140.0), pose(rightB, 0.44, 60.0)))));
    }

    /**
     * The reflection, written independently of {@link MirrorCanonical}: negate x, negate the four
     * off-diagonal rotation entries that {@code R -> M R M} flips, and rename through the given
     * pairing. Zeros are kept positive because -0.0 breaks exact-equality round-trips.
     */
    private static NormalizedAnimation reflect(String id, NormalizedAnimation clip, Map<String, String> swap) {
        List<NormalizedKeyframe> frames = new ArrayList<>(clip.keyframes().size());
        for (NormalizedKeyframe keyframe : clip.keyframes()) {
            List<NormalizedPose> poses = new ArrayList<>(keyframe.poses().size());
            for (NormalizedPose original : keyframe.poses()) {
                List<Double> t = original.transform();
                List<Double> mirrored = List.of(
                        keepPositiveZero(-t.get(0)), t.get(1), t.get(2),
                        t.get(3), keepPositiveZero(-t.get(4)), keepPositiveZero(-t.get(5)),
                        keepPositiveZero(-t.get(6)), t.get(7), t.get(8),
                        keepPositiveZero(-t.get(9)), t.get(10), t.get(11));
                poses.add(new NormalizedPose(
                        swap.getOrDefault(original.jointPath(), original.jointPath()),
                        mirrored, original.weight(), original.easingStyle(), original.easingDirection()));
            }
            frames.add(new NormalizedKeyframe(keyframe.time(), poses));
        }
        return anim(id, clip.duration(), frames);
    }

    private static double keepPositiveZero(double value) {
        return value == 0.0 ? 0.0 : value;
    }
}
