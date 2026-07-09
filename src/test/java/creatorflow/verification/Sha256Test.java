package creatorflow.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class Sha256Test {

    @TempDir
    Path dir;

    @Test
    void matchesKnownTestVector() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                Sha256.hash("abc".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void fileHashingMatchesByteHashing() throws IOException {
        Path file = dir.resolve("sample.bin");
        byte[] data = "creatorflow".getBytes(StandardCharsets.UTF_8);
        Files.write(file, data);
        assertEquals(Sha256.hash(data), Sha256.hash(file));
    }

    @Test
    void differentContentHashesDiffer() throws IOException {
        Path a = Files.write(dir.resolve("a.bin"), new byte[]{1, 2, 3});
        Path b = Files.write(dir.resolve("b.bin"), new byte[]{1, 2, 4});
        assertNotEquals(Sha256.hash(a), Sha256.hash(b));
    }
}
