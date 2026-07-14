package creatorflow.motion;

/** Pure snapshot-lifecycle logic shared by the desktop persistence layer. */
public final class MotionSnapshots {

    private MotionSnapshots() {
    }

    /**
     * Classifies a new snapshot's fingerprint against the asset's previous snapshot of the
     * same kind. Because {@link MotionComparisonEngine#fingerprint} is a deterministic,
     * order-independent digest of the curve data, fingerprint equality is exactly "the
     * animation has not changed".
     *
     * @param previousFingerprint the current snapshot's fingerprint, or {@code null}/blank if none
     * @param nextFingerprint     the incoming snapshot's fingerprint (required)
     */
    public static MotionSnapshotStatus classify(String previousFingerprint, String nextFingerprint) {
        String next = MotionValidation.requireText(nextFingerprint, "next fingerprint");
        if (previousFingerprint == null || previousFingerprint.isBlank()) {
            return MotionSnapshotStatus.FIRST_SNAPSHOT;
        }
        return previousFingerprint.equals(next) ? MotionSnapshotStatus.UNCHANGED : MotionSnapshotStatus.CHANGED;
    }
}
