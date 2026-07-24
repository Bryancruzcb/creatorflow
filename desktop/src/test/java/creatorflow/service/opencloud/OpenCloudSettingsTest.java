package creatorflow.service.opencloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

/**
 * The Open Cloud key store round-trips a masked key and never leaks it. The fallback
 * (labeled plaintext) is exercised on every OS; the Windows DPAPI encryption-at-rest path
 * is exercised only where DPAPI exists.
 */
class OpenCloudSettingsTest {

    @TempDir
    Path dir;

    private static final String SAMPLE_KEY = "oc-secret-9f83a1b7c2d4e5f6";

    // ---- fallback (plaintext) path: runs everywhere ----------------------------------------

    @Test
    void freshStoreIsNotConfigured() {
        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        assertFalse(settings.isConfigured());
        assertEquals("", settings.apiKey());
    }

    @Test
    void blankKeyIsNotConfigured() {
        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        settings.save("   ");
        assertFalse(settings.isConfigured());
        assertEquals("", settings.apiKey());
    }

    @Test
    void saveThenReloadRoundTripsWithFallback() {
        new OpenCloudSettings(dir, new PlaintextApiKeyProtector()).save(SAMPLE_KEY);

        OpenCloudSettings reloaded = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        assertTrue(reloaded.isConfigured());
        assertEquals(SAMPLE_KEY, reloaded.apiKey());
    }

    @Test
    void fallbackModeIsLabeledNotEncrypted() {
        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        assertEquals(KeyStorageMode.PLAINTEXT, settings.storageMode());
        assertEquals("not encrypted on this OS", settings.storageMode().label());
    }

    @Test
    void clearRemovesTheKeyEverywhere() {
        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        settings.save(SAMPLE_KEY);
        assertTrue(settings.isConfigured());

        settings.clear();
        assertFalse(settings.isConfigured());
        assertEquals("", settings.apiKey());
        // a fresh load must also see nothing persisted
        assertFalse(new OpenCloudSettings(dir, new PlaintextApiKeyProtector()).isConfigured());
    }

    @Test
    void keyNeverAppearsInToString() {
        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());
        settings.save(SAMPLE_KEY);
        assertFalse(settings.toString().contains(SAMPLE_KEY),
                "toString must never leak the API key");
    }

    // ---- Windows DPAPI path: encryption-at-rest, real native round-trip --------------------

    @Test
    @EnabledOnOs(OS.WINDOWS)
    void dpapiEncryptsAtRestAndRoundTripsOnWindows() throws Exception {
        OpenCloudSettings settings = new OpenCloudSettings(dir); // default protector = DPAPI on Windows
        settings.save(SAMPLE_KEY);

        assertEquals(KeyStorageMode.DPAPI_WINDOWS, settings.storageMode());
        assertEquals("encrypted (Windows DPAPI)", settings.storageMode().label());

        // the raw persisted value must be ciphertext, not the plaintext key
        String persisted = rawApiKeyProperty(dir);
        assertNotEquals(SAMPLE_KEY, persisted, "the key must be encrypted at rest, not plaintext");
        assertFalse(persisted.contains(SAMPLE_KEY), "no plaintext key fragment may appear on disk");

        OpenCloudSettings reloaded = new OpenCloudSettings(dir);
        assertTrue(reloaded.isConfigured());
        assertEquals(SAMPLE_KEY, reloaded.apiKey(), "DPAPI round-trip must recover the key");
    }

    @Test
    @EnabledOnOs(OS.WINDOWS)
    void defaultProtectorReportsDpapiOnWindows() {
        assertEquals(KeyStorageMode.DPAPI_WINDOWS,
                new OpenCloudSettings(dir).storageMode());
    }

    private static String rawApiKeyProperty(Path dir) throws Exception {
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(dir.resolve("opencloud.properties"))) {
            props.load(in);
        }
        return props.getProperty("apiKey", "");
    }
}
