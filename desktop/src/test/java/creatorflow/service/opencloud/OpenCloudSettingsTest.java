package creatorflow.service.opencloud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.net.URLClassLoader;
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
    /** Base64-shaped, i.e. exactly what DPAPI ciphertext looks like at rest. */
    private static final String CIPHERTEXT_SHAPED = "AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAA";

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

    // ---- an unusable at-rest form degrades to "not configured", never to a bogus key -------

    /**
     * Regression: a stored value whose {@code storageMode} label is unrecognized used to be decoded
     * as if it were plaintext, so DPAPI ciphertext was handed back as {@link #apiKey()} and would be
     * sent to Roblox verbatim as {@code x-api-key}. An unidentifiable protection mode means the
     * stored value cannot be decoded at all — the honest reading is "not configured".
     */
    @Test
    void anUnrecognizedStorageModeIsNotConfiguredRatherThanReadAsPlaintext() throws Exception {
        writeStoredSettings(CIPHERTEXT_SHAPED, "OS_KEYCHAIN_MACOS");

        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());

        assertFalse(settings.isConfigured(), "an undecodable stored key must read as not configured");
        assertEquals("", settings.apiKey());
        assertNotEquals(CIPHERTEXT_SHAPED, settings.apiKey(),
                "the at-rest value must never be handed out as if it were the key");
    }

    /** Same defect via the other door: the mode property is absent entirely. */
    @Test
    void aMissingStorageModeWithAStoredValueIsNotConfigured() throws Exception {
        writeStoredSettings(CIPHERTEXT_SHAPED, null);

        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());

        assertFalse(settings.isConfigured(), "a stored value with no mode label cannot be decoded");
        assertEquals("", settings.apiKey());
    }

    /** A DPAPI-labeled value that is not decodable ciphertext is also just "not configured". */
    @Test
    void corruptedCiphertextIsNotConfigured() throws Exception {
        writeStoredSettings("!!! not base64 !!!", KeyStorageMode.DPAPI_WINDOWS.name());

        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());

        assertFalse(settings.isConfigured());
        assertEquals("", settings.apiKey());
    }

    /** A plaintext-labeled key still loads — the fix must not break the fallback platform. */
    @Test
    void anExplicitPlaintextModeStillLoadsTheKey() throws Exception {
        writeStoredSettings(SAMPLE_KEY, KeyStorageMode.PLAINTEXT.name());

        OpenCloudSettings settings = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());

        assertTrue(settings.isConfigured());
        assertEquals(SAMPLE_KEY, settings.apiKey());
    }

    // ---- cross-mode reload: a data dir that moves between platforms ------------------------

    /**
     * The "carried away from Windows" direction: a data dir written on Windows, opened where DPAPI
     * does not exist. The DPAPI backend is a native call; where it is unavailable it fails with a
     * {@link LinkageError} — {@code NoClassDefFoundError} when the JNA jar is absent,
     * {@code ExceptionInInitializerError} on Linux/macOS where {@code Native.load("Crypt32")} throws
     * — and an Error is not an exception, so it used to escape the store's constructor and take
     * app startup down with it ({@code AppContext} builds this store eagerly).
     *
     * <p>Simulated by reloading the store in a classloader that cannot see JNA, which is exactly what
     * the classpath looks like off-Windows. The honest outcome is the one every other undecodable
     * value already gets: not configured, and never the at-rest value handed back as a key.
     */
    @Test
    void aDpapiKeyIsNotConfiguredWhereTheDpapiBackendIsUnavailable() throws Exception {
        writeStoredSettings(CIPHERTEXT_SHAPED, KeyStorageMode.DPAPI_WINDOWS.name());
        URL classes = OpenCloudSettings.class.getProtectionDomain().getCodeSource().getLocation();
        assumeTrue(classes != null, "needs a locatable code source to build an isolated classloader");

        try (URLClassLoader withoutJna =
                     new URLClassLoader("no-jna", new URL[] {classes}, ClassLoader.getPlatformClassLoader())) {
            Class<?> storeClass = withoutJna.loadClass(OpenCloudSettings.class.getName());
            Object store = storeClass.getConstructor(Path.class).newInstance(dir);

            assertEquals(false, storeClass.getMethod("isConfigured").invoke(store),
                    "an undecodable key must degrade to not configured, not crash the app");
            assertEquals("", storeClass.getMethod("apiKey").invoke(store),
                    "ciphertext must never be handed out as the key");
        }
    }

    /**
     * The "carried onto Windows" direction: a key saved as plaintext elsewhere still loads on
     * Windows, and the label keeps telling the truth — the key on disk is <em>not</em> encrypted,
     * even though this OS could encrypt one. Reporting DPAPI here would claim protection that was
     * never applied to the stored value.
     */
    @Test
    @EnabledOnOs(OS.WINDOWS)
    void aPlaintextSavedKeyLoadsOnWindowsAndStillReportsItIsNotEncrypted() throws Exception {
        writeStoredSettings(SAMPLE_KEY, KeyStorageMode.PLAINTEXT.name());

        OpenCloudSettings reloaded = new OpenCloudSettings(dir); // default protector = DPAPI here

        assertTrue(reloaded.isConfigured());
        assertEquals(SAMPLE_KEY, reloaded.apiKey());
        assertEquals(KeyStorageMode.PLAINTEXT, reloaded.storageMode(),
                "the stored key's own mode wins over what this OS could have applied");
        assertEquals("not encrypted on this OS", reloaded.storageMode().label());
        assertEquals(SAMPLE_KEY, rawApiKeyProperty(dir), "loading must not silently rewrite the file");
    }

    /** Re-saving that carried-in key on Windows is what actually upgrades it to encrypted at rest. */
    @Test
    @EnabledOnOs(OS.WINDOWS)
    void resavingAPlaintextKeyOnWindowsUpgradesItToEncryptedAtRest() throws Exception {
        writeStoredSettings(SAMPLE_KEY, KeyStorageMode.PLAINTEXT.name());

        OpenCloudSettings reloaded = new OpenCloudSettings(dir);
        reloaded.save(SAMPLE_KEY);

        assertEquals(KeyStorageMode.DPAPI_WINDOWS, reloaded.storageMode());
        assertEquals("encrypted (Windows DPAPI)", reloaded.storageMode().label());
        assertNotEquals(SAMPLE_KEY, rawApiKeyProperty(dir), "the re-saved key must be ciphertext");
        assertEquals(SAMPLE_KEY, new OpenCloudSettings(dir).apiKey());
    }

    /**
     * A DPAPI-written key opened through a store whose own protector is the plaintext fallback: the
     * <em>stored</em> mode decides how the value is decoded and what the label says, not the
     * protector this store would use for a new key.
     */
    @Test
    @EnabledOnOs(OS.WINDOWS)
    void aDpapiSavedKeyIsDecodedByItsStoredModeNotTheStoresOwnProtector() {
        new OpenCloudSettings(dir).save(SAMPLE_KEY); // written with DPAPI

        OpenCloudSettings reloaded = new OpenCloudSettings(dir, new PlaintextApiKeyProtector());

        assertTrue(reloaded.isConfigured());
        assertEquals(SAMPLE_KEY, reloaded.apiKey());
        assertEquals(KeyStorageMode.DPAPI_WINDOWS, reloaded.storageMode(),
                "the label must describe how the stored key is actually protected");
    }

    // ---- Windows DPAPI path: encryption-at-rest, real native round-trip --------------------

    /**
     * The full-fidelity version of the regression above, with real DPAPI ciphertext: if the mode
     * label is lost, the ciphertext must not come back as the key.
     */
    @Test
    @EnabledOnOs(OS.WINDOWS)
    void realDpapiCiphertextWithoutItsModeLabelIsNeverReadBackAsAKey() throws Exception {
        new OpenCloudSettings(dir).save(SAMPLE_KEY);
        String ciphertext = rawApiKeyProperty(dir);
        writeStoredSettings(ciphertext, null); // the label is gone; the ciphertext is not

        OpenCloudSettings reloaded = new OpenCloudSettings(dir);

        assertFalse(reloaded.isConfigured(), "unlabeled ciphertext must degrade to not configured");
        assertEquals("", reloaded.apiKey());
        assertNotEquals(ciphertext, reloaded.apiKey(),
                "ciphertext must never be handed to Open Cloud as an x-api-key");
    }

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

    /** Hand-write the at-rest file, so a hand-edited / truncated / foreign settings file can be pinned. */
    private void writeStoredSettings(String storedKey, String storageMode) throws Exception {
        Properties props = new Properties();
        props.setProperty("apiKey", storedKey);
        if (storageMode != null) {
            props.setProperty("storageMode", storageMode);
        }
        try (OutputStream out = Files.newOutputStream(dir.resolve("opencloud.properties"))) {
            props.store(out, "test fixture");
        }
    }

    private static String rawApiKeyProperty(Path dir) throws Exception {
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(dir.resolve("opencloud.properties"))) {
            props.load(in);
        }
        return props.getProperty("apiKey", "");
    }
}
