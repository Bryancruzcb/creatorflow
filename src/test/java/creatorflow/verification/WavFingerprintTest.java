package creatorflow.verification;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import java.nio.file.Path;
import javax.sound.sampled.UnsupportedAudioFileException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WavFingerprintTest {

    @TempDir
    Path dir;

    @Test
    void fingerprintIsVolumeInvariant() throws Exception {
        Path loud = TestMedia.writeWav(dir, "loud.wav", TestMedia.tone(1.0));
        Path quiet = TestMedia.writeWav(dir, "quiet.wav", TestMedia.tone(0.35));

        long fpLoud = WavFingerprint.fingerprint(loud);
        long fpQuiet = WavFingerprint.fingerprint(quiet);

        // Quantization at low gain may flip bits where adjacent windows are
        // near-equal (envelope extrema), so allow a tiny distance.
        int distance = ImageHashes.hammingDistance(fpLoud, fpQuiet);
        assertTrue(distance <= 4, "volume change should barely affect the fingerprint, got " + distance);
    }

    @Test
    void differentRecordingsScoreAboveThreshold() throws Exception {
        Path tone = TestMedia.writeWav(dir, "tone.wav", TestMedia.tone(1.0));
        Path burst = TestMedia.writeWav(dir, "burst.wav", TestMedia.burst());

        int distance = ImageHashes.hammingDistance(
                WavFingerprint.fingerprint(tone), WavFingerprint.fingerprint(burst));
        assertTrue(distance > OriginalityEngine.SIMILARITY_THRESHOLD,
                "unrelated recordings should exceed the threshold, got " + distance);
    }

    @Test
    void rejectsAudioShorterThanWindowCount() throws Exception {
        Path tiny = TestMedia.writeWav(dir, "tiny.wav", new double[32]);
        assertThrows(UnsupportedAudioFileException.class, () -> WavFingerprint.fingerprint(tiny));
    }
}
