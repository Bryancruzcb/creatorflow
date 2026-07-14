package creatorflow.verification;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/**
 * A decompression-bomb-safe replacement for {@link ImageIO#read(File)}.
 *
 * <p>{@code ImageIO.read} allocates the full pixel raster before anything can
 * inspect the image's dimensions, so a few-hundred-kilobyte file that declares a
 * huge canvas (e.g. a solid-colour 25000x25000 PNG) decodes to gigabytes and can
 * exhaust the heap. Every caller here reads attacker-supplied files, so we read
 * the declared dimensions from the header first and refuse anything past a pixel
 * budget before the raster is ever allocated.
 *
 * <p>Return contract matches {@code ImageIO.read}: {@code null} when no installed
 * reader can decode the bytes (unknown or corrupt format), so existing null
 * checks keep working. Oversized images throw {@link IOException} instead.
 */
public final class SafeImageIo {

    /**
     * Default ceiling on decoded pixels (~40 megapixels, a ~160 MB ARGB raster).
     * Comfortably above legitimate sprites, textures and photographs while
     * blocking the multi-hundred-megapixel canvases used for decompression bombs.
     */
    public static final long DEFAULT_MAX_PIXELS = 40_000_000L;

    private SafeImageIo() {
    }

    public static BufferedImage read(File file) throws IOException {
        return read(file, DEFAULT_MAX_PIXELS);
    }

    public static BufferedImage read(File file, long maxPixels) throws IOException {
        try (ImageInputStream stream = ImageIO.createImageInputStream(file)) {
            if (stream == null) {
                return null;
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) {
                return null;
            }
            ImageReader reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                long width = reader.getWidth(0);
                long height = reader.getHeight(0);
                if (width * height > maxPixels) {
                    throw new IOException("Image too large to decode safely: " + width + "x" + height
                            + " exceeds the " + maxPixels + "-pixel limit");
                }
                return reader.read(0);
            } finally {
                reader.dispose();
            }
        }
    }
}
