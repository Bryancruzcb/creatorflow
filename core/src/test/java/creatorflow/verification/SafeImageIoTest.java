package creatorflow.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SafeImageIoTest {

    @Test
    void readsANormalImageWithinTheBound(@TempDir Path dir) throws IOException {
        Path png = dir.resolve("small.png");
        ImageIO.write(new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB), "png", png.toFile());

        BufferedImage image = SafeImageIo.read(png.toFile());

        assertNotNull(image);
        assertEquals(4, image.getWidth());
        assertEquals(4, image.getHeight());
    }

    @Test
    void rejectsAnImageWhosePixelCountExceedsTheBoundBeforeDecoding(@TempDir Path dir) throws IOException {
        // 100x100 = 10_000 px. The reader must reject it from the header dimensions
        // (10_000 > 100) instead of allocating the full raster first.
        Path png = dir.resolve("wide.png");
        ImageIO.write(new BufferedImage(100, 100, BufferedImage.TYPE_INT_RGB), "png", png.toFile());

        IOException error = assertThrows(IOException.class, () -> SafeImageIo.read(png.toFile(), 100));

        assertTrue(error.getMessage().toLowerCase().contains("large")
                || error.getMessage().toLowerCase().contains("pixel"),
                "message should explain the size limit, was: " + error.getMessage());
    }

    @Test
    void returnsNullForUndecodableBytesLikeImageIo(@TempDir Path dir) throws IOException {
        Path fake = dir.resolve("not-an-image.png");
        Files.writeString(fake, "this is not a PNG");

        assertNull(SafeImageIo.read(fake.toFile()));
    }
}
