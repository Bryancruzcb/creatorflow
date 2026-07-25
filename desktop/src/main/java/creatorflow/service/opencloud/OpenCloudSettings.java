package creatorflow.service.opencloud;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.Properties;

/**
 * Opt-in Roblox Open Cloud API key, persisted to {@code opencloud.properties} in the data dir.
 * Mirrors {@link creatorflow.service.registry.RegistrySettings} for {@code isConfigured()}/save,
 * but the key is a higher-privilege secret, so it is protected at rest:
 *
 * <ul>
 *   <li>On Windows the key is DPAPI-encrypted ({@link KeyStorageMode#DPAPI_WINDOWS}) — base64
 *       ciphertext bound to the current user account.</li>
 *   <li>Elsewhere it falls back to {@link KeyStorageMode#PLAINTEXT}, and {@link #storageMode()}
 *       reports that plainly so the UI never implies protection the OS didn't apply.</li>
 * </ul>
 *
 * <p>The mode used to write a key is persisted next to it, so a reload decodes it correctly even
 * if it was saved under a different mode. That label is load-bearing: if it is missing or not one
 * this build recognizes, the stored value is <em>undecodable</em> and the store reports itself as
 * not configured. It is never assumed to be plaintext — doing so would hand DPAPI ciphertext out as
 * the key and send it to Roblox as an {@code x-api-key}. The key itself never appears in
 * {@link #toString()}, logs, or exceptions.
 */
public final class OpenCloudSettings {

    private static final String KEY_PROPERTY = "apiKey";
    private static final String MODE_PROPERTY = "storageMode";

    private final Path file;
    private final ApiKeyProtector protector;
    private String apiKey = "";
    private KeyStorageMode mode;

    /** Production entry point: pick the protector the current OS can back. */
    public OpenCloudSettings(Path dataDir) {
        this(dataDir, ApiKeyProtector.forCurrentOs());
    }

    /** Test seam: force a protector so the plaintext fallback can be exercised on any OS. */
    OpenCloudSettings(Path dataDir, ApiKeyProtector protector) {
        this.file = dataDir.resolve("opencloud.properties");
        this.protector = protector;
        this.mode = protector.mode();
        load();
    }

    private void load() {
        if (!Files.exists(file)) {
            return;
        }
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            props.load(in);
            String stored = props.getProperty(KEY_PROPERTY, "").strip();
            if (stored.isBlank()) {
                return;
            }
            Optional<KeyStorageMode> storedMode = KeyStorageMode.fromId(props.getProperty(MODE_PROPERTY, ""));
            if (storedMode.isEmpty()) {
                // A stored value whose protection mode is missing or unrecognized cannot be decoded:
                // we do not know whether it is a key or ciphertext. Guessing PLAINTEXT here would hand
                // DPAPI ciphertext out as apiKey() and send it to Roblox as an x-api-key, so an
                // unlabeled value is "not configured" — the user re-saves the key from Settings.
                return;
            }
            apiKey = ApiKeyProtector.forMode(storedMode.get()).unprotect(stored).strip();
            mode = storedMode.get();
        } catch (IOException | RuntimeException | LinkageError e) {
            // Unreadable or undecryptable settings (e.g. DPAPI ciphertext copied from another
            // user/machine, or a truncated file) mean "not configured"; the user can re-save from
            // Settings. The key, if any, is never surfaced in the swallowed exception.
            //
            // LinkageError is deliberate, not defensive noise: decoding a DPAPI-labeled value calls
            // a native Windows API, so on a platform without it (a data dir carried to Linux/macOS,
            // or a build missing JNA) the failure arrives as an Error — ExceptionInInitializerError
            // from Native.load, or NoClassDefFoundError — which an exception-only catch lets escape
            // the constructor and take app startup down with it. A backend this platform cannot run
            // means the same thing as ciphertext it cannot decrypt: not configured.
            apiKey = "";
        }
    }

    /** Persist the key, protecting it per this platform's {@link #storageMode()}. Blank clears it. */
    public void save(String apiKey) {
        String trimmed = apiKey == null ? "" : apiKey.strip();
        if (trimmed.isBlank()) {
            clear();
            return;
        }
        this.apiKey = trimmed;
        this.mode = protector.mode();
        Properties props = new Properties();
        props.setProperty(KEY_PROPERTY, protector.protect(trimmed));
        props.setProperty(MODE_PROPERTY, protector.mode().name());
        try (OutputStream out = Files.newOutputStream(file)) {
            props.store(out, "CreatorFlow Open Cloud — do not commit; key protected per storageMode");
        } catch (IOException e) {
            throw new IllegalStateException("Could not save Open Cloud settings to " + file, e);
        }
    }

    /** Forget the key and delete its file, leaving no ciphertext behind. */
    public void clear() {
        this.apiKey = "";
        this.mode = protector.mode();
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            throw new IllegalStateException("Could not clear Open Cloud settings at " + file, e);
        }
    }

    public String apiKey() {
        return apiKey;
    }

    public boolean isConfigured() {
        return !apiKey.isBlank();
    }

    /**
     * How the current key is (or a new key would be) protected at rest. Reflects the stored key's
     * mode when one is loaded, otherwise the mode a save would apply on this OS.
     */
    public KeyStorageMode storageMode() {
        return mode;
    }

    @Override
    public String toString() {
        // Deliberately omits the key — this must never leak the secret into logs or diagnostics.
        return "OpenCloudSettings{file=" + file
                + ", configured=" + isConfigured()
                + ", storageMode=" + mode + '}';
    }
}
