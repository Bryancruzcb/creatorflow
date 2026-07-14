package creatorflow.workflow;

import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.MotionSnapshotStatus;
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
        Instant createdAt) {
}
