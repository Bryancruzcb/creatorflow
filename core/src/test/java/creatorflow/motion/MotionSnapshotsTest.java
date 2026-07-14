package creatorflow.motion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class MotionSnapshotsTest {

    @Test
    void kindParsesWireSpellingCaseInsensitivelyAndRejectsUnknown() {
        assertEquals(MotionSnapshotKind.LAST_KNOWN_GOOD, MotionSnapshotKind.fromWire("last_known_good"));
        assertEquals(MotionSnapshotKind.LAST_PUBLISHED, MotionSnapshotKind.fromWire("  LAST_PUBLISHED "));
        assertEquals("LAST_PUBLISHED", MotionSnapshotKind.LAST_PUBLISHED.wire());
        assertThrows(MotionValidationException.class, () -> MotionSnapshotKind.fromWire("archived"));
        assertThrows(MotionValidationException.class, () -> MotionSnapshotKind.fromWire(" "));
    }

    @Test
    void classifyTreatsAMissingPreviousSnapshotAsTheFirst() {
        assertEquals(MotionSnapshotStatus.FIRST_SNAPSHOT, MotionSnapshots.classify(null, "abc"));
        assertEquals(MotionSnapshotStatus.FIRST_SNAPSHOT, MotionSnapshots.classify("", "abc"));
    }

    @Test
    void classifyDetectsAnUnchangedVersusChangedFingerprint() {
        assertEquals(MotionSnapshotStatus.UNCHANGED, MotionSnapshots.classify("abc123", "abc123"));
        assertEquals(MotionSnapshotStatus.CHANGED, MotionSnapshots.classify("abc123", "def456"));
    }

    @Test
    void classifyRequiresTheNextFingerprint() {
        assertThrows(MotionValidationException.class, () -> MotionSnapshots.classify("abc", null));
        assertThrows(MotionValidationException.class, () -> MotionSnapshots.classify("abc", " "));
    }
}
