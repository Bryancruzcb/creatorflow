package creatorflow.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ImageHashesTest {

    @TempDir
    Path dir;

    @Test
    void hammingDistanceCountsDifferingBits() {
        assertEquals(0, ImageHashes.hammingDistance(0L, 0L));
        assertEquals(64, ImageHashes.hammingDistance(0L, ~0L));
        assertEquals(1, ImageHashes.hammingDistance(0b1000L, 0b0000L));
    }

    @Test
    void identicalImagesScoreZero() {
        BufferedImage img = TestMedia.structuredImage(42);
        assertEquals(0, ImageHashes.hammingDistance(ImageHashes.dHash(img), ImageHashes.dHash(img)));
        assertEquals(0, ImageHashes.hammingDistance(ImageHashes.pHash(img), ImageHashes.pHash(img)));
    }

    @Test
    void hashesSurviveDownscaling() {
        BufferedImage original = TestMedia.structuredImage(42);
        BufferedImage half = TestMedia.resize(original, 128, 128);
        BufferedImage small = TestMedia.resize(original, 96, 96);

        assertTrue(dDist(original, half) <= OriginalityEngine.SIMILARITY_THRESHOLD);
        assertTrue(pDist(original, half) <= OriginalityEngine.SIMILARITY_THRESHOLD);
        assertTrue(dDist(original, small) <= OriginalityEngine.SIMILARITY_THRESHOLD);
        assertTrue(pDist(original, small) <= OriginalityEngine.SIMILARITY_THRESHOLD);
    }

    @Test
    void hashesSurviveJpegReencoding() throws IOException {
        BufferedImage original = TestMedia.structuredImage(42);
        Path jpeg = TestMedia.writeJpeg(dir, "reencoded.jpg", original);
        BufferedImage decoded = ImageIO.read(jpeg.toFile());

        assertTrue(dDist(original, decoded) <= OriginalityEngine.SIMILARITY_THRESHOLD);
        assertTrue(pDist(original, decoded) <= OriginalityEngine.SIMILARITY_THRESHOLD);
    }

    @Test
    void unrelatedImagesScoreAboveThreshold() {
        BufferedImage a = TestMedia.structuredImage(42);
        BufferedImage b = TestMedia.structuredImage(1337);

        assertTrue(dDist(a, b) > OriginalityEngine.SIMILARITY_THRESHOLD,
                "dHash distance should exceed threshold for unrelated images");
        assertTrue(pDist(a, b) > OriginalityEngine.SIMILARITY_THRESHOLD,
                "pHash distance should exceed threshold for unrelated images");
    }

    private static int dDist(BufferedImage a, BufferedImage b) {
        return ImageHashes.hammingDistance(ImageHashes.dHash(a), ImageHashes.dHash(b));
    }

    private static int pDist(BufferedImage a, BufferedImage b) {
        return ImageHashes.hammingDistance(ImageHashes.pHash(a), ImageHashes.pHash(b));
    }
}
