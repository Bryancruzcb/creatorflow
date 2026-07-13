package creatorflow.motion;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** A normalized Roblox keyframe with every Pose flattened into a joint path. */
public record NormalizedKeyframe(double time, List<NormalizedPose> poses) {

    public NormalizedKeyframe {
        MotionValidation.requireFinite(time, "keyframe time");
        if (time < 0.0) {
            throw new MotionValidationException("keyframe time must not be negative");
        }
        if (poses == null || poses.isEmpty()) {
            throw new MotionValidationException("keyframe poses must not be empty");
        }
        poses = List.copyOf(poses);
        Set<String> paths = new HashSet<>();
        for (NormalizedPose pose : poses) {
            if (pose == null) {
                throw new MotionValidationException("keyframe poses must not contain null");
            }
            if (!paths.add(pose.jointPath())) {
                throw new MotionValidationException(
                        "keyframe contains duplicate jointPath: " + pose.jointPath());
            }
        }
    }
}
