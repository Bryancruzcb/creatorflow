package creatorflow.verification;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.awt.image.Raster;
import java.util.Arrays;

/**
 * Perceptual image hashing: 64-bit fingerprints that survive resizing,
 * re-encoding and small edits, compared by Hamming distance.
 *
 * <p>Two complementary algorithms:
 * <ul>
 *   <li>{@link #dHash} — gradient hash: compares adjacent pixels of a 9x8
 *       grayscale thumbnail. Fast, strong against scaling and compression.</li>
 *   <li>{@link #pHash} — DCT hash: keeps the lowest-frequency 8x8 block of a
 *       32x32 DCT and thresholds it at the median. More robust against blur,
 *       brightness shifts and watermarking.</li>
 * </ul>
 *
 * Identical images score distance 0; unrelated images average distance ~32.
 */
public final class ImageHashes {

    private ImageHashes() {
    }

    public static long dHash(BufferedImage image) {
        Raster gray = toGray(image, 9, 8).getRaster();
        long bits = 0;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                bits <<= 1;
                if (gray.getSample(x + 1, y, 0) > gray.getSample(x, y, 0)) {
                    bits |= 1;
                }
            }
        }
        return bits;
    }

    public static long pHash(BufferedImage image) {
        final int size = 32;
        Raster gray = toGray(image, size, size).getRaster();

        double[][] pixels = new double[size][size];
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                pixels[y][x] = gray.getSample(x, y, 0);
            }
        }

        double[][] dct = dct2d(pixels);

        // Lowest-frequency 8x8 block, thresholded at the median of its AC coefficients.
        double[] ac = new double[63];
        int i = 0;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                if (x != 0 || y != 0) {
                    ac[i++] = dct[y][x];
                }
            }
        }
        double median = median(ac);

        long bits = 0;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                bits <<= 1;
                if (dct[y][x] > median) {
                    bits |= 1;
                }
            }
        }
        return bits;
    }

    public static int hammingDistance(long a, long b) {
        return Long.bitCount(a ^ b);
    }

    private static BufferedImage toGray(BufferedImage src, int width, int height) {
        BufferedImage out = new BufferedImage(width, height, BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, width, height, null);
        g.dispose();
        return out;
    }

    private static double[][] dct2d(double[][] input) {
        int n = input.length;
        double[][] cos = new double[n][n];
        for (int k = 0; k < n; k++) {
            for (int m = 0; m < n; m++) {
                cos[k][m] = Math.cos(((2 * m + 1) * k * Math.PI) / (2.0 * n));
            }
        }

        double[][] out = new double[n][n];
        for (int u = 0; u < n; u++) {
            for (int v = 0; v < n; v++) {
                double sum = 0;
                for (int y = 0; y < n; y++) {
                    for (int x = 0; x < n; x++) {
                        sum += input[y][x] * cos[u][y] * cos[v][x];
                    }
                }
                double cu = u == 0 ? Math.sqrt(1.0 / n) : Math.sqrt(2.0 / n);
                double cv = v == 0 ? Math.sqrt(1.0 / n) : Math.sqrt(2.0 / n);
                out[u][v] = cu * cv * sum;
            }
        }
        return out;
    }

    private static double median(double[] values) {
        double[] sorted = values.clone();
        Arrays.sort(sorted);
        int mid = sorted.length / 2;
        return sorted.length % 2 == 0 ? (sorted[mid - 1] + sorted[mid]) / 2.0 : sorted[mid];
    }
}
