package creatorflow.server.storage;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Content-addressed file storage: every stored file is named by its SHA-256,
 * so identical bytes are stored exactly once and the URL of a file can never
 * silently change content — the same property the registry itself is built on.
 */
@Service
public class FileStore {

    private static final int THUMB_MAX_WIDTH = 560;

    private final Path baseDir;
    private final Path thumbsDir;

    public FileStore(@Value("${creatorflow.files.dir:${user.home}/.creatorflow-server/files}") String dir)
            throws IOException {
        this.baseDir = Path.of(dir);
        this.thumbsDir = baseDir.resolve("thumbs");
        Files.createDirectories(thumbsDir);
    }

    public void store(Path source, String sha256) throws IOException {
        Path target = fileFor(sha256);
        if (!Files.exists(target)) {
            Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public Path fileFor(String sha256) {
        return baseDir.resolve(requireSha(sha256));
    }

    public Path thumbFor(String sha256) {
        return thumbsDir.resolve(requireSha(sha256) + ".png");
    }

    /**
     * Downscaled gallery-card preview; PNG so sprite transparency survives.
     * Best-effort: formats ImageIO cannot decode (SVG, WebP) are served as-is instead.
     */
    public void writeThumbnail(Path original, String sha256) {
        try {
            BufferedImage image = ImageIO.read(original.toFile());
            if (image == null) {
                return;
            }
            BufferedImage thumb = image;
            if (image.getWidth() > THUMB_MAX_WIDTH) {
                int height = Math.max(1,
                        (int) Math.round(image.getHeight() * (THUMB_MAX_WIDTH / (double) image.getWidth())));
                thumb = new BufferedImage(THUMB_MAX_WIDTH, height, BufferedImage.TYPE_INT_ARGB);
                Graphics2D g = thumb.createGraphics();
                g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                        RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g.drawImage(image, 0, 0, THUMB_MAX_WIDTH, height, null);
                g.dispose();
            }
            ImageIO.write(thumb, "png", thumbFor(sha256).toFile());
        } catch (IOException e) {
            // thumbnails are optional; the original is served in their place
        }
    }

    private static String requireSha(String sha256) {
        if (sha256 == null || !sha256.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("Not a lowercase 64-hex SHA-256: " + sha256);
        }
        return sha256;
    }
}
