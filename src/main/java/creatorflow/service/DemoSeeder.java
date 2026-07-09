package creatorflow.service;

import creatorflow.db.AssetRepository;
import creatorflow.db.ProjectRepository;
import creatorflow.model.Project;
import creatorflow.service.AssetImporter.ImportRequest;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;
import javax.imageio.ImageIO;
import javax.sound.sampled.AudioFileFormat;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;

/**
 * Fills an empty library with procedurally generated sample assets, imported
 * through the real pipeline so every fingerprint, match and verdict is genuine.
 * The set deliberately includes a byte-identical copy (DUPLICATE), an upscaled
 * copy (SIMILAR via perceptual hash) and a re-normalized recording (SIMILAR via
 * audio fingerprint).
 *
 * <p>Runs with {@code -Dcreatorflow.demo=true} on an empty library; also used
 * for README screenshots.
 */
public final class DemoSeeder {

    public static final String DEMO_PROPERTY = "creatorflow.demo";

    private final ProjectRepository projects;
    private final AssetImporter importer;
    private final Path workDir;

    public DemoSeeder(ProjectRepository projects, AssetRepository assets,
                      AssetImporter importer, Path dataDir) {
        this.projects = projects;
        this.importer = importer;
        this.workDir = dataDir.resolve("demo-sources");
    }

    public void seedIfEmpty() {
        if (projects.count() > 0) {
            return;
        }
        try {
            Files.createDirectories(workDir);

            Project rpg = projects.insert("Fantasy RPG",
                    "Sprites and ambience for the roguelike side project.");
            Project logos = projects.insert("Logo Pack v2",
                    "Client identity refresh — marks and UI chrome.");
            Project character = projects.insert("3D Character Model",
                    "Base mesh and turnaround renders for the knight.");

            // Originals first, so the copies below get flagged against them.
            Path hero = writePng("hero_sprite.png", sprite(64, 0xA11CE));
            importFile(hero, rpg, "All rights reserved", true);

            Path tileset = writePng("forest_tileset.png", tileset(0xF0557));
            importFile(tileset, rpg, "All rights reserved", true);

            Path ambience = writeWav("forest_ambience.wav", ambience(1.0));
            importFile(ambience, rpg, "CC-BY 4.0", true);

            Path clash = writeWav("sword_clash.wav", noiseBurst());
            importFile(clash, rpg, "CC0 (public domain)", true);

            Path logo = writePng("logo_mark.png", logoMark(new Color(0x2F6F6D), new Color(0xE8E4DA)));
            importFile(logo, logos, "All rights reserved", true);

            Path buttons = writePng("ui_buttons.png", buttonSheet());
            importFile(buttons, logos, "All rights reserved", true);

            Path mesh = writeBytes("character_base.glb", pseudoRandomBytes(48_000, 0x91B));
            importFile(mesh, character, "All rights reserved", true);

            Path turnaround = writePng("knight_turnaround.png", sprite(64, 0xC0FFEE));
            importFile(turnaround, character, "All rights reserved", true);

            // A byte-identical re-upload: exact-hash layer flags it as DUPLICATE.
            Path duplicate = workDir.resolve("hero_sprite_final.png");
            Files.copy(hero, duplicate);
            importFile(duplicate, rpg, "All rights reserved", true);

            // An upscaled re-encode: perceptual layer flags it as SIMILAR.
            Path upscaled = writePng("hero_sprite_upscaled.png", upscale(ImageIO.read(hero.toFile()), 2));
            importFile(upscaled, rpg, "Unknown", false);

            // The same recording, volume-normalized: audio layer flags it as SIMILAR.
            Path renormalized = writeWav("forest_ambience_normalized.wav", ambience(0.35));
            importFile(renormalized, rpg, "Unknown", false);
        } catch (IOException e) {
            throw new IllegalStateException("Demo seeding failed", e);
        }
    }

    private void importFile(Path file, Project project, String license, boolean declared) throws IOException {
        importer.importFile(new ImportRequest(file, project.id(), license, declared));
    }

    // ---- procedural generators (deterministic; seeds fixed for reproducible screenshots) ----

    /** Mirrored blocky sprite on a soft vertical gradient, pixel-art style. */
    private static BufferedImage sprite(int cells, long seed) {
        int scale = 6;
        int size = cells * scale;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        Random rnd = new Random(seed);

        Color top = new Color(30 + rnd.nextInt(40), 34 + rnd.nextInt(40), 44 + rnd.nextInt(40));
        Color bottom = top.brighter();
        for (int y = 0; y < size; y++) {
            float t = y / (float) size;
            g.setColor(blend(top, bottom, t));
            g.fillRect(0, y, size, 1);
        }

        Color[] palette = {
                new Color(226, 220, 205),
                new Color(180 + rnd.nextInt(40), 120 + rnd.nextInt(60), 70 + rnd.nextInt(50)),
                new Color(90 + rnd.nextInt(60), 140 + rnd.nextInt(60), 110 + rnd.nextInt(60)),
                new Color(60 + rnd.nextInt(30), 62 + rnd.nextInt(30), 70 + rnd.nextInt(30))
        };
        for (int y = 8; y < cells - 8; y++) {
            for (int x = 12; x < cells / 2; x++) {
                if (rnd.nextFloat() < 0.42f) {
                    g.setColor(palette[rnd.nextInt(palette.length)]);
                    g.fillRect(x * scale, y * scale, scale, scale);
                    g.fillRect((cells - 1 - x) * scale, y * scale, scale, scale); // mirror
                }
            }
        }
        g.dispose();
        return img;
    }

    private static BufferedImage tileset(long seed) {
        int tile = 48;
        int cols = 8;
        int rows = 5;
        BufferedImage img = new BufferedImage(cols * tile, rows * tile, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        Random rnd = new Random(seed);
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                int green = 70 + rnd.nextInt(90);
                g.setColor(new Color(24 + rnd.nextInt(30), green, 40 + rnd.nextInt(30)));
                g.fillRect(c * tile, r * tile, tile, tile);
                g.setColor(new Color(0, 0, 0, 40));
                g.drawRect(c * tile, r * tile, tile - 1, tile - 1);
                g.setColor(new Color(255, 255, 255, 18 + rnd.nextInt(30)));
                g.fillOval(c * tile + rnd.nextInt(tile / 2), r * tile + rnd.nextInt(tile / 2),
                        tile / 3, tile / 4);
            }
        }
        g.dispose();
        return img;
    }

    private static BufferedImage logoMark(Color ink, Color paper) {
        int size = 480;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(paper);
        g.fillRect(0, 0, size, size);
        g.setColor(ink);
        g.setStroke(new java.awt.BasicStroke(26));
        g.drawOval(90, 90, 300, 300);
        g.fillOval(210, 210, 60, 60);
        g.drawLine(240, 90, 240, 180);
        g.dispose();
        return img;
    }

    private static BufferedImage buttonSheet() {
        int w = 520;
        int h = 300;
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setColor(new Color(0x24, 0x26, 0x2B));
        g.fillRect(0, 0, w, h);
        Color[] fills = {new Color(0x4A6B8A), new Color(0x3D5C48), new Color(0x6B4A4A)};
        for (int row = 0; row < 3; row++) {
            g.setColor(fills[row]);
            g.fillRoundRect(40, 36 + row * 84, 260, 56, 14, 14);
            g.setColor(fills[row].brighter());
            g.drawRoundRect(340, 36 + row * 84, 140, 56, 14, 14);
        }
        g.dispose();
        return img;
    }

    private static BufferedImage upscale(BufferedImage src, int factor) {
        BufferedImage out = new BufferedImage(src.getWidth() * factor, src.getHeight() * factor,
                BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.drawImage(src, 0, 0, out.getWidth(), out.getHeight(), null);
        g.dispose();
        return out;
    }

    /** Two-second layered-sine ambience; {@code gain} scales amplitude only. */
    private static double[] ambience(double gain) {
        int rate = 22_050;
        double[] samples = new double[rate * 2];
        Random rnd = new Random(0xA0D10);
        for (int i = 0; i < samples.length; i++) {
            double t = i / (double) rate;
            double v = 0.45 * Math.sin(2 * Math.PI * 110 * t)
                    + 0.25 * Math.sin(2 * Math.PI * 220 * t + 0.7)
                    + 0.12 * Math.sin(2 * Math.PI * 331 * t)
                    + 0.08 * (rnd.nextDouble() - 0.5);
            double envelope = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t);
            samples[i] = gain * v * envelope * 0.5;
        }
        return samples;
    }

    private static double[] noiseBurst() {
        int rate = 22_050;
        double[] samples = new double[rate];
        Random rnd = new Random(0x51A5);
        for (int i = 0; i < samples.length; i++) {
            double decay = Math.exp(-6.0 * i / samples.length);
            samples[i] = (rnd.nextDouble() * 2 - 1) * decay * 0.8;
        }
        return samples;
    }

    private static byte[] pseudoRandomBytes(int count, long seed) {
        byte[] bytes = new byte[count];
        new Random(seed).nextBytes(bytes);
        return bytes;
    }

    private static Color blend(Color a, Color b, float t) {
        return new Color(
                (int) (a.getRed() + (b.getRed() - a.getRed()) * t),
                (int) (a.getGreen() + (b.getGreen() - a.getGreen()) * t),
                (int) (a.getBlue() + (b.getBlue() - a.getBlue()) * t));
    }

    private Path writePng(String name, BufferedImage image) throws IOException {
        Path file = workDir.resolve(name);
        ImageIO.write(image, "png", file.toFile());
        return file;
    }

    private Path writeBytes(String name, byte[] data) throws IOException {
        Path file = workDir.resolve(name);
        Files.write(file, data);
        return file;
    }

    private Path writeWav(String name, double[] samples) throws IOException {
        byte[] pcm = new byte[samples.length * 2];
        for (int i = 0; i < samples.length; i++) {
            int v = (int) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, samples[i] * 32767));
            pcm[i * 2] = (byte) (v & 0xFF);
            pcm[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
        }
        AudioFormat format = new AudioFormat(22_050, 16, 1, true, false);
        Path file = workDir.resolve(name);
        try (AudioInputStream stream = new AudioInputStream(
                new ByteArrayInputStream(pcm), format, samples.length)) {
            javax.sound.sampled.AudioSystem.write(stream, AudioFileFormat.Type.WAVE, file.toFile());
        }
        return file;
    }
}
