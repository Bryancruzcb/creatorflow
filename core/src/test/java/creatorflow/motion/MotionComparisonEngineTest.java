package creatorflow.motion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

class MotionComparisonEngineTest {

    @Test
    void exactCurvesAcrossDifferentAssetIdsHaveTheSameFingerprint() {
        NormalizedAnimation source = animation("100", "Original", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(0.5, pose("Root/Hip", 0.25, 35.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 70.0)));
        NormalizedAnimation candidate = animation("200", "Re-upload", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(0.5, pose("Root/Hip", 0.25, 35.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 70.0)));

        MotionComparisonResult result = MotionComparisonEngine.compare(
                new MotionComparisonRequest(source, candidate));

        assertTrue(result.exactCurveData());
        assertEquals(MotionVerdict.EXACT_CURVE_DATA, result.verdict());
        assertEquals(result.sourceFingerprint(), result.candidateFingerprint());
        assertEquals(100.0, result.overallPercent());
        assertEquals(100.0, result.posePercent());
        assertEquals(49, result.frameScores().size());
    }

    @Test
    void uniformRetimeKeepsPoseMatchButReducesTimingScore() {
        NormalizedAnimation source = animation("100", "Source", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(0.5, pose("Root/Hip", 0.2, 40.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 80.0)));
        NormalizedAnimation candidate = animation("200", "Retimed", 1.25,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(0.625, pose("Root/Hip", 0.2, 40.0)),
                keyframe(1.25, pose("Root/Hip", 0.0, 80.0)));

        MotionComparisonResult result = MotionComparisonEngine.compare(
                new MotionComparisonRequest(source, candidate));

        assertFalse(result.exactCurveData());
        assertEquals(100.0, result.posePercent(), 0.01);
        assertTrue(result.timingPercent() < 100.0);
        assertTrue(result.timingPercent() > 85.0);
        assertTrue(result.overallPercent() > 95.0);
        assertEquals(MotionVerdict.HIGH_SIMILARITY, result.verdict());
    }

    @Test
    void editedJointPoseLowersPoseAndOverallScores() {
        NormalizedAnimation source = animation("100", "Source", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(0.5, pose("Root/Hip", 0.0, 20.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 0.0)));
        NormalizedAnimation edited = animation("200", "Edited", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(0.5, pose("Root/Hip", 0.8, 75.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 0.0)));

        MotionComparisonResult result = MotionComparisonEngine.compare(
                new MotionComparisonRequest(source, edited));

        assertFalse(result.exactCurveData());
        assertTrue(result.posePercent() < 90.0, "pose score was " + result.posePercent());
        assertTrue(result.overallPercent() < 95.0);
        assertTrue(result.jointScores().getFirst().maxPositionDelta() >= 0.79);
        assertTrue(result.jointScores().getFirst().maxRotationDeltaDegrees() >= 54.0);
    }

    @Test
    void animationsWithNoCommonJointPathsHaveZeroCoverage() {
        NormalizedAnimation source = animation("100", "Source", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 10.0)));
        NormalizedAnimation other = animation("200", "Other rig", 1.0,
                keyframe(0.0, pose("Rig/Wing", 0.0, 0.0)),
                keyframe(1.0, pose("Rig/Wing", 0.0, 10.0)));

        MotionComparisonResult result = MotionComparisonEngine.compare(
                new MotionComparisonRequest(source, other));

        assertEquals(0.0, result.coveragePercent());
        assertEquals(0.0, result.posePercent());
        assertTrue(result.overallPercent() <= 20.0);
        assertEquals(MotionVerdict.LOW_SIMILARITY, result.verdict());
    }

    @Test
    void fingerprintsIgnoreFrameAndPoseArrayOrder() {
        NormalizedPose hip0 = pose("Root/Hip", 0.0, 0.0);
        NormalizedPose arm0 = pose("Root/Hip/Arm", 0.0, 0.0);
        NormalizedPose hip1 = pose("Root/Hip", 0.1, 20.0);
        NormalizedPose arm1 = pose("Root/Hip/Arm", 0.0, -35.0);
        NormalizedAnimation ordered = animation("100", "Ordered", 1.0,
                new NormalizedKeyframe(0.0, List.of(hip0, arm0)),
                new NormalizedKeyframe(1.0, List.of(hip1, arm1)));
        NormalizedAnimation reversed = animation("200", "Reversed", 1.0,
                new NormalizedKeyframe(1.0, List.of(arm1, hip1)),
                new NormalizedKeyframe(0.0, List.of(arm0, hip0)));

        assertEquals(
                MotionComparisonEngine.fingerprint(ordered),
                MotionComparisonEngine.fingerprint(reversed));
        assertTrue(MotionComparisonEngine.compare(
                new MotionComparisonRequest(ordered, reversed)).exactCurveData());
    }

    @Test
    void recordsRoundTripThroughJacksonWithoutMutableLists() throws Exception {
        NormalizedAnimation original = animation("100", "Walk", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)),
                keyframe(1.0, pose("Root/Hip", 0.0, 25.0)));
        ObjectMapper mapper = new ObjectMapper();

        NormalizedAnimation decoded = mapper.readValue(
                mapper.writeValueAsBytes(original), NormalizedAnimation.class);

        assertEquals(original, decoded);
        assertThrows(UnsupportedOperationException.class,
                () -> decoded.keyframes().add(keyframe(0.25, pose("Root", 0.0, 0.0))));
    }

    @Test
    void malformedAndNonFiniteInputsAreRejected() {
        List<Double> tooShort = new ArrayList<>(identityTransform(0.0, 0.0));
        tooShort.removeLast();
        assertThrows(MotionValidationException.class,
                () -> new NormalizedPose("Root/Hip", tooShort, 1.0, "Linear", "InOut"));

        List<Double> nonFinite = new ArrayList<>(identityTransform(0.0, 0.0));
        nonFinite.set(0, Double.NaN);
        assertThrows(MotionValidationException.class,
                () -> new NormalizedPose("Root/Hip", nonFinite, 1.0, "Linear", "InOut"));

        List<Double> invalidRotation = new ArrayList<>(Collections.nCopies(12, 0.0));
        assertThrows(MotionValidationException.class,
                () -> new NormalizedPose("Root/Hip", invalidRotation, 1.0, "Linear", "InOut"));

        NormalizedPose pose = pose("Root/Hip", 0.0, 0.0);
        assertThrows(MotionValidationException.class,
                () -> new NormalizedKeyframe(0.0, List.of(pose, pose)));
        assertThrows(MotionValidationException.class,
                () -> new NormalizedAnimation("100", "Bad", 0.5, false, "Idle",
                        List.of(keyframe(1.0, pose))));
        assertThrows(MotionValidationException.class,
                () -> MotionComparisonEngine.compare(null));
    }

    @Test
    void fingerprintChangesWhenCurveDataChanges() {
        NormalizedAnimation source = animation("100", "A", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.0, 0.0)));
        NormalizedAnimation edited = animation("100", "A", 1.0,
                keyframe(0.0, pose("Root/Hip", 0.01, 0.0)));

        assertNotEquals(
                MotionComparisonEngine.fingerprint(source),
                MotionComparisonEngine.fingerprint(edited));
    }

    private static NormalizedAnimation animation(
            String id, String name, double duration, NormalizedKeyframe... frames) {
        return new NormalizedAnimation(id, name, duration, true, "Movement", List.of(frames));
    }

    private static NormalizedKeyframe keyframe(double time, NormalizedPose... poses) {
        return new NormalizedKeyframe(time, List.of(poses));
    }

    private static NormalizedPose pose(String path, double x, double yawDegrees) {
        return new NormalizedPose(
                path, identityTransform(x, yawDegrees), 1.0, "Linear", "InOut");
    }

    private static List<Double> identityTransform(double x, double yawDegrees) {
        double angle = Math.toRadians(yawDegrees);
        double cosine = Math.cos(angle);
        double sine = Math.sin(angle);
        return List.of(
                x, 0.0, 0.0,
                cosine, 0.0, sine,
                0.0, 1.0, 0.0,
                -sine, 0.0, cosine);
    }
}
