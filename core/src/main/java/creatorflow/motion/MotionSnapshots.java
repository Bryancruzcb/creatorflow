package creatorflow.motion;

/** Pure snapshot-lifecycle logic shared by the desktop persistence layer. */
public final class MotionSnapshots {

    private MotionSnapshots() {
    }

    /**
     * Classifies a new snapshot against the asset's previous snapshot of the same kind, on curve
     * data alone.
     *
     * <p>Prefer {@link #classify(String, PlaybackSettings, String, PlaybackSettings)}: because
     * {@link MotionComparisonEngine#fingerprint} digests curve data <em>only</em>, this overload
     * reports {@code UNCHANGED} for a clip whose {@code Looped} flag or priority was flipped — a
     * real change to how it plays. It remains for callers with no playback settings recorded.
     *
     * @param previousFingerprint the current snapshot's fingerprint, or {@code null}/blank if none
     * @param nextFingerprint     the incoming snapshot's fingerprint (required)
     */
    public static MotionSnapshotStatus classify(String previousFingerprint, String nextFingerprint) {
        return classify(previousFingerprint, PlaybackSettings.unknown(),
                nextFingerprint, PlaybackSettings.unknown());
    }

    /**
     * Classifies a new snapshot against the previous one using both the curve fingerprint and the
     * animation's {@linkplain PlaybackSettings playback settings}.
     *
     * <p>Identical curves are not the same thing as an unchanged animation: flipping {@code Looped}
     * changes how the clip plays in a live experience while leaving every curve value alone. So a
     * difference in either the fingerprint or an observed playback setting is {@code CHANGED}.
     * Settings recorded on only one side are ignored rather than treated as drift — the tool must
     * not report a change it never observed.
     *
     * @param previousFingerprint the current snapshot's fingerprint, or {@code null}/blank if none
     * @param previousSettings    the current snapshot's settings; {@code null} counts as unknown
     * @param nextFingerprint     the incoming snapshot's fingerprint (required)
     * @param nextSettings        the incoming snapshot's settings; {@code null} counts as unknown
     */
    public static MotionSnapshotStatus classify(String previousFingerprint, PlaybackSettings previousSettings,
                                                String nextFingerprint, PlaybackSettings nextSettings) {
        String next = MotionValidation.requireText(nextFingerprint, "next fingerprint");
        if (previousFingerprint == null || previousFingerprint.isBlank()) {
            return MotionSnapshotStatus.FIRST_SNAPSHOT;
        }
        if (!previousFingerprint.equals(next)) {
            return MotionSnapshotStatus.CHANGED;
        }
        PlaybackSettings previous = previousSettings == null ? PlaybackSettings.unknown() : previousSettings;
        PlaybackSettings incoming = nextSettings == null ? PlaybackSettings.unknown() : nextSettings;
        return previous.differsFrom(incoming) ? MotionSnapshotStatus.CHANGED : MotionSnapshotStatus.UNCHANGED;
    }
}
