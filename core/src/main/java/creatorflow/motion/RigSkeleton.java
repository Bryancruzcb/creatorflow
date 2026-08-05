package creatorflow.motion;

import java.util.Set;

/**
 * The joint names a rig actually has, spelled the way an animation channel names them.
 *
 * <p><strong>These are part names, not Motor6D names.</strong> A {@code KeyframeSequence}'s
 * {@code Pose} objects are named after the rig's <em>parts</em> — Roblox's animator binds a Pose to
 * the {@code Motor6D} whose {@code Part1} carries that name. On R6 the joint called
 * {@code Left Shoulder} drives the part called {@code Left Arm}, and it is {@code Left Arm} that a
 * Pose is named. Comparing against Motor6D names instead would report every channel of a perfectly
 * compatible clip as unbound.
 *
 * <p>{@code HumanoidRootPart} is included even though no Motor6D drives it: it is the root a Pose
 * tree is anchored on, it exists on both stock rigs, and a clip naming it is not naming something
 * the rig lacks. Leaving it out would report one false miss on every otherwise-perfect clip.
 *
 * <p>Names are compared exactly. Roblox part names are case-sensitive, so a channel named
 * {@code left arm} genuinely does not bind on a rig whose part is {@code Left Arm} — the engine
 * silently drops it, and so does this.
 */
public record RigSkeleton(String name, Set<String> jointNames) {

    /** Roblox's stock R6 dummy, as the Studio Rig Builder inserts it. */
    private static final RigSkeleton R6 = new RigSkeleton("R6", Set.of(
            "HumanoidRootPart", "Torso", "Head",
            "Left Arm", "Right Arm", "Left Leg", "Right Leg"));

    /** Roblox's stock R15 dummy, as the Studio Rig Builder inserts it. */
    private static final RigSkeleton R15 = new RigSkeleton("R15", Set.of(
            "HumanoidRootPart", "LowerTorso", "UpperTorso", "Head",
            "LeftUpperArm", "LeftLowerArm", "LeftHand",
            "RightUpperArm", "RightLowerArm", "RightHand",
            "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
            "RightUpperLeg", "RightLowerLeg", "RightFoot"));

    public RigSkeleton {
        name = MotionValidation.requireText(name, "rig name");
        if (jointNames == null || jointNames.isEmpty()) {
            throw new MotionValidationException("rig jointNames must not be empty");
        }
        jointNames = Set.copyOf(jointNames);
    }

    public static RigSkeleton stockR6() {
        return R6;
    }

    public static RigSkeleton stockR15() {
        return R15;
    }

    public boolean hasJoint(String jointName) {
        return jointName != null && jointNames.contains(jointName);
    }
}
