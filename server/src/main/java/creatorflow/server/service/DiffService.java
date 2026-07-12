package creatorflow.server.service;

import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.storage.FileStore;
import creatorflow.verification.ImageHashes;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Service;

/**
 * Visual comparison between two versions of a stack: a pixel-difference
 * heatmap (unchanged pixels dimmed, changes tinted by magnitude) plus the
 * fingerprint distances the engine already speaks in. Deterministic for a
 * given pair of files, so the SHA pair doubles as a strong ETag.
 */
@Service
public class DiffService {

    private static final int MAX_WIDTH = 800;
    private static final int CHANGE_THRESHOLD = 12;

    /** Everything the compare page shows. The image is null for audio stacks. */
    public record Diff(BufferedImage heatmap, Double changedPercent,
                       Integer dHashDistance, Integer pHashDistance, Integer audioDistance) {
    }

    private final FileStore files;

    public DiffService(FileStore files) {
        this.files = files;
    }

    public Diff compare(RegisteredAsset from, RegisteredAsset to) throws IOException {
        Integer dHash = distance(from.getDHash(), to.getDHash());
        Integer pHash = distance(from.getPHash(), to.getPHash());
        Integer audio = distance(from.getAudioFp(), to.getAudioFp());

        if (!from.isImage() || !to.isImage()) {
            return new Diff(null, null, dHash, pHash, audio);
        }
        BufferedImage a = ImageIO.read(files.fileFor(from.getSha256()).toFile());
        BufferedImage b = ImageIO.read(files.fileFor(to.getSha256()).toFile());
        if (a == null || b == null) {
            return new Diff(null, null, dHash, pHash, audio);
        }

        int width = Math.min(MAX_WIDTH, Math.max(a.getWidth(), b.getWidth()));
        int height = Math.max(1, (int) Math.round(width * (a.getHeight() / (double) a.getWidth())));
        BufferedImage left = scaled(a, width, height);
        BufferedImage right = scaled(b, width, height);

        BufferedImage heat = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        long changed = 0;
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int p = left.getRGB(x, y);
                int q = right.getRGB(x, y);
                int delta = (Math.abs(((p >> 16) & 0xFF) - ((q >> 16) & 0xFF))
                        + Math.abs(((p >> 8) & 0xFF) - ((q >> 8) & 0xFF))
                        + Math.abs((p & 0xFF) - (q & 0xFF))) / 3;
                if (delta < CHANGE_THRESHOLD) {
                    int luma = (((p >> 16) & 0xFF) + ((p >> 8) & 0xFF) + (p & 0xFF)) / 3;
                    int dim = 14 + luma / 5;
                    heat.setRGB(x, y, (dim << 16) | (dim << 8) | dim);
                } else {
                    changed++;
                    heat.setRGB(x, y, tint(Math.min(1.0, delta / 160.0)));
                }
            }
        }
        double percent = 100.0 * changed / ((long) width * height);
        return new Diff(heat, Math.round(percent * 10) / 10.0, dHash, pHash, audio);
    }

    private static Integer distance(Long a, Long b) {
        return a == null || b == null ? null : ImageHashes.hammingDistance(a, b);
    }

    private static BufferedImage scaled(BufferedImage src, int width, int height) {
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(src, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    /** Amber for small changes shading into rust for large ones — the status ramp. */
    private static int tint(double t) {
        int r = (int) (0xD9 + (0xE2 - 0xD9) * t);
        int g = (int) (0xA9 + (0x54 - 0xA9) * t);
        int b = (int) (0x4E + (0x3F - 0x4E) * t);
        return (r << 16) | (g << 8) | b;
    }
}
