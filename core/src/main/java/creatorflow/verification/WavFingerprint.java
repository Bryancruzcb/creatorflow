package creatorflow.verification;

import java.io.IOException;
import java.nio.file.Path;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.UnsupportedAudioFileException;

/**
 * 64-bit audio fingerprint for PCM audio (WAV/AIFF/AU) — in spirit, dHash for
 * sound: mix to mono, split the recording into 65 equal windows, compute RMS
 * energy per window, and set each bit by whether the envelope rises or falls
 * between adjacent windows.
 *
 * <p>Comparing neighboring windows (rather than thresholding at a global
 * median) keeps the fingerprint volume-invariant — scaling amplitude preserves
 * the order of every pair — while capturing the envelope's local dynamics, so
 * a swelling pad and a decaying hit no longer collide just because both are
 * "louder at the start".
 *
 * <p>Known limitation, by design: content with a long flat envelope (silence,
 * a sustained organ chord) yields low-entropy fingerprints. Production systems
 * use spectral fingerprints such as Chromaprint — see the README roadmap.
 */
public final class WavFingerprint {

    private static final int BITS = 64;
    private static final int WINDOWS = BITS + 1;

    private WavFingerprint() {
    }

    public static long fingerprint(Path file) throws IOException, UnsupportedAudioFileException {
        double[] samples = readMonoSamples(file);
        if (samples.length < WINDOWS) {
            throw new UnsupportedAudioFileException("Audio too short to fingerprint: " + samples.length + " frames");
        }

        double[] rms = new double[WINDOWS];
        int windowSize = samples.length / WINDOWS;
        for (int w = 0; w < WINDOWS; w++) {
            double sum = 0;
            int start = w * windowSize;
            for (int j = start; j < start + windowSize; j++) {
                sum += samples[j] * samples[j];
            }
            rms[w] = Math.sqrt(sum / windowSize);
        }

        long bits = 0;
        for (int i = 0; i < BITS; i++) {
            bits <<= 1;
            if (rms[i + 1] > rms[i]) {
                bits |= 1;
            }
        }
        return bits;
    }

    private static double[] readMonoSamples(Path file) throws IOException, UnsupportedAudioFileException {
        try (AudioInputStream in = AudioSystem.getAudioInputStream(file.toFile())) {
            AudioFormat format = in.getFormat();
            boolean signed = format.getEncoding() == AudioFormat.Encoding.PCM_SIGNED;
            boolean unsigned = format.getEncoding() == AudioFormat.Encoding.PCM_UNSIGNED;
            int bits = format.getSampleSizeInBits();
            if ((!signed && !unsigned) || (bits != 8 && bits != 16)) {
                throw new UnsupportedAudioFileException("Only 8/16-bit PCM is supported, got " + format);
            }

            byte[] data = in.readAllBytes();
            int channels = format.getChannels();
            int bytesPerSample = bits / 8;
            int frameCount = data.length / (bytesPerSample * channels);

            double[] mono = new double[frameCount];
            for (int frame = 0; frame < frameCount; frame++) {
                double mix = 0;
                for (int ch = 0; ch < channels; ch++) {
                    int offset = (frame * channels + ch) * bytesPerSample;
                    mix += decodeSample(data, offset, bits, signed, format.isBigEndian());
                }
                mono[frame] = mix / channels;
            }
            return mono;
        }
    }

    private static double decodeSample(byte[] data, int offset, int bits, boolean signed, boolean bigEndian) {
        if (bits == 8) {
            int v = data[offset] & 0xFF;
            return signed ? ((byte) v) / 128.0 : (v - 128) / 128.0;
        }
        int lo = data[offset + (bigEndian ? 1 : 0)] & 0xFF;
        int hi = data[offset + (bigEndian ? 0 : 1)];
        int value = (hi << 8) | lo;
        if (!signed) {
            value = (value & 0xFFFF) - 32768;
        }
        return value / 32768.0;
    }
}
