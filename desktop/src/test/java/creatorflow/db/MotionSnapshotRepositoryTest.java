package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.motion.MotionSnapshotKind;
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
                    "cmp-1", "Walk", 1.2, "a".repeat(64), ALGO);
            firstId = first.id();
            assertEquals(MotionSnapshotStatus.FIRST_SNAPSHOT, first.status());
            assertNull(first.supersedesSnapshotId());

            // Re-capture an identical fingerprint: UNCHANGED, supersedes the first.
            var same = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_PUBLISHED,
                    "cmp-2", "Walk", 1.2, "a".repeat(64), ALGO);
            assertEquals(MotionSnapshotStatus.UNCHANGED, same.status());
            assertEquals(firstId, same.supersedesSnapshotId());

            // A different fingerprint: CHANGED.
            var drifted = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_PUBLISHED,
                    "cmp-3", "Walk", 1.3, "b".repeat(64), ALGO);
            assertEquals(MotionSnapshotStatus.CHANGED, drifted.status());
            assertEquals(same.id(), drifted.supersedesSnapshotId());

            // current() returns the newest; history keeps every immutable row.
            assertEquals(drifted.id(), snapshots.current(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED).orElseThrow().id());
            assertEquals(3, snapshots.history(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED, 25, 0).size());

            // A different kind for the same asset is tracked independently.
            var good = snapshots.capture(projectId, "1001", MotionSnapshotKind.LAST_KNOWN_GOOD,
                    null, "Walk", 1.3, "b".repeat(64), ALGO);
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
                    MotionSnapshotKind.LAST_PUBLISHED, null, "Walk", 1.0, "a".repeat(64), ALGO));
            assertThrows(IllegalArgumentException.class, () -> snapshots.capture(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED, null, "Walk", 1.0, " ", ALGO));
            assertThrows(IllegalArgumentException.class, () -> snapshots.capture(projectId, "1001",
                    MotionSnapshotKind.LAST_PUBLISHED, null, "Walk", -1.0, "a".repeat(64), ALGO));
        }
    }
}
