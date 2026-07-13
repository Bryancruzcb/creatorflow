package creatorflow.motion;

import java.util.List;

final class MotionValidation {

    private static final double ROTATION_TOLERANCE = 0.02;

    private MotionValidation() {
    }

    static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new MotionValidationException(field + " must not be blank");
        }
        return value.trim();
    }

    static String textOrDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    static double requireFinite(double value, String field) {
        if (!Double.isFinite(value)) {
            throw new MotionValidationException(field + " must be finite");
        }
        return value;
    }

    static List<Double> validateCFrame(List<Double> values) {
        if (values == null || values.size() != 12) {
            throw new MotionValidationException(
                    "transform must contain exactly 12 Roblox CFrame components");
        }
        List<Double> copy = List.copyOf(values);
        for (int i = 0; i < copy.size(); i++) {
            Double value = copy.get(i);
            if (value == null || !Double.isFinite(value)) {
                throw new MotionValidationException("transform[" + i + "] must be finite");
            }
        }

        // GetComponents() returns position followed by a right-handed 3x3 rotation matrix.
        double[] r0 = {copy.get(3), copy.get(4), copy.get(5)};
        double[] r1 = {copy.get(6), copy.get(7), copy.get(8)};
        double[] r2 = {copy.get(9), copy.get(10), copy.get(11)};
        if (Math.abs(norm(r0) - 1.0) > ROTATION_TOLERANCE
                || Math.abs(norm(r1) - 1.0) > ROTATION_TOLERANCE
                || Math.abs(norm(r2) - 1.0) > ROTATION_TOLERANCE
                || Math.abs(dot(r0, r1)) > ROTATION_TOLERANCE
                || Math.abs(dot(r0, r2)) > ROTATION_TOLERANCE
                || Math.abs(dot(r1, r2)) > ROTATION_TOLERANCE) {
            throw new MotionValidationException("transform rotation matrix must be orthonormal");
        }
        double determinant = r0[0] * (r1[1] * r2[2] - r1[2] * r2[1])
                - r0[1] * (r1[0] * r2[2] - r1[2] * r2[0])
                + r0[2] * (r1[0] * r2[1] - r1[1] * r2[0]);
        if (Math.abs(determinant - 1.0) > ROTATION_TOLERANCE * 2.0) {
            throw new MotionValidationException("transform rotation matrix must be right-handed");
        }
        return copy;
    }

    static void requirePercent(double value, String field) {
        requireFinite(value, field);
        if (value < 0.0 || value > 100.0) {
            throw new MotionValidationException(field + " must be between 0 and 100");
        }
    }

    private static double dot(double[] left, double[] right) {
        return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
    }

    private static double norm(double[] values) {
        return Math.sqrt(dot(values, values));
    }
}
