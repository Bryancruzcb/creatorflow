package creatorflow.service.opencloud;

import java.util.Locale;

/**
 * Encodes an Open Cloud API key into (and back out of) its at-rest form. Each implementation
 * declares a {@link KeyStorageMode}; the concrete choice depends on what the OS can enforce.
 *
 * <p>Kept package-private on purpose: only {@link OpenCloudSettings} decides how a key is
 * protected, and tests in this package inject a specific protector to exercise the fallback path
 * on any OS.
 */
interface ApiKeyProtector {

    /** The at-rest protection this protector applies. */
    KeyStorageMode mode();

    /** Encode a plaintext key into the string written to disk (base64 ciphertext, or plaintext). */
    String protect(String plaintext);

    /** Decode an at-rest string produced by {@link #protect(String)} back to the plaintext key. */
    String unprotect(String stored);

    /** The protector matching this platform's capabilities: DPAPI on Windows, plaintext elsewhere. */
    static ApiKeyProtector forCurrentOs() {
        return isWindows() ? new DpapiApiKeyProtector() : new PlaintextApiKeyProtector();
    }

    /** The protector that can decode a key previously written under {@code mode}. */
    static ApiKeyProtector forMode(KeyStorageMode mode) {
        return mode == KeyStorageMode.DPAPI_WINDOWS
                ? new DpapiApiKeyProtector()
                : new PlaintextApiKeyProtector();
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}
