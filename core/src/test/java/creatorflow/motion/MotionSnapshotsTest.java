package creatorflow.motion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

    @Test
    void aFlippedLoopFlagIsAChangeEvenWhenTheCurveDataIsIdentical() {
        String sameCurves = "a".repeat(64);
        // The bug: classify compared curve fingerprints only, so a clip republished with Looped
        // flipped came back UNCHANGED from a tool whose job is reporting what changed.
        assertEquals(MotionSnapshotStatus.CHANGED,
                MotionSnapshots.classify(sameCurves, PlaybackSettings.of(true, "Movement"),
                        sameCurves, PlaybackSettings.of(false, "Movement")));
        assertEquals(MotionSnapshotStatus.CHANGED,
                MotionSnapshots.classify(sameCurves, PlaybackSettings.of(true, "Movement"),
                        sameCurves, PlaybackSettings.of(true, "Action")));
        assertEquals(MotionSnapshotStatus.UNCHANGED,
                MotionSnapshots.classify(sameCurves, PlaybackSettings.of(true, "Movement"),
                        sameCurves, PlaybackSettings.of(true, "Movement")));
    }

    @Test
    void settingsRecordedOnOnlyOneSideAreNeverReportedAsDrift() {
        String sameCurves = "b".repeat(64);
        // A snapshot taken before playback settings were recorded must not read as CHANGED just
        // because the newer one knows more -- that would be a change the tool never observed.
        assertEquals(MotionSnapshotStatus.UNCHANGED,
                MotionSnapshots.classify(sameCurves, PlaybackSettings.unknown(),
                        sameCurves, PlaybackSettings.of(false, "Action")));
        assertEquals(MotionSnapshotStatus.UNCHANGED,
                MotionSnapshots.classify(sameCurves, PlaybackSettings.of(false, "Action"),
                        sameCurves, PlaybackSettings.unknown()));
        assertFalse(PlaybackSettings.unknown().isKnown());
    }

    @Test
    void differingCurvesStayChangedRegardlessOfPlaybackSettings() {
        assertEquals(MotionSnapshotStatus.CHANGED,
                MotionSnapshots.classify("c".repeat(64), PlaybackSettings.of(true, "Movement"),
                        "d".repeat(64), PlaybackSettings.of(true, "Movement")));
    }
}
