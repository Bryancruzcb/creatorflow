package creatorflow.motion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Phase C's premise, on the engine the plugin route actually scores with.
 *
 * <p>A CurveAnimation re-upload of an authored KeyframeSequence reaches this engine as a DENSE
 * uniform resampling of the same motion: the desktop bridge plugin samples curve channels at
 * {@code CURVE_SAMPLES_PER_SECOND = 20} into the same pose format an authored clip arrives in. If
 * the engine scored that dense reconstruction as a different animation, every sampled comparison
 * Phase C ships would be a false negative and the feature would be worthless — so the scenario is
 * asserted here rather than assumed, and it needs no Studio to run.
 *
 * <p>The candidate grid mirrors {@code sampleTimesFor} in CreatorFlowAnimationBridge.lua exactly:
 * accumulated 1/20 s steps while {@code t < duration}, then the exact end time appended — or
 * REPLACING the last stepped sample when float accumulation lands it within the plugin's
 * six-decimal rounding resolution of the end. Both sides are rounded the way the plugin rounds
 * every number it sends, so the comparison sees the values the wire would carry.
 *
 * <p>Measured on this fixture when the test was written: overall 99.54, pose 99.30, timing 100.0,
 * coverage 100.0, duration 100.0, warp 100.0, exact false, verdict HIGH_SIMILARITY. The assertions
 * below are bands, not those numbers — this test guards the premise, not the engine's arithmetic,
 * which the parity oracle already pins.
 */
class CurveSampledComparisonTest {

    /** CURVE_SAMPLES_PER_SECOND in CreatorFlowAnimationBridge.lua. */
    private static final double SAMPLES_PER_SECOND = 20.0;

    /** ROUNDING_SCALE in CreatorFlowAnimationBridge.lua. */
    private static final double ROUNDING_SCALE = 1_000_000.0;

    private static final double DURATION = 2.0;

    /** One joint's motion: both channels linear in time, which is what a Linear-eased clip plays. */
    private record LinearJoint(String path, double endX, double endYawDegrees) {

        NormalizedPose at(double time) {
            double fraction = time / DURATION;
            return pose(path, endX * fraction, endYawDegrees * fraction);
        }
    }

    private static final List<LinearJoint> JOINTS = List.of(
            new LinearJoint("Root/HumanoidRootPart", 1.5, 0.0),
            new LinearJoint("Root/HumanoidRootPart/Torso", 0.0, 60.0),
            new LinearJoint("Root/HumanoidRootPart/Torso/LeftUpperArm", -0.4, -30.0));

    @Test
    void denseCurveResamplingOfAnAuthoredClipStaysInTheHighSimilarityBand() {
        // Five authored keyframes over 2 s — the sparse side a creator actually built.
        NormalizedAnimation authored = clipAt("100", "Authored", List.of(0.0, 0.5, 1.0, 1.5, 2.0));
        // The same motion as the plugin would hand it over: 20 samples per second, plus the end.
        NormalizedAnimation sampled = clipAt("200", "Curve re-upload", sampleTimesFor(DURATION));

        MotionComparisonV2Result result = MotionComparisonEngineV2.compare(
                new MotionComparisonRequest(authored, sampled));

        assertEquals(41, sampled.keyframes().size(), "sample grid size");
        assertFalse(result.mirrored(), "a dense resample must match as submitted, not mirrored");
        assertEquals(100.0, result.coveragePercent(), 0.001);
        assertTrue(result.posePercent() >= 90.0, "pose score was " + result.posePercent());
        assertTrue(result.timingPercent() >= 90.0, "timing score was " + result.timingPercent());
        assertTrue(result.overallPercent() >= 90.0, "overall score was " + result.overallPercent());
        // HIGH_SIMILARITY is the band this app treats as a likely copy; EXACT_CURVE_DATA is stronger
        // still and would be an acceptable, if surprising, outcome for byte-identical rounding.
        assertTrue(
                result.verdict() == MotionVerdict.HIGH_SIMILARITY
                        || result.verdict() == MotionVerdict.EXACT_CURVE_DATA,
                "verdict was " + result.verdict() + " at overall " + result.overallPercent());
    }

    private static NormalizedAnimation clipAt(String assetId, String name, List<Double> times) {
        List<NormalizedKeyframe> keyframes = new ArrayList<>(times.size());
        for (double time : times) {
            List<NormalizedPose> poses = new ArrayList<>(JOINTS.size());
            for (LinearJoint joint : JOINTS) {
                poses.add(joint.at(time));
            }
            keyframes.add(new NormalizedKeyframe(round(time), poses));
        }
        return new NormalizedAnimation(assetId, name, DURATION, false, "Movement", keyframes);
    }

    /** Line-for-line mirror of sampleTimesFor in CreatorFlowAnimationBridge.lua. */
    private static List<Double> sampleTimesFor(double duration) {
        if (duration <= 0.0) {
            return List.of(0.0);
        }
        List<Double> times = new ArrayList<>();
        double step = 1.0 / SAMPLES_PER_SECOND;
        double t = 0.0;
        while (t < duration) {
            times.add(t);
            t += step;
        }
        if (duration - times.getLast() < 1.0 / ROUNDING_SCALE) {
            times.set(times.size() - 1, duration);
        } else {
            times.add(duration);
        }
        return times;
    }

    /** roundNumber in CreatorFlowAnimationBridge.lua: half away from zero at six decimals. */
    private static double round(double value) {
        if (value >= 0.0) {
            return Math.floor(value * ROUNDING_SCALE + 0.5) / ROUNDING_SCALE;
        }
        return Math.ceil(value * ROUNDING_SCALE - 0.5) / ROUNDING_SCALE;
    }

    private static NormalizedPose pose(String path, double x, double yawDegrees) {
        double angle = Math.toRadians(yawDegrees);
        double cosine = Math.cos(angle);
        double sine = Math.sin(angle);
        List<Double> transform = List.of(
                round(x), 0.0, 0.0,
                round(cosine), 0.0, round(sine),
                0.0, 1.0, 0.0,
                round(-sine), 0.0, round(cosine));
        return new NormalizedPose(path, transform, 1.0, "Linear", "InOut");
    }
}
