package creatorflow.server.service;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.UserAccountRepository;
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
import javax.sound.sampled.AudioSystem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Optional first-run content so the gallery demos well. Enabled with
 * {@code --creatorflow.demo-seed=true}; skipped once the demo accounts exist.
 *
 * <p>Everything goes through the real upload pipeline — including one deliberate
 * re-upload of a resized image, so the gallery shows a flagged-similar asset
 * with its evidence out of the box. Demo accounts share the password
 * {@code creatorflow-demo}.
 */
@Component
@ConditionalOnProperty("creatorflow.demo-seed")
public class DemoSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoSeeder.class);
    private static final String DEMO_PASSWORD = "creatorflow-demo";

    private final UserAccountRepository accounts;
    private final GalleryService gallery;
    private final PasswordEncoder passwordEncoder;

    public DemoSeeder(UserAccountRepository accounts, GalleryService gallery,
                      PasswordEncoder passwordEncoder) {
        this.accounts = accounts;
        this.gallery = gallery;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        if (accounts.existsByUsernameIgnoreCase("mira_pixels")) {
            log.info("Demo content already present — seeder skipped.");
            return;
        }
        UserAccount mira = account("mira_pixels", "Mira K.");
        UserAccount ada = account("ada_shaders", "Ada V.");
        UserAccount tomas = account("tomas_sound", "Tomás R.");

        Path dir = Files.createTempDirectory("cf-demo-seed");
        try {
            BufferedImage mesa = scene(103);

            publish(mira, dir, "dune_strider.png", sprite(101), "Dune strider sprite",
                    "16×16 walker for a desert platformer, scaled 16×. Palette locked to four ambers.",
                    "CC-BY 4.0");
            publish(mira, dir, "moss_golem.png", sprite(102), "Moss golem idle frame",
                    "First idle frame of the swamp mini-boss. More frames coming.",
                    "CC0 (public domain)");
            publish(mira, dir, "sunset_mesa.png", mesa, "Sunset mesa key art",
                    "Key art study for the canyon overworld.", "All rights reserved");

            publish(ada, dir, "nebula_noise.png", scene(201), "Nebula noise field",
                    "Layered gradient noise — works as a skybox base or particle tint mask.",
                    "CC0 (public domain)");
            publish(ada, dir, "copper_tiles.png", pattern(202), "Copper wave tiles",
                    "Seamless-ish diagonal tile experiment from the shader sandbox.",
                    "CC-BY-SA 4.0");

            publish(tomas, dir, "pickup_blip.wav", tone(660, 0.35), "Pickup blip",
                    "Short two-partial blip for coins and pickups. 22 kHz mono.",
                    "CC0 (public domain)");
            publish(tomas, dir, "cavern_drip.wav", burst(7), "Cavern drip",
                    "Decaying noise burst, sits well under a long reverb tail.",
                    "CC-BY 4.0");

            // The teaching moment: a resized copy of Mira's key art. The pipeline
            // publishes it flagged SIMILAR with the perceptual-hash evidence attached.
            publish(ada, dir, "mesa_study.png", resize(mesa, 320, 320), "Mesa study (upscale test)",
                    "Rescale test of a canyon piece for a mood board.", "Unknown");

            log.info("Demo seed complete: 3 members, 8 assets (one flagged similar). "
                    + "Demo password: {}", DEMO_PASSWORD);
        } finally {
            try (var paths = Files.list(dir)) {
                for (Path p : paths.toList()) {
                    Files.deleteIfExists(p);
                }
            }
            Files.deleteIfExists(dir);
        }
    }

    private UserAccount account(String username, String displayName) {
        UserAccount account = new UserAccount(username, ApiKeys.newKey());
        account.setPasswordHash(passwordEncoder.encode(DEMO_PASSWORD));
        account.setDisplayName(displayName);
        return accounts.save(account);
    }

    private void publish(UserAccount user, Path dir, String fileName, BufferedImage image,
                         String title, String description, String license) throws IOException {
        Path file = dir.resolve(fileName);
        ImageIO.write(image, "png", file.toFile());
        publishFile(user, file, title, description, license);
    }

    private void publish(UserAccount user, Path dir, String fileName, double[] samples,
                         String title, String description, String license) throws IOException {
        Path file = writeWav(dir.resolve(fileName), samples);
        publishFile(user, file, title, description, license);
    }

    private void publishFile(UserAccount user, Path file, String title, String description,
                             String license) throws IOException {
        GalleryService.UploadOutcome outcome = gallery.publish(user, file,
                file.getFileName().toString(), Files.size(file), title, description, license, true);
        log.info("Seeded “{}” → {}", title,
                outcome.published() ? outcome.verdict() : "blocked: " + outcome.blockReason());
    }

    /* ---- procedural media ------------------------------------------------ */

    /** Mirrored random mask scaled up — the classic pixel-sprite look. */
    private static BufferedImage sprite(long seed) {
        Random rnd = new Random(seed);
        int grid = 16;
        int scale = 16;
        Color[] palette = {
                new Color(30 + rnd.nextInt(60), 25 + rnd.nextInt(50), 20 + rnd.nextInt(40)),
                new Color(120 + rnd.nextInt(80), 80 + rnd.nextInt(60), 40 + rnd.nextInt(50)),
                new Color(190 + rnd.nextInt(60), 140 + rnd.nextInt(60), 70 + rnd.nextInt(60)),
                new Color(230 + rnd.nextInt(25), 210 + rnd.nextInt(40), 150 + rnd.nextInt(60))};
        BufferedImage img = new BufferedImage(grid * scale, grid * scale,
                BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        for (int y = 0; y < grid; y++) {
            for (int x = 0; x < grid / 2; x++) {
                if (rnd.nextDouble() < 0.42) {
                    g.setColor(palette[rnd.nextInt(palette.length)]);
                    g.fillRect(x * scale, y * scale, scale, scale);
                    g.fillRect((grid - 1 - x) * scale, y * scale, scale, scale);
                }
            }
        }
        g.dispose();
        return img;
    }

    /** Smooth gradient plus seeded shapes — structured content perceptual hashes like. */
    private static BufferedImage scene(long seed) {
        Random rnd = new Random(seed);
        int size = 512;
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        Color top = new Color(20 + rnd.nextInt(70), 25 + rnd.nextInt(60), 60 + rnd.nextInt(120));
        Color bottom = new Color(150 + rnd.nextInt(100), 80 + rnd.nextInt(90), 40 + rnd.nextInt(80));
        for (int y = 0; y < size; y++) {
            float t = y / (float) size;
            g.setColor(new Color(
                    (int) (top.getRed() + (bottom.getRed() - top.getRed()) * t),
                    (int) (top.getGreen() + (bottom.getGreen() - top.getGreen()) * t),
                    (int) (top.getBlue() + (bottom.getBlue() - top.getBlue()) * t)));
            g.fillRect(0, y, size, 1);
        }
        for (int i = 0; i < 4; i++) {
            g.setColor(new Color(rnd.nextInt(200), rnd.nextInt(160), rnd.nextInt(160),
                    120 + rnd.nextInt(100)));
            int d = 80 + rnd.nextInt(220);
            g.fillOval(rnd.nextInt(size) - d / 2, size / 3 + rnd.nextInt(size / 2), d, d / 2);
        }
        g.dispose();
        return img;
    }

    private static BufferedImage pattern(long seed) {
        Random rnd = new Random(seed);
        int size = 512;
        int band = 24 + rnd.nextInt(24);
        Color a = new Color(140 + rnd.nextInt(60), 70 + rnd.nextInt(50), 40 + rnd.nextInt(30));
        Color b = new Color(30 + rnd.nextInt(30), 25 + rnd.nextInt(25), 22 + rnd.nextInt(20));
        BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        for (int x = -size; x < size * 2; x += band) {
            g.setColor((x / band) % 2 == 0 ? a : b);
            for (int i = 0; i < band; i++) {
                g.drawLine(x + i, 0, x + i + size, size);
            }
        }
        g.dispose();
        return img;
    }

    private static BufferedImage resize(BufferedImage src, int width, int height) {
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(src, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    private static double[] tone(double frequency, double seconds) {
        int rate = 22_050;
        double[] samples = new double[(int) (rate * seconds)];
        for (int i = 0; i < samples.length; i++) {
            double t = i / (double) rate;
            double envelope = Math.exp(-6.0 * i / samples.length);
            samples[i] = (0.6 * Math.sin(2 * Math.PI * frequency * t)
                    + 0.3 * Math.sin(2 * Math.PI * frequency * 1.5 * t)) * envelope * 0.7;
        }
        return samples;
    }

    private static double[] burst(long seed) {
        int rate = 22_050;
        double[] samples = new double[rate];
        Random rnd = new Random(seed);
        for (int i = 0; i < samples.length; i++) {
            samples[i] = (rnd.nextDouble() * 2 - 1) * Math.exp(-4.5 * i / samples.length) * 0.7;
        }
        return samples;
    }

    private static Path writeWav(Path file, double[] samples) throws IOException {
        byte[] pcm = new byte[samples.length * 2];
        for (int i = 0; i < samples.length; i++) {
            int v = (int) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, samples[i] * 32767));
            pcm[i * 2] = (byte) (v & 0xFF);
            pcm[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
        }
        AudioFormat format = new AudioFormat(22_050, 16, 1, true, false);
        try (AudioInputStream stream = new AudioInputStream(
                new ByteArrayInputStream(pcm), format, samples.length)) {
            AudioSystem.write(stream, AudioFileFormat.Type.WAVE, file.toFile());
        }
        return file;
    }
}
