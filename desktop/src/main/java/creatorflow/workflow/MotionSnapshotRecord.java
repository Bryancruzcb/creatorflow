package creatorflow.workflow;

import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.MotionSnapshotStatus;
import creatorflow.motion.PlaybackSettings;
import java.time.Instant;

/**
 * Immutable capture of one Roblox animation's canonical fingerprint at a moment, tagged as the
 * asset's last-known-good or last-published reference. Snapshots are insert-only: a re-capture
 * supersedes the previous current one (recorded in {@link #supersedesSnapshotId()}) but never
 * overwrites it, so the reference history stays auditable.
 */
public record MotionSnapshotRecord(
        String id,
        long projectId,
        String assetId,
        MotionSnapshotKind kind,
        String sourceComparisonId,
        String name,
        double duration,
        String fingerprint,
        String algorithmVersion,
        String supersedesSnapshotId,
        MotionSnapshotStatus status,
        PlaybackSettings settings,
        String clipKindRaw,
        Instant createdAt) {

    /**
     * How the pinned clip's curves were read — {@code "KEYFRAME"} or {@code "CURVE_SAMPLED"} —
     * recorded at capture time so a reference states its own provenance wherever it is shown.
     *
     * <p>Empty means UNKNOWN, which is a third state and not a synonym for KEYFRAME: every
     * snapshot pinned before this was recorded reads empty, and inferring an exact read from
     * silence would assert something the record never captured.
     */
    public java.util.Optional<String> clipKind() {
        return java.util.Optional.ofNullable(clipKindRaw);
    }
}
