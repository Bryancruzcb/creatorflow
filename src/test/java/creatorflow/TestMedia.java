package creatorflow;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Random;
import javax.imageio.ImageIO;
import javax.sound.sampled.AudioFileFormat;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;

/** Deterministic media generators shared by the verification tests. */
public final class TestMedia {

    private TestMedia() {
    }

    /**
     * A smooth, structured image (gradient plus seeded shapes). Structured content
     * is what perceptual hashes are designed for; noise would not survive resizing.
     */
    public static BufferedImage structuredImage(long seed) {
        int size = 256;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        Random rnd = new Random(seed);

        Color top = new Color(rnd.nextInt(90), rnd.nextInt(90), 60 + rnd.nextInt(120));
        Color bottom = new Color(120 + rnd.nextInt(120), 60 + rnd.nextInt(120), rnd.nextInt(90));
        for (int y = 0; y < size; y++) {
            float t = y / (float) size;
            g.setColor(new Color(
                    (int) (top.getRed() + (bottom.getRed() - top.getRed()) * t),
                    (int) (top.getGreen() + (bottom.getGreen() - top.getGreen()) * t),
                    (int) (top.getBlue() + (bottom.getBlue() - top.getBlue()) * t)));
            g.fillRect(0, y, size, 1);
        }
        for (int i = 0; i < 5; i++) {
            g.setColor(new Color(rnd.nextInt(256), rnd.nextInt(256), rnd.nextInt(256)));
            int d = 40 + rnd.nextInt(90);
            g.fillOval(rnd.nextInt(size - d), rnd.nextInt(size - d), d, d);
        }
        for (int i = 0; i < 3; i++) {
            g.setColor(new Color(rnd.nextInt(256), rnd.nextInt(256), rnd.nextInt(256)));
            g.fillRect(rnd.nextInt(size - 80), rnd.nextInt(size - 50), 30 + rnd.nextInt(60), 20 + rnd.nextInt(40));
        }
        g.dispose();
        return img;
    }

    public static BufferedImage resize(BufferedImage src, int width, int height) {
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(src, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    public static Path writePng(Path dir, String name, BufferedImage image) throws IOException {
        Path file = dir.resolve(name);
        ImageIO.write(image, "png", file.toFile());
        return file;
    }

    public static Path writeJpeg(Path dir, String name, BufferedImage image) throws IOException {
        Path file = dir.resolve(name);
        ImageIO.write(image, "jpg", file.toFile());
        return file;
    }

    /** Two seconds of layered sines with a slow envelope; {@code gain} scales amplitude only. */
    public static double[] tone(double gain) {
        int rate = 22_050;
        double[] samples = new double[rate * 2];
        for (int i = 0; i < samples.length; i++) {
            double t = i / (double) rate;
            double v = 0.5 * Math.sin(2 * Math.PI * 220 * t)
                    + 0.3 * Math.sin(2 * Math.PI * 440 * t + 0.5);
            double envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.5 * t);
            samples[i] = gain * v * envelope * 0.6;
        }
        return samples;
    }

    /** A decaying noise burst — a completely different energy envelope than {@link #tone}. */
    public static double[] burst() {
        int rate = 22_050;
        double[] samples = new double[rate];
        Random rnd = new Random(7);
        for (int i = 0; i < samples.length; i++) {
            samples[i] = (rnd.nextDouble() * 2 - 1) * Math.exp(-5.0 * i / samples.length) * 0.8;
        }
        return samples;
    }

    public static Path writeWav(Path dir, String name, double[] samples) throws IOException {
        byte[] pcm = new byte[samples.length * 2];
        for (int i = 0; i < samples.length; i++) {
            int v = (int) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, samples[i] * 32767));
            pcm[i * 2] = (byte) (v & 0xFF);
            pcm[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
        }
        AudioFormat format = new AudioFormat(22_050, 16, 1, true, false);
        Path file = dir.resolve(name);
        try (AudioInputStream stream = new AudioInputStream(
                new ByteArrayInputStream(pcm), format, samples.length)) {
            AudioSystem.write(stream, AudioFileFormat.Type.WAVE, file.toFile());
        }
        return file;
    }
}
