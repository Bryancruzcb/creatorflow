package creatorflow.service.opencloud;

import java.util.Locale;

/**
 * Encodes an API key into (and back out of) its at-rest form. Each implementation declares a
 * {@link KeyStorageMode}; the concrete choice depends on what the OS can enforce.
 *
 * <p>Public as of Phase E, and the reason is worth stating: the team provenance store's API key
 * ({@code creatorflow.service.team.TeamSettings}) is the same class of secret as the Open Cloud
 * one, so it reuses this rather than growing a second, weaker at-rest story beside it. The
 * <em>implementations</em> stay package-private — callers get one through
 * {@link #forCurrentOs()} or {@link #forMode(KeyStorageMode)} and never pick a backend directly,
 * which is what keeps "how a key is protected" a single decision.
 *
 * <p>Tests in this package inject a specific protector to exercise the plaintext fallback path on
 * any OS.
 */
public interface ApiKeyProtector {

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
