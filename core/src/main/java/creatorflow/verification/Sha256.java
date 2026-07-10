package creatorflow.verification;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Exact-duplicate layer: streaming SHA-256 of file contents. */
public final class Sha256 {

    private Sha256() {
    }

    public static String hash(Path file) throws IOException {
        MessageDigest digest = newDigest();
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = Files.newInputStream(file)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    public static String hash(byte[] data) {
        return HexFormat.of().formatHex(newDigest().digest(data));
    }

    private static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JVM spec", e);
        }
    }
}
