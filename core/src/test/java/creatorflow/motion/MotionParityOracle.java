// core/src/test/java/creatorflow/motion/MotionParityOracle.java
package creatorflow.motion;

import java.util.ArrayList;
import java.util.List;

/**
 * Branch-covering NormalizedAnimation pairs for the TS parity oracle.
 * Every case must construct successfully under MotionValidation (orthonormal
 * right-handed rotations, unique keyframe times, weight 0..1). sample()'s
 * span==0 branch is unreachable through valid input (unique times) and is
 * therefore not oracle-covered — noted in the TS parity test.
 */
final class MotionParityOracle {

    record OracleCase(String id, String description,
                      NormalizedAnimation source, NormalizedAnimation candidate) {
    }

    private MotionParityOracle() {
    }

    static List<OracleCase> cases() {
        List<OracleCase> cases = new ArrayList<>();

        cases.add(new OracleCase("identical-curves", "same curve data, new asset id -> exact override",
                walk("100"), walk("200")));
        cases.add(new OracleCase("uniform-retime", "same poses, duration 1.0 vs 1.25",
                walk("100"), retimedWalk("200", 1.25)));
        cases.add(new OracleCase("edited-pose", "one keyframe moved far",
                walk("100"), editedWalk("200")));
        cases.add(new OracleCase("zero-coverage", "disjoint joint paths",
                walk("100"), otherRig("200")));
        cases.add(new OracleCase("partial-coverage", "one shared joint, one each unshared",
                twoJoint("100", "Root/Hip", "Root/Hip/Arm"), twoJoint("200", "Root/Hip", "Root/Leg")));
        cases.add(new OracleCase("single-keyframe-track", "source track has one key (early-return sampling)",
                singleKey("100"), walk("200")));
        // NOTE: matrix-derived quaternions canonicalize to w>0 in the trace branch, so a
        // 10-vs-350 sweep yields dot = cos(10) > 0 and never negates. 170 vs -170 gives
        // dot = cos(170) < 0 and forces the shortest-arc negation during interpolation.
        cases.add(new OracleCase("slerp-shortest-arc", "yaw 170 vs yaw -170 keys force dot<0 negation",
                yawSweep("100", 170.0, -170.0), yawSweep("200", 170.0, 170.0)));
        cases.add(new OracleCase("slerp-nlerp-fallback", "yaw 0 vs yaw 1 keys force dot>0.9995 fallback",
                yawSweep("100", 0.0, 1.0), yawSweep("200", 0.5, 0.5)));
        cases.add(new OracleCase("matrix-branch-trace", "small yaw rotation (trace>0)",
                rotationPair("100", yawMatrix(30.0)), identityPair("200")));
        cases.add(new OracleCase("matrix-branch-m00", "180 about x (m00-dominant)",
                rotationPair("100", diag(1.0, -1.0, -1.0)), identityPair("200")));
        cases.add(new OracleCase("matrix-branch-m11", "180 about y (m11-dominant)",
                rotationPair("100", diag(-1.0, 1.0, -1.0)), identityPair("200")));
        cases.add(new OracleCase("matrix-branch-else", "180 about z (else branch)",
                rotationPair("100", diag(-1.0, -1.0, 1.0)), identityPair("200")));
        cases.add(new OracleCase("weight-difference", "weight 0.3 vs 0.9",
                weighted("100", 0.3), weighted("200", 0.9)));
        cases.add(new OracleCase("easing-mismatch", "Bounce/In vs Linear/InOut",
                eased("100", "Bounce", "In"), eased("200", "Linear", "InOut")));
        cases.add(new OracleCase("easing-case-insensitive", "LINEAR/INOUT vs Linear/InOut (metadata matches, exact does not)",
                eased("100", "LINEAR", "INOUT"), eased("200", "Linear", "InOut")));
        cases.add(new OracleCase("keyframe-count-mismatch", "3 keys vs 7 keys (quantile index paths)",
                keyed("100", 3), keyed("200", 7)));
        cases.add(new OracleCase("duration-zero-both", "both durations zero",
                still("100"), stillVariant("200")));
        cases.add(new OracleCase("duration-zero-one", "zero vs one second",
                still("100"), walk("200")));
        cases.add(new OracleCase("duration-gap", "0.5s vs 2.0s",
                shortClip("100"), longClip("200")));
        cases.add(new OracleCase("uneven-key-spacing", "same duration, even vs bunched key times",
                keyedAt("100", 0.0, 0.5, 1.0), keyedAt("200", 0.0, 0.05, 1.0)));
        cases.add(new OracleCase("realistic-multi-joint", "8 joints x 12 keys of varied motion",
                realistic("100", 0.0), realistic("200", 7.0)));
        cases.add(new OracleCase("realistic-close-pair", "same as realistic but 2 degrees apart (HIGH band)",
                realistic("100", 0.0), realistic("200", 2.0)));

        return List.of(cases.toArray(OracleCase[]::new));
    }

    // ---------- builders (every transform passes MotionValidation) ----------

    private static List<Double> cframe(double x, double y, double z, double[] rotation) {
        return List.of(x, y, z,
                rotation[0], rotation[1], rotation[2],
                rotation[3], rotation[4], rotation[5],
                rotation[6], rotation[7], rotation[8]);
    }

    private static double[] yawMatrix(double degrees) {
        double angle = Math.toRadians(degrees);
        double cosine = Math.cos(angle);
        double sine = Math.sin(angle);
        return new double[] {cosine, 0.0, sine, 0.0, 1.0, 0.0, -sine, 0.0, cosine};
    }

    private static double[] pitchMatrix(double degrees) {
        double angle = Math.toRadians(degrees);
        double cosine = Math.cos(angle);
        double sine = Math.sin(angle);
        return new double[] {1.0, 0.0, 0.0, 0.0, cosine, -sine, 0.0, sine, cosine};
    }

    private static double[] diag(double a, double b, double c) {
        return new double[] {a, 0.0, 0.0, 0.0, b, 0.0, 0.0, 0.0, c};
    }

    private static NormalizedPose pose(String path, double x, double yawDegrees) {
        return new NormalizedPose(path, cframe(x, 0.0, 0.0, yawMatrix(yawDegrees)), 1.0, "Linear", "InOut");
    }

    private static NormalizedKeyframe frame(double time, NormalizedPose... poses) {
        return new NormalizedKeyframe(time, List.of(poses));
    }

    private static NormalizedAnimation anim(String id, double duration, NormalizedKeyframe... frames) {
        return new NormalizedAnimation(id, "case-" + id, duration, false, "Movement", List.of(frames));
    }

    private static NormalizedAnimation walk(String id) {
        return anim(id, 1.0,
                frame(0.0, pose("Root/Hip", 0.0, 0.0)),
                frame(0.5, pose("Root/Hip", 0.25, 35.0)),
                frame(1.0, pose("Root/Hip", 0.0, 70.0)));
    }

    private static NormalizedAnimation retimedWalk(String id, double factor) {
        return anim(id, factor,
                frame(0.0, pose("Root/Hip", 0.0, 0.0)),
                frame(0.5 * factor, pose("Root/Hip", 0.25, 35.0)),
                frame(factor, pose("Root/Hip", 0.0, 70.0)));
    }

    private static NormalizedAnimation editedWalk(String id) {
        return anim(id, 1.0,
                frame(0.0, pose("Root/Hip", 0.0, 0.0)),
                frame(0.5, pose("Root/Hip", 0.9, 120.0)),
                frame(1.0, pose("Root/Hip", 0.0, 70.0)));
    }

    private static NormalizedAnimation otherRig(String id) {
        return anim(id, 1.0,
                frame(0.0, pose("Rig/Wing", 0.0, 0.0)),
                frame(1.0, pose("Rig/Wing", 0.0, 25.0)));
    }

    private static NormalizedAnimation twoJoint(String id, String first, String second) {
        return anim(id, 1.0,
                frame(0.0, pose(first, 0.0, 0.0), pose(second, 0.0, 0.0)),
                frame(1.0, pose(first, 0.1, 20.0), pose(second, 0.0, -30.0)));
    }

    private static NormalizedAnimation singleKey(String id) {
        return anim(id, 1.0, frame(0.5, pose("Root/Hip", 0.1, 15.0)));
    }

    private static NormalizedAnimation yawSweep(String id, double startDegrees, double endDegrees) {
        return anim(id, 1.0,
                frame(0.0, pose("Root/Hip", 0.0, startDegrees)),
                frame(1.0, pose("Root/Hip", 0.0, endDegrees)));
    }

    private static NormalizedAnimation rotationPair(String id, double[] rotation) {
        NormalizedPose fixed = new NormalizedPose("Root/Hip", cframe(0.0, 0.0, 0.0, rotation), 1.0, "Linear", "InOut");
        return anim(id, 1.0, frame(0.0, fixed), frame(1.0, fixed2(rotation)));
    }

    private static NormalizedPose fixed2(double[] rotation) {
        // Second key must differ in time only; reuse the same rotation so the joint holds still.
        return new NormalizedPose("Root/Hip", cframe(0.0, 0.0, 0.0, rotation), 1.0, "Linear", "InOut");
    }

    private static NormalizedAnimation identityPair(String id) {
        return rotationPair(id, diag(1.0, 1.0, 1.0));
    }

    private static NormalizedAnimation weighted(String id, double weight) {
        NormalizedPose first = new NormalizedPose("Root/Hip", cframe(0.0, 0.0, 0.0, yawMatrix(0.0)), weight, "Linear", "InOut");
        NormalizedPose second = new NormalizedPose("Root/Hip", cframe(0.0, 0.0, 0.0, yawMatrix(10.0)), weight, "Linear", "InOut");
        return anim(id, 1.0, frame(0.0, first), frame(1.0, second));
    }

    private static NormalizedAnimation eased(String id, String style, String direction) {
        NormalizedPose first = new NormalizedPose("Root/Hip", cframe(0.0, 0.0, 0.0, yawMatrix(0.0)), 1.0, style, direction);
        NormalizedPose second = new NormalizedPose("Root/Hip", cframe(0.1, 0.0, 0.0, yawMatrix(20.0)), 1.0, style, direction);
        return anim(id, 1.0, frame(0.0, first), frame(1.0, second));
    }

    private static NormalizedAnimation keyed(String id, int keyCount) {
        NormalizedKeyframe[] frames = new NormalizedKeyframe[keyCount];
        for (int i = 0; i < keyCount; i++) {
            double time = keyCount == 1 ? 0.0 : (double) i / (keyCount - 1);
            frames[i] = frame(time, pose("Root/Hip", 0.05 * i, 10.0 * i));
        }
        return anim(id, 1.0, frames);
    }

    private static NormalizedAnimation keyedAt(String id, double... times) {
        NormalizedKeyframe[] frames = new NormalizedKeyframe[times.length];
        for (int i = 0; i < times.length; i++) {
            frames[i] = frame(times[i], pose("Root/Hip", 0.05 * i, 15.0 * i));
        }
        return anim(id, 1.0, frames);
    }

    private static NormalizedAnimation still(String id) {
        return anim(id, 0.0, frame(0.0, pose("Root/Hip", 0.0, 0.0)));
    }

    private static NormalizedAnimation stillVariant(String id) {
        return anim(id, 0.0, frame(0.0, pose("Root/Hip", 0.2, 25.0)));
    }

    private static NormalizedAnimation shortClip(String id) {
        return anim(id, 0.5,
                frame(0.0, pose("Root/Hip", 0.0, 0.0)),
                frame(0.5, pose("Root/Hip", 0.1, 30.0)));
    }

    private static NormalizedAnimation longClip(String id) {
        return anim(id, 2.0,
                frame(0.0, pose("Root/Hip", 0.0, 0.0)),
                frame(2.0, pose("Root/Hip", 0.1, 30.0)));
    }

    private static NormalizedAnimation realistic(String id, double offsetDegrees) {
        String[] joints = {
                "Root/Hip", "Root/Hip/Torso", "Root/Hip/Torso/Head",
                "Root/Hip/Torso/LeftArm", "Root/Hip/Torso/RightArm",
                "Root/Hip/LeftLeg", "Root/Hip/RightLeg", "Root/Hip/Torso/Tail",
        };
        int keyCount = 12;
        NormalizedKeyframe[] frames = new NormalizedKeyframe[keyCount];
        for (int k = 0; k < keyCount; k++) {
            double time = (double) k / (keyCount - 1);
            NormalizedPose[] poses = new NormalizedPose[joints.length];
            for (int j = 0; j < joints.length; j++) {
                double yaw = Math.sin(2.0 * Math.PI * time + j) * 40.0 + offsetDegrees;
                double pitch = Math.cos(2.0 * Math.PI * time + 0.5 * j) * 25.0;
                double x = 0.1 * Math.sin(2.0 * Math.PI * time + 0.25 * j);
                double[] rotation = multiply(yawMatrix(yaw), pitchMatrix(pitch));
                poses[j] = new NormalizedPose(joints[j], cframe(x, 0.02 * j, -0.05 * j, rotation), 1.0, "Linear", "InOut");
            }
            frames[k] = new NormalizedKeyframe(time, List.of(poses));
        }
        return anim(id, 1.0, frames);
    }

    private static double[] multiply(double[] a, double[] b) {
        double[] out = new double[9];
        for (int row = 0; row < 3; row++) {
            for (int col = 0; col < 3; col++) {
                out[row * 3 + col] = a[row * 3] * b[col]
                        + a[row * 3 + 1] * b[3 + col]
                        + a[row * 3 + 2] * b[6 + col];
            }
        }
        return out;
    }
}
