package creatorflow.motion;

/** How a freshly captured snapshot relates to the asset's previous snapshot of the same kind. */
public enum MotionSnapshotStatus {
    /** No earlier snapshot of this kind existed for the asset. */
    FIRST_SNAPSHOT,
    /** The curve fingerprint matches the previous snapshot — the animation has not changed. */
    UNCHANGED,
    /** The curve fingerprint differs from the previous snapshot — the animation drifted. */
    CHANGED
}
