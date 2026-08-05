package creatorflow.motion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RigCompatibilityTest {

    /** Every channel an R15-authored clip carries, as Pose names. */
    private static final List<String> R15_CLIP = List.of(
            "HumanoidRootPart", "LowerTorso", "UpperTorso", "Head",
            "LeftUpperArm", "LeftLowerArm", "LeftHand",
            "RightUpperArm", "RightLowerArm", "RightHand",
            "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
            "RightUpperLeg", "RightLowerLeg", "RightFoot");

    /** Every channel an R6-authored clip carries, as Pose names. */
    private static final List<String> R6_CLIP = List.of(
            "HumanoidRootPart", "Torso", "Head",
            "Left Arm", "Right Arm", "Left Leg", "Right Leg");

    @Test
    void theStockSkeletonsShareOnlyTwoJointNames() {
        RigSkeleton r6 = RigSkeleton.stockR6();
        RigSkeleton r15 = RigSkeleton.stockR15();
        assertEquals(7, r6.jointNames().size());
        assertEquals(16, r15.jointNames().size());

        Set<String> shared = new LinkedHashSet<>(r6.jointNames());
        shared.retainAll(r15.jointNames());
        // This is the whole reason a rig-type mismatch is detectable at all: R6 and R15 name almost
        // nothing the same way, so a clip authored for one binds nearly none of its channels on the
        // other. If Roblox ever renames stock parts, this assertion is where it surfaces.
        assertEquals(Set.of("HumanoidRootPart", "Head"), shared);
    }

    @Test
    void aClipAuthoredForTheRigBindsEveryChannel() {
        RigBindingReport report = RigCompatibility.check(R15_CLIP, RigSkeleton.stockR15());
        assertEquals("R15", report.rig());
        assertEquals(16, report.channels());
        assertEquals(16, report.boundChannels());
        assertEquals(100, report.boundPercent());
        assertFalse(report.belowThreshold());
        assertEquals(List.of(), report.unboundJoints());

        RigBindingReport r6 = RigCompatibility.check(R6_CLIP, RigSkeleton.stockR6());
        assertEquals(7, r6.boundChannels());
        assertEquals(100, r6.boundPercent());
        assertFalse(r6.belowThreshold());
    }

    @Test
    void anR15ClipOnAnR6RigWarnsInsteadOfLookingPlayable() {
        // The exact case the Phase B spike found reports ok:true from the live probe: Roblox loads
        // and plays the clip, silently animating nothing but the two channels it can bind.
        RigBindingReport report = RigCompatibility.check(R15_CLIP, RigSkeleton.stockR6());
        assertEquals("R6", report.rig());
        assertEquals(16, report.channels());
        assertEquals(2, report.boundChannels());
        assertEquals(12, report.boundPercent());
        assertTrue(report.belowThreshold());
        assertTrue(report.unboundJoints().contains("LeftUpperArm"));
        assertFalse(report.unboundJoints().contains("Head"));
    }

    @Test
    void anR6ClipOnAnR15RigWarnsToo() {
        RigBindingReport report = RigCompatibility.check(R6_CLIP, RigSkeleton.stockR15());
        assertEquals(7, report.channels());
        assertEquals(2, report.boundChannels());
        assertEquals(28, report.boundPercent());
        assertTrue(report.belowThreshold());
        assertTrue(report.unboundJoints().contains("Left Arm"));
    }

    @Test
    void aClipCarryingAFewPropChannelsDoesNotCryWolf() {
        // A real authoring shape: a full R15 clip plus a couple of channels for a held prop or an
        // accessory the stock dummy has no part for. Most of the motion still plays exactly as
        // authored, so this must stay quiet -- a warning here would fire on ordinary work and teach
        // whoever reads it to ignore the row.
        List<String> withProps = new ArrayList<>(R15_CLIP);
        withProps.add("Handle");
        withProps.add("SwordTip");
        RigBindingReport report = RigCompatibility.check(withProps, RigSkeleton.stockR15());
        assertEquals(18, report.channels());
        assertEquals(16, report.boundChannels());
        assertEquals(88, report.boundPercent());
        assertFalse(report.belowThreshold());
        assertEquals(List.of("Handle", "SwordTip"), report.unboundJoints());
    }

    @Test
    void theThresholdWarnsOnlyBelowThreeQuartersBound() {
        RigSkeleton rig = new RigSkeleton("FIXTURE", Set.of("a", "b", "c"));
        // 3 of 4 is exactly the threshold and must not warn; 2 of 3 is below it and must.
        assertFalse(RigCompatibility.check(List.of("a", "b", "c", "x"), rig).belowThreshold());
        assertEquals(75, RigCompatibility.check(List.of("a", "b", "c", "x"), rig).boundPercent());
        assertTrue(RigCompatibility.check(List.of("a", "b", "x"), rig).belowThreshold());
        assertEquals(66, RigCompatibility.check(List.of("a", "b", "x"), rig).boundPercent());
        assertEquals(75, RigCompatibility.MIN_BOUND_PERCENT);
    }

    @Test
    void theReportedPercentNeverContradictsTheWarning() {
        // 149 of 200 is 74.5% -- rounded for display it reads 75% while still being under the
        // threshold, which would print a passing number beside a warning. The percent floors for
        // exactly that reason, so "75%" is never shown next to a warning.
        Set<String> rigJoints = new LinkedHashSet<>();
        List<String> clipJoints = new ArrayList<>();
        for (int index = 0; index < 200; index++) {
            String joint = "joint" + index;
            clipJoints.add(joint);
            if (index < 149) {
                rigJoints.add(joint);
            }
        }
        RigBindingReport report = RigCompatibility.check(clipJoints, new RigSkeleton("FIXTURE", rigJoints));
        assertEquals(74, report.boundPercent());
        assertTrue(report.belowThreshold());
    }

    @Test
    void aChannelBindsOnTheLastSegmentOfItsJointPath() {
        // Poses arrive as the hierarchy path appendPose builds in the Studio plugin; only the leaf
        // segment names the joint the animator binds against.
        RigBindingReport report = RigCompatibility.check(
                List.of("HumanoidRootPart/Torso/Left Arm", "HumanoidRootPart/Torso/Head"),
                RigSkeleton.stockR6());
        assertEquals(2, report.channels());
        assertEquals(2, report.boundChannels());
        assertEquals(List.of(), report.unboundJoints());
    }

    @Test
    void jointNamesAreComparedExactlyAsRobloxComparesThem() {
        // Roblox part names are case-sensitive, so "left arm" is not the R6 rig's "Left Arm" and
        // the engine would silently drop it. Reporting it as bound would be a false all-clear.
        RigBindingReport report = RigCompatibility.check(List.of("left arm", "Head"), RigSkeleton.stockR6());
        assertEquals(1, report.boundChannels());
        assertEquals(List.of("left arm"), report.unboundJoints());
    }

    @Test
    void aClipWithNoChannelsIsNotAWarning() {
        // Nothing was observed, so there is nothing to warn about -- the same discipline
        // PlaybackSettings.unknown() applies: never report a finding the tool never made.
        RigBindingReport report = RigCompatibility.check(List.of(), RigSkeleton.stockR15());
        assertEquals(0, report.channels());
        assertEquals(0, report.boundChannels());
        assertEquals(0, report.boundPercent());
        assertFalse(report.belowThreshold());
    }

    @Test
    void everyKeyframeContributesItsChannelsToTheSet() {
        // A joint keyed only partway through the clip is still a channel the rig has to have.
        NormalizedAnimation animation = new NormalizedAnimation("1001", "Walk", 1.0, true, "Movement", List.of(
                new NormalizedKeyframe(0.0, List.of(pose("HumanoidRootPart/Torso"))),
                new NormalizedKeyframe(1.0, List.of(pose("HumanoidRootPart/Torso"),
                        pose("HumanoidRootPart/Torso/LeftUpperArm")))));
        RigBindingReport report = RigCompatibility.check(animation, RigSkeleton.stockR6());
        assertEquals(2, report.channels());
        assertEquals(1, report.boundChannels());
        assertEquals(List.of("LeftUpperArm"), report.unboundJoints());
    }

    @Test
    void theUnboundListIsBoundedButTheCountsAreNot() {
        // The list is evidence for a person reading the row, not the measurement -- a custom rig can
        // carry hundreds of channels and none of them belong in a stored JSON blob.
        List<String> many = new ArrayList<>();
        for (int index = 0; index < 40; index++) {
            many.add("custom" + index);
        }
        RigBindingReport report = RigCompatibility.check(many, RigSkeleton.stockR15());
        assertEquals(40, report.channels());
        assertEquals(0, report.boundChannels());
        assertEquals(RigCompatibility.MAX_LISTED_UNBOUND_JOINTS, report.unboundJoints().size());
    }

    @Test
    void aSkeletonNeedsANameAndAtLeastOneJoint() {
        assertThrows(MotionValidationException.class, () -> new RigSkeleton(" ", Set.of("Head")));
        assertThrows(MotionValidationException.class, () -> new RigSkeleton("EMPTY", Set.of()));
        assertThrows(MotionValidationException.class, () -> new RigSkeleton("NULL", null));
    }

    private static NormalizedPose pose(String jointPath) {
        return new NormalizedPose(jointPath,
                List.of(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
                1.0, "Linear", "InOut");
    }
}
