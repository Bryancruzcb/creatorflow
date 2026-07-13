package creatorflow.motion;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Compares two normalized Roblox KeyframeSequences without requiring Studio at runtime.
 * Positions use linear interpolation; rotations use shortest-arc quaternion slerp.
 */
public final class MotionComparisonEngine {

    public static final String ALGORITHM_VERSION = "creatorflow.motion-comparison/v1";

    private static final int SAMPLE_COUNT = 49;
    private static final double POSITION_DECAY = 2.25;
    private static final double ROTATION_DECAY = 1.8;

    private MotionComparisonEngine() {
    }

    public static MotionComparisonResult compare(MotionComparisonRequest request) {
        if (request == null) {
            throw new MotionValidationException("comparison request is required");
        }
        NormalizedAnimation source = request.source();
        NormalizedAnimation candidate = request.candidate();

        String sourceFingerprint = fingerprint(source);
        String candidateFingerprint = fingerprint(candidate);
        boolean exact = sourceFingerprint.equals(candidateFingerprint);

        Map<String, List<TrackKey>> sourceTracks = tracks(source);
        Map<String, List<TrackKey>> candidateTracks = tracks(candidate);
        Set<String> allJoints = new TreeSet<>(sourceTracks.keySet());
        allJoints.addAll(candidateTracks.keySet());
        Set<String> commonJoints = new TreeSet<>(sourceTracks.keySet());
        commonJoints.retainAll(candidateTracks.keySet());

        double coveragePercent = allJoints.isEmpty()
                ? 0.0
                : 100.0 * commonJoints.size() / allJoints.size();

        Map<String, JointAccumulator> accumulators = new TreeMap<>();
        for (String joint : commonJoints) {
            accumulators.put(joint, new JointAccumulator());
        }

        List<MotionFrameScore> frameScores = new ArrayList<>(SAMPLE_COUNT);
        for (int sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex++) {
            double normalizedTime = sampleIndex / (double) (SAMPLE_COUNT - 1);
            double sourceTime = normalizedTime * source.duration();
            double candidateTime = normalizedTime * candidate.duration();
            double frameTotal = 0.0;
            for (String joint : commonJoints) {
                PoseSample sourcePose = sample(sourceTracks.get(joint), sourceTime);
                PoseSample candidatePose = sample(candidateTracks.get(joint), candidateTime);
                PoseDelta delta = delta(sourcePose, candidatePose);
                accumulators.get(joint).add(delta);
                frameTotal += delta.posePercent();
            }
            double framePercent = commonJoints.isEmpty()
                    ? 0.0
                    : frameTotal / commonJoints.size();
            frameScores.add(new MotionFrameScore(
                    sampleIndex,
                    round(normalizedTime, 6),
                    round(sourceTime, 6),
                    round(candidateTime, 6),
                    round(framePercent, 2),
                    commonJoints.size()));
        }

        List<MotionJointScore> jointScores = new ArrayList<>(allJoints.size());
        double poseTotal = 0.0;
        for (String joint : allJoints) {
            boolean inSource = sourceTracks.containsKey(joint);
            boolean inCandidate = candidateTracks.containsKey(joint);
            if (!inSource || !inCandidate) {
                jointScores.add(new MotionJointScore(
                        joint, inSource, inCandidate, 0.0, 0.0, 0.0, 0.0, 0.0));
                continue;
            }
            JointAccumulator accumulator = accumulators.get(joint);
            double metadataPercent = trackMetadataPercent(
                    sourceTracks.get(joint), candidateTracks.get(joint));
            double jointPercent = accumulator.meanPosePercent() * 0.96 + metadataPercent * 0.04;
            poseTotal += jointPercent;
            jointScores.add(new MotionJointScore(
                    joint,
                    true,
                    true,
                    round(jointPercent, 2),
                    round(accumulator.meanPositionDelta(), 6),
                    round(accumulator.maxPositionDelta, 6),
                    round(Math.toDegrees(accumulator.meanRotationDelta()), 3),
                    round(Math.toDegrees(accumulator.maxRotationDelta), 3)));
        }

        double posePercent = commonJoints.isEmpty() ? 0.0 : poseTotal / commonJoints.size();
        double timingPercent = timingPercent(source, candidate);
        double overallPercent = posePercent * 0.65
                + timingPercent * 0.20
                + coveragePercent * 0.15;

        if (exact) {
            posePercent = 100.0;
            timingPercent = 100.0;
            coveragePercent = 100.0;
            overallPercent = 100.0;
        }

        MotionVerdict verdict = verdict(exact, overallPercent);
        return new MotionComparisonResult(
                ALGORITHM_VERSION,
                source.assetId(),
                candidate.assetId(),
                sourceFingerprint,
                candidateFingerprint,
                round(overallPercent, 2),
                round(posePercent, 2),
                round(timingPercent, 2),
                round(coveragePercent, 2),
                exact,
                verdict,
                jointScores,
                frameScores,
                List.of(
                        "Similarity is evidence, not a determination of ownership or infringement.",
                        "Transforms are compared in local joint space; rig retargeting is not inferred.",
                        "Easing metadata is fingerprinted and lightly scored; interpolation uses linear position and quaternion slerp."));
    }

    /**
     * Produces an order-independent fingerprint of curve data, excluding asset id and display metadata.
     */
    public static String fingerprint(NormalizedAnimation animation) {
        if (animation == null) {
            throw new MotionValidationException("animation is required");
        }
        StringBuilder canonical = new StringBuilder(4096);
        canonical.append("creatorflow.motion-fingerprint/v1|");
        appendDouble(canonical, animation.duration());
        List<NormalizedKeyframe> frames = sortedFrames(animation);
        canonical.append(frames.size()).append('|');
        for (NormalizedKeyframe frame : frames) {
            appendDouble(canonical, frame.time());
            List<NormalizedPose> poses = frame.poses().stream()
                    .sorted(Comparator.comparing(NormalizedPose::jointPath))
                    .toList();
            canonical.append(poses.size()).append('|');
            for (NormalizedPose pose : poses) {
                appendString(canonical, pose.jointPath());
                for (double value : pose.transform()) {
                    appendDouble(canonical, value);
                }
                appendDouble(canonical, pose.weight());
                appendString(canonical, pose.easingStyle());
                appendString(canonical, pose.easingDirection());
            }
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static List<NormalizedKeyframe> sortedFrames(NormalizedAnimation animation) {
        return animation.keyframes().stream()
                .sorted(Comparator.comparingDouble(NormalizedKeyframe::time))
                .toList();
    }

    private static Map<String, List<TrackKey>> tracks(NormalizedAnimation animation) {
        Map<String, List<TrackKey>> tracks = new TreeMap<>();
        for (NormalizedKeyframe frame : sortedFrames(animation)) {
            for (NormalizedPose pose : frame.poses()) {
                List<Double> transform = pose.transform();
                TrackKey key = new TrackKey(
                        frame.time(),
                        new Vector3(transform.get(0), transform.get(1), transform.get(2)),
                        Quaternion.fromRotationMatrix(transform),
                        pose.weight(),
                        pose.easingStyle(),
                        pose.easingDirection());
                tracks.computeIfAbsent(pose.jointPath(), ignored -> new ArrayList<>()).add(key);
            }
        }
        return tracks;
    }

    private static PoseSample sample(List<TrackKey> track, double time) {
        if (track.size() == 1 || time <= track.getFirst().time()) {
            return track.getFirst().sample();
        }
        if (time >= track.getLast().time()) {
            return track.getLast().sample();
        }
        int high = 1;
        while (track.get(high).time() < time) {
            high++;
        }
        TrackKey left = track.get(high - 1);
        TrackKey right = track.get(high);
        double span = right.time() - left.time();
        double fraction = span == 0.0 ? 0.0 : (time - left.time()) / span;
        return new PoseSample(
                left.position().lerp(right.position(), fraction),
                left.rotation().slerp(right.rotation(), fraction),
                left.weight() + (right.weight() - left.weight()) * fraction);
    }

    private static PoseDelta delta(PoseSample source, PoseSample candidate) {
        double positionDelta = source.position().distance(candidate.position());
        double rotationDelta = source.rotation().angleTo(candidate.rotation());
        double weightDelta = Math.abs(source.weight() - candidate.weight());
        double positionPercent = 100.0 * Math.exp(-POSITION_DECAY * positionDelta);
        double rotationPercent = 100.0 * Math.exp(-ROTATION_DECAY * rotationDelta);
        double weightPercent = 100.0 * Math.max(0.0, 1.0 - weightDelta);
        double posePercent = positionPercent * 0.42
                + rotationPercent * 0.50
                + weightPercent * 0.08;
        return new PoseDelta(posePercent, positionDelta, rotationDelta);
    }

    private static double trackMetadataPercent(List<TrackKey> source, List<TrackKey> candidate) {
        int samples = Math.max(source.size(), candidate.size());
        double total = 0.0;
        for (int i = 0; i < samples; i++) {
            TrackKey left = source.get(quantileIndex(i, samples, source.size()));
            TrackKey right = candidate.get(quantileIndex(i, samples, candidate.size()));
            double style = left.easingStyle().equalsIgnoreCase(right.easingStyle()) ? 100.0 : 0.0;
            double direction = left.easingDirection().equalsIgnoreCase(right.easingDirection())
                    ? 100.0 : 0.0;
            total += (style + direction) / 2.0;
        }
        double countPercent = 100.0 * Math.min(source.size(), candidate.size())
                / Math.max(source.size(), candidate.size());
        return total / samples * 0.8 + countPercent * 0.2;
    }

    private static double timingPercent(
            NormalizedAnimation source, NormalizedAnimation candidate) {
        double durationPercent;
        if (source.duration() == 0.0 && candidate.duration() == 0.0) {
            durationPercent = 100.0;
        } else if (source.duration() == 0.0 || candidate.duration() == 0.0) {
            durationPercent = 0.0;
        } else {
            durationPercent = 100.0 * Math.min(source.duration(), candidate.duration())
                    / Math.max(source.duration(), candidate.duration());
        }

        List<Double> sourceTimes = normalizedFrameTimes(source);
        List<Double> candidateTimes = normalizedFrameTimes(candidate);
        int samples = Math.max(sourceTimes.size(), candidateTimes.size());
        double difference = 0.0;
        for (int i = 0; i < samples; i++) {
            double left = sourceTimes.get(quantileIndex(i, samples, sourceTimes.size()));
            double right = candidateTimes.get(quantileIndex(i, samples, candidateTimes.size()));
            difference += Math.abs(left - right);
        }
        double meanDifference = difference / samples;
        double patternPercent = 100.0 * Math.max(0.0, 1.0 - meanDifference * 2.5);
        double countPercent = 100.0 * Math.min(sourceTimes.size(), candidateTimes.size())
                / Math.max(sourceTimes.size(), candidateTimes.size());
        return durationPercent * 0.45 + patternPercent * 0.40 + countPercent * 0.15;
    }

    private static List<Double> normalizedFrameTimes(NormalizedAnimation animation) {
        if (animation.duration() == 0.0) {
            return sortedFrames(animation).stream().map(ignored -> 0.0).toList();
        }
        return sortedFrames(animation).stream()
                .map(frame -> frame.time() / animation.duration())
                .toList();
    }

    private static int quantileIndex(int sample, int sampleCount, int valueCount) {
        if (sampleCount <= 1 || valueCount <= 1) {
            return 0;
        }
        return (int) Math.round(sample * (valueCount - 1.0) / (sampleCount - 1.0));
    }

    private static MotionVerdict verdict(boolean exact, double overallPercent) {
        if (exact) {
            return MotionVerdict.EXACT_CURVE_DATA;
        }
        if (overallPercent >= 90.0) {
            return MotionVerdict.HIGH_SIMILARITY;
        }
        if (overallPercent >= 70.0) {
            return MotionVerdict.MODERATE_SIMILARITY;
        }
        return MotionVerdict.LOW_SIMILARITY;
    }

    private static void appendString(StringBuilder target, String value) {
        target.append(value.length()).append(':').append(value).append('|');
    }

    private static void appendDouble(StringBuilder target, double value) {
        double canonical = value == 0.0 ? 0.0 : value;
        target.append(Double.toHexString(canonical)).append('|');
    }

    private static double round(double value, int places) {
        double factor = Math.pow(10.0, places);
        return Math.round(value * factor) / factor;
    }

    private record TrackKey(
            double time,
            Vector3 position,
            Quaternion rotation,
            double weight,
            String easingStyle,
            String easingDirection) {

        PoseSample sample() {
            return new PoseSample(position, rotation, weight);
        }
    }

    private record PoseSample(Vector3 position, Quaternion rotation, double weight) {
    }

    private record PoseDelta(
            double posePercent, double positionDelta, double rotationDelta) {
    }

    private record Vector3(double x, double y, double z) {

        Vector3 lerp(Vector3 other, double fraction) {
            return new Vector3(
                    x + (other.x - x) * fraction,
                    y + (other.y - y) * fraction,
                    z + (other.z - z) * fraction);
        }

        double distance(Vector3 other) {
            double dx = x - other.x;
            double dy = y - other.y;
            double dz = z - other.z;
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
    }

    private record Quaternion(double w, double x, double y, double z) {

        static Quaternion fromRotationMatrix(List<Double> values) {
            double m00 = values.get(3);
            double m01 = values.get(4);
            double m02 = values.get(5);
            double m10 = values.get(6);
            double m11 = values.get(7);
            double m12 = values.get(8);
            double m20 = values.get(9);
            double m21 = values.get(10);
            double m22 = values.get(11);
            double w;
            double x;
            double y;
            double z;
            double trace = m00 + m11 + m22;
            if (trace > 0.0) {
                double s = Math.sqrt(trace + 1.0) * 2.0;
                w = 0.25 * s;
                x = (m21 - m12) / s;
                y = (m02 - m20) / s;
                z = (m10 - m01) / s;
            } else if (m00 > m11 && m00 > m22) {
                double s = Math.sqrt(1.0 + m00 - m11 - m22) * 2.0;
                w = (m21 - m12) / s;
                x = 0.25 * s;
                y = (m01 + m10) / s;
                z = (m02 + m20) / s;
            } else if (m11 > m22) {
                double s = Math.sqrt(1.0 + m11 - m00 - m22) * 2.0;
                w = (m02 - m20) / s;
                x = (m01 + m10) / s;
                y = 0.25 * s;
                z = (m12 + m21) / s;
            } else {
                double s = Math.sqrt(1.0 + m22 - m00 - m11) * 2.0;
                w = (m10 - m01) / s;
                x = (m02 + m20) / s;
                y = (m12 + m21) / s;
                z = 0.25 * s;
            }
            return new Quaternion(w, x, y, z).normalized();
        }

        Quaternion normalized() {
            double length = Math.sqrt(w * w + x * x + y * y + z * z);
            return new Quaternion(w / length, x / length, y / length, z / length);
        }

        Quaternion slerp(Quaternion other, double fraction) {
            double dot = dot(other);
            Quaternion end = other;
            if (dot < 0.0) {
                dot = -dot;
                end = new Quaternion(-other.w, -other.x, -other.y, -other.z);
            }
            dot = Math.max(-1.0, Math.min(1.0, dot));
            if (dot > 0.9995) {
                return new Quaternion(
                        w + (end.w - w) * fraction,
                        x + (end.x - x) * fraction,
                        y + (end.y - y) * fraction,
                        z + (end.z - z) * fraction).normalized();
            }
            double angle = Math.acos(dot);
            double sinAngle = Math.sin(angle);
            double leftWeight = Math.sin((1.0 - fraction) * angle) / sinAngle;
            double rightWeight = Math.sin(fraction * angle) / sinAngle;
            return new Quaternion(
                    w * leftWeight + end.w * rightWeight,
                    x * leftWeight + end.x * rightWeight,
                    y * leftWeight + end.y * rightWeight,
                    z * leftWeight + end.z * rightWeight).normalized();
        }

        double angleTo(Quaternion other) {
            double dot = Math.abs(dot(other));
            return 2.0 * Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
        }

        private double dot(Quaternion other) {
            return w * other.w + x * other.x + y * other.y + z * other.z;
        }
    }

    private static final class JointAccumulator {
        private double poseTotal;
        private double positionTotal;
        private double rotationTotal;
        private double maxPositionDelta;
        private double maxRotationDelta;
        private int count;

        void add(PoseDelta delta) {
            poseTotal += delta.posePercent();
            positionTotal += delta.positionDelta();
            rotationTotal += delta.rotationDelta();
            maxPositionDelta = Math.max(maxPositionDelta, delta.positionDelta());
            maxRotationDelta = Math.max(maxRotationDelta, delta.rotationDelta());
            count++;
        }

        double meanPosePercent() {
            return count == 0 ? 0.0 : poseTotal / count;
        }

        double meanPositionDelta() {
            return count == 0 ? 0.0 : positionTotal / count;
        }

        double meanRotationDelta() {
            return count == 0 ? 0.0 : rotationTotal / count;
        }
    }
}
