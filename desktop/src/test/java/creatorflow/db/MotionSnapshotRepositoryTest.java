package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.motion.MotionSnapshotKind;
import creatorflow.motion.PlaybackSettings;
import creatorflow.motion.MotionSnapshotStatus;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class MotionSnapshotRepositoryTest {

    @TempDir
    Path directory;

    private static final String ALGO = "creatorflow.motion-fingerprint/v1";

    @Test
    void capturesSupersedesAndClassifiesFingerprintDrift() throws Exception {
        Path file = directory.resolve("snapshots.db");
        long projectId;
        String firstId;
        try (Database database = new Database(file)) {
            projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var snapshots = new MotionSnapshotRepository(database);

            var first = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_PUBLISHED,
                    "cmp-1", "Walk", 1.2, "a".repeat(64), ALGO, PlaybackSettings.unknown(), null);
            firstId = first.id();
            assertEquals(MotionSnapshotStatus.FIRST_SNAPSHOT, first.status());
            assertNull(first.supersedesSnapshotId());

            // Re-capture an identical fingerprint: UNCHANGED, supersedes the first.
            var same = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_PUBLISHED,
                    "cmp-2", "Walk", 1.2, "a".repeat(64), ALGO, PlaybackSettings.unknown(), null);
            assertEquals(MotionSnapshotStatus.UNCHANGED, same.status());
            assertEquals(firstId, same.supersedesSnapshotId());

            // A different fingerprint: CHANGED.
            var drifted = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_PUBLISHED,
                    "cmp-3", "Walk", 1.3, "b".repeat(64), ALGO, PlaybackSettings.unknown(), null);
            assertEquals(MotionSnapshotStatus.CHANGED, drifted.status());
            assertEquals(same.id(), drifted.supersedesSnapshotId());

            // current() returns the newest; history keeps every immutable row.
            assertEquals(drifted.id(), snapshots.current(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED).orElseThrow().id());
            assertEquals(3, snapshots.history(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED, 25, 0).size());

            // A different kind for the same asset is tracked independently.
            var good = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Walk", 1.3, "b".repeat(64), ALGO, PlaybackSettings.unknown(), null);
            assertEquals(MotionSnapshotStatus.FIRST_SNAPSHOT, good.status());
        }

        // currentForProject returns one row per (asset, kind), newest first; survives restart.
        try (Database database = new Database(file)) {
            var snapshots = new MotionSnapshotRepository(database);
            List<?> current = snapshots.currentForProject(projectId);
            assertEquals(2, current.size());

            // Cascade delete with the project.
            try (var statement = database.connection().prepareStatement("DELETE FROM projects WHERE id = ?")) {
                statement.setLong(1, projectId);
                assertEquals(1, statement.executeUpdate());
            }
            assertTrue(snapshots.currentForProject(projectId).isEmpty());
            assertTrue(snapshots.findById(firstId).isEmpty());
        }
    }

    @Test
    void rejectsBlankRequiredFields() {
        try (Database database = new Database(directory.resolve("reject.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var snapshots = new MotionSnapshotRepository(database);
            assertThrows(IllegalArgumentException.class, () -> snapshots.capture(projectId, " ",
                    MotionSnapshotKind.LAST_PUBLISHED, null, "Walk", 1.0, "a".repeat(64), ALGO, PlaybackSettings.unknown(), null));
            assertThrows(IllegalArgumentException.class, () -> snapshots.capture(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED, null, "Walk", 1.0, " ", ALGO, PlaybackSettings.unknown(), null));
            assertThrows(IllegalArgumentException.class, () -> snapshots.capture(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED, null, "Walk", -1.0, "a".repeat(64), ALGO, PlaybackSettings.unknown(), null));
        }
    }

    /**
     * A snapshot records how the clip it pinned was read (#131).
     *
     * <p>Before this, the clip kind lived only on {@code animation_comparisons}, so a pinned
     * sampled reference was indistinguishable from one taken off an exact keyframe read — and so
     * was any later CHANGED verdict on it. That is the row where the residual risk documented on
     * {@code LocalBridgeServer.CURVE_SAMPLED_SNAPSHOTS_ALLOWED} actually lands, which is why the
     * fact travels with the snapshot rather than staying a join away.
     *
     * <p>The null case is the compatibility contract and is asserted deliberately: a snapshot
     * captured without a clip kind reads back as absent — UNKNOWN — and must never be inferred to
     * be KEYFRAME, which would print "exact" over a row that never recorded whether it was.
     */
    @Test
    void capturesAndRoundTripsTheClipKindOfThePinnedSide() {
        Path file = directory.resolve("clipkind.db");
        long projectId;
        try (Database database = new Database(file)) {
            projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var snapshots = new MotionSnapshotRepository(database);

            var sampled = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    "cmp-1", "Walk", 1.0, "a".repeat(64), ALGO, PlaybackSettings.unknown(),
                    "CURVE_SAMPLED");
            assertEquals("CURVE_SAMPLED", sampled.clipKind().orElseThrow());

            var exact = snapshots.capture(projectId, "1002", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    "cmp-1", "Zip", 1.0, "b".repeat(64), ALGO, PlaybackSettings.unknown(),
                    "KEYFRAME");
            assertEquals("KEYFRAME", exact.clipKind().orElseThrow());

            // A capture that recorded nothing stays empty — not KEYFRAME by default.
            var unknown = snapshots.capture(projectId, "1003", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Idle", 1.0, "c".repeat(64), ALGO, PlaybackSettings.unknown(), null);
            assertTrue(unknown.clipKind().isEmpty());
            // Blank is the same nothing as null: a plugin that sends "" has told us nothing.
            var blank = snapshots.capture(projectId, "1004", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Sit", 1.0, "d".repeat(64), ALGO, PlaybackSettings.unknown(), "  ");
            assertTrue(blank.clipKind().isEmpty());

            // It survives every read path, not just the value capture() hands straight back.
            assertEquals("CURVE_SAMPLED",
                    snapshots.findById(sampled.id()).orElseThrow().clipKind().orElseThrow());
            assertEquals("CURVE_SAMPLED", snapshots.current(projectId, "1001",
                    MotionSnapshotKind.LAST_KNOWN_GOOD).orElseThrow().clipKind().orElseThrow());
            assertEquals("CURVE_SAMPLED", snapshots.history(projectId, "1001",
                    MotionSnapshotKind.LAST_KNOWN_GOOD, 25, 0).getFirst().clipKind().orElseThrow());
            assertEquals(4, snapshots.currentForProject(projectId).size());
        }

        // And across a restart, which is the read path a person actually sees it through.
        try (Database database = new Database(file)) {
            var snapshots = new MotionSnapshotRepository(database);
            // A plain map, not Collectors.toMap: an absent clip kind is a null value here, and
            // that is the entry this case exists to assert.
            var byAsset = new java.util.HashMap<String, String>();
            snapshots.currentForProject(projectId)
                    .forEach(record -> byAsset.put(record.assetId(), record.clipKind().orElse(null)));
            assertEquals("CURVE_SAMPLED", byAsset.get("1001"));
            assertEquals("KEYFRAME", byAsset.get("1002"));
            assertNull(byAsset.get("1003"));
        }
    }

    @Test
    void reCapturingWithAFlippedLoopFlagIsRecordedAsChanged() {
        try (Database database = new Database(directory.resolve("playback.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var repository = new MotionSnapshotRepository(database);
            String sameCurves = "f".repeat(64);

            var first = repository.capture(projectId, "1001", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Walk", 1.0, sameCurves, "creatorflow.motion-compare/v0.1",
                    PlaybackSettings.of(true, "Movement"), null);
            assertEquals(MotionSnapshotStatus.FIRST_SNAPSHOT, first.status());

            // Identical curve data, Looped flipped: the clip plays differently in a live
            // experience, so drift detection must not report UNCHANGED.
            var flipped = repository.capture(projectId, "1001", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Walk", 1.0, sameCurves, "creatorflow.motion-compare/v0.1",
                    PlaybackSettings.of(false, "Movement"), null);
            assertEquals(MotionSnapshotStatus.CHANGED, flipped.status());
            assertEquals(Boolean.FALSE, flipped.settings().looped());

            var same = repository.capture(projectId, "1001", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Walk", 1.0, sameCurves, "creatorflow.motion-compare/v0.1",
                    PlaybackSettings.of(false, "Movement"), null);
            assertEquals(MotionSnapshotStatus.UNCHANGED, same.status());

            // Settings survive the round trip through SQLite, including the tri-state unknown.
            var unknown = repository.capture(projectId, "2002", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "NoSettings", 1.0, sameCurves, "creatorflow.motion-compare/v0.1",
                    PlaybackSettings.unknown(), null);
            assertEquals(null, repository.findById(unknown.id()).orElseThrow().settings().looped());
            assertEquals(Boolean.FALSE, repository.findById(same.id()).orElseThrow().settings().looped());
        }
    }
}
