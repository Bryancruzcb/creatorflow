package creatorflow.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import creatorflow.model.Asset;
import creatorflow.model.VerificationStatus;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Random;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OriginalityEngineTest {

    @TempDir
    Path dir;

    private final OriginalityEngine engine = new OriginalityEngine();

    @Test
    void firstImportIsClearAndRunsExpectedLayers() throws IOException {
        Path image = TestMedia.writePng(dir, "original.png", TestMedia.structuredImage(1));
        OriginalityEngine.Result result = engine.verify(image, List.of());

        assertEquals(VerificationStatus.CLEAR, result.report().status());
        assertTrue(result.report().matches().isEmpty());
        assertTrue(result.report().layersRun().stream().anyMatch(l -> l.contains("SHA-256")));
        assertTrue(result.report().layersRun().stream().anyMatch(l -> l.contains("Perceptual")));
        assertTrue(result.width() > 0);
    }

    @Test
    void byteIdenticalCopyIsDuplicate() throws IOException {
        Path original = TestMedia.writePng(dir, "original.png", TestMedia.structuredImage(1));
        Asset indexed = indexedAsset(original, 1);

        Path copy = dir.resolve("copy.png");
        Files.copy(original, copy);
        OriginalityEngine.Result result = engine.verify(copy, List.of(indexed));

        assertEquals(VerificationStatus.DUPLICATE, result.report().status());
        assertEquals(1, result.report().matches().size());
        assertEquals("sha256", result.report().matches().get(0).layer());
        assertEquals(0, result.report().matches().get(0).distance());
    }

    @Test
    void upscaledCopyIsSimilarViaPerceptualLayer() throws IOException {
        BufferedImage originalImage = TestMedia.structuredImage(1);
        Path original = TestMedia.writePng(dir, "original.png", originalImage);
        Asset indexed = indexedAsset(original, 1);

        Path upscaled = TestMedia.writePng(dir, "upscaled.png",
                TestMedia.resize(originalImage, 512, 512));
        OriginalityEngine.Result result = engine.verify(upscaled, List.of(indexed));

        assertEquals(VerificationStatus.SIMILAR, result.report().status());
        String layer = result.report().matches().get(0).layer();
        assertTrue(layer.equals("phash") || layer.equals("dhash"), "unexpected layer: " + layer);
        assertTrue(result.report().matches().get(0).distance() <= OriginalityEngine.SIMILARITY_THRESHOLD);
    }

    @Test
    void unrelatedImageIsClear() throws IOException {
        Path original = TestMedia.writePng(dir, "original.png", TestMedia.structuredImage(1));
        Asset indexed = indexedAsset(original, 1);

        Path other = TestMedia.writePng(dir, "other.png", TestMedia.structuredImage(999));
        OriginalityEngine.Result result = engine.verify(other, List.of(indexed));

        assertEquals(VerificationStatus.CLEAR, result.report().status());
    }

    @Test
    void binaryFileOnlyRunsHashAndMetadataLayers() throws IOException {
        byte[] bytes = new byte[10_000];
        new Random(3).nextBytes(bytes);
        Path mesh = Files.write(dir.resolve("mesh.glb"), bytes);

        OriginalityEngine.Result result = engine.verify(mesh, List.of());

        assertEquals(VerificationStatus.CLEAR, result.report().status());
        assertFalse(result.report().layersRun().stream().anyMatch(l -> l.contains("Perceptual")));
        assertFalse(result.report().layersRun().stream().anyMatch(l -> l.contains("Audio")));
        assertEquals(0, result.width());
    }

    private Asset indexedAsset(Path file, long id) throws IOException {
        OriginalityEngine.Result result = engine.verify(file, List.of());
        return new Asset(id, 1, file.getFileName().toString(), file.toString(),
                OriginalityEngine.fileType(file), Files.size(file),
                result.width(), result.height(), result.sha256(),
                result.dHash(), result.pHash(), result.audioFp(),
                "All rights reserved", true, result.report().status(), "", Instant.now());
    }
}
