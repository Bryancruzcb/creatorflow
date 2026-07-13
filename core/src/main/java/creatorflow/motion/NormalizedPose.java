package creatorflow.motion;

import java.util.List;

/**
 * One Roblox joint pose flattened to a stable hierarchy path.
 *
 * @param jointPath       slash-separated Pose hierarchy path, for example Root/HumanoidRootPart/Torso
 * @param transform       the 12 values returned by {@code CFrame:GetComponents()}
 * @param weight          Roblox Pose weight in the inclusive range 0..1
 * @param easingStyle     Roblox easing style name
 * @param easingDirection Roblox easing direction name
 */
public record NormalizedPose(
        String jointPath,
        List<Double> transform,
        double weight,
        String easingStyle,
        String easingDirection) {

    public NormalizedPose {
        jointPath = MotionValidation.requireText(jointPath, "jointPath");
        transform = MotionValidation.validateCFrame(transform);
        MotionValidation.requireFinite(weight, "weight");
        if (weight < 0.0 || weight > 1.0) {
            throw new MotionValidationException("weight must be between 0 and 1");
        }
        easingStyle = MotionValidation.textOrDefault(easingStyle, "Linear");
        easingDirection = MotionValidation.textOrDefault(easingDirection, "InOut");
    }
}
