package creatorflow.motion;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Plugin-neutral representation of a Roblox KeyframeSequence.
 */
public record NormalizedAnimation(
        String assetId,
        String name,
        double duration,
        boolean looped,
        String priority,
        List<NormalizedKeyframe> keyframes) {

    private static final double TIME_TOLERANCE = 0.000_001;

    public NormalizedAnimation {
        assetId = MotionValidation.requireText(assetId, "assetId");
        name = MotionValidation.textOrDefault(name, assetId);
        MotionValidation.requireFinite(duration, "duration");
        if (duration < 0.0) {
            throw new MotionValidationException("duration must not be negative");
        }
        priority = MotionValidation.textOrDefault(priority, "Unknown");
        if (keyframes == null || keyframes.isEmpty()) {
            throw new MotionValidationException("keyframes must not be empty");
        }
        keyframes = List.copyOf(keyframes);
        Set<Double> times = new HashSet<>();
        for (NormalizedKeyframe keyframe : keyframes) {
            if (keyframe == null) {
                throw new MotionValidationException("keyframes must not contain null");
            }
            if (keyframe.time() > duration + TIME_TOLERANCE) {
                throw new MotionValidationException(
                        "keyframe time " + keyframe.time() + " exceeds duration " + duration);
            }
            double canonicalTime = keyframe.time() == 0.0 ? 0.0 : keyframe.time();
            if (!times.add(canonicalTime)) {
                throw new MotionValidationException(
                        "animation contains duplicate keyframe time: " + keyframe.time());
            }
        }
    }
}
