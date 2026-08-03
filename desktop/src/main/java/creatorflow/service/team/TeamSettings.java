package creatorflow.service.team;

import creatorflow.service.opencloud.ApiKeyProtector;
import creatorflow.service.opencloud.KeyStorageMode;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.Properties;

/**
 * Connection settings for the team provenance store, persisted to {@code team.properties} in the
 * data dir. Sits beside {@code OpenCloudSettings} in the same house pattern; the legacy
 * {@code service/registry/RegistrySettings} is untouched.
 *
 * <p>The API key is protected at rest by <strong>reusing Phase A's
 * {@link ApiKeyProtector#forCurrentOs()}</strong> — DPAPI on Windows, honestly-labelled plaintext
 * elsewhere — rather than writing a second, weaker story for the same class of secret. The mode is
 * persisted next to the key, and an unrecognized mode means the value is <em>undecodable</em>, so
 * the store reports itself not configured rather than guessing plaintext and handing ciphertext
 * out as a key. Same reasoning as {@code OpenCloudSettings}; the failure it prevents is the same.
 *
 * <p>The key never appears in {@link #toString()}, in a log, or on the local bridge. The bridge
 * reports {@code configured} as a boolean only, following the {@code openCloudKeyConfigured}
 * precedent.
 *
 * <p>{@code teamId} and {@code teamName} are stored here too. That is local <em>configuration</em>
 * — which team this machine talks to — not a cached copy of anyone's claim. Phase E caches no
 * team results: every lookup is live, and an unreachable store renders as unknown.
 */
public final class TeamSettings {

    private static final String BASE_URL_PROPERTY = "baseUrl";
    private static final String KEY_PROPERTY = "apiKey";
    private static final String MODE_PROPERTY = "storageMode";
    private static final String USERNAME_PROPERTY = "username";
    private static final String TEAM_ID_PROPERTY = "teamId";
    private static final String TEAM_NAME_PROPERTY = "teamName";

    private final Path file;
    private final ApiKeyProtector protector;
    private String baseUrl = "";
    private String apiKey = "";
    private String username = "";
    private Long teamId;
    private String teamName = "";
    private KeyStorageMode mode;

    /** Production entry point: pick the protector the current OS can back. */
    public TeamSettings(Path dataDir) {
        this(dataDir, ApiKeyProtector.forCurrentOs());
    }

    /** Test seam: force a protector so the plaintext fallback can be exercised on any OS. */
    public TeamSettings(Path dataDir, ApiKeyProtector protector) {
        this.file = dataDir.resolve("team.properties");
        this.protector = protector;
        this.mode = protector.mode();
        load();
    }

    private void load() {
        if (!Files.exists(file)) return;
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            props.load(in);
            baseUrl = normalize(props.getProperty(BASE_URL_PROPERTY, ""));
            username = props.getProperty(USERNAME_PROPERTY, "").strip();
            teamName = props.getProperty(TEAM_NAME_PROPERTY, "").strip();
            teamId = parseTeamId(props.getProperty(TEAM_ID_PROPERTY, ""));
            String stored = props.getProperty(KEY_PROPERTY, "").strip();
            if (stored.isBlank()) return;
            Optional<KeyStorageMode> storedMode = KeyStorageMode.fromId(props.getProperty(MODE_PROPERTY, ""));
            if (storedMode.isEmpty()) {
                // Unlabelled or unknown mode: the value cannot be decoded, so it is not a key.
                // Guessing PLAINTEXT would send DPAPI ciphertext to the server as an X-Api-Key.
                return;
            }
            // The stored mode picks the decoder, always. When it matches the protector this
            // instance was built with, use that instance — in production it IS the current OS's
            // protector, so this resolves to the same implementation, and it keeps the test seam
            // real rather than something forMode() silently routes around.
            ApiKeyProtector decoder = storedMode.get() == protector.mode()
                    ? protector
                    : ApiKeyProtector.forMode(storedMode.get());
            apiKey = decoder.unprotect(stored).strip();
            mode = storedMode.get();
        } catch (IOException | RuntimeException | LinkageError e) {
            // Unreadable or undecryptable settings mean "not configured"; the user re-saves from
            // Settings. LinkageError is deliberate and not defensive noise: decoding a
            // DPAPI-labelled value calls a native Windows API, so a data dir carried to
            // Linux/macOS fails as an Error, which an exception-only catch would let escape the
            // constructor and take app startup down. The key is never surfaced in the swallowed
            // failure.
            apiKey = "";
        }
    }

    /** Persist the connection. A blank key clears the stored credential but keeps the URL. */
    public void save(String baseUrl, String apiKey, String username) {
        this.baseUrl = normalize(baseUrl);
        this.username = username == null ? "" : username.strip();
        String trimmedKey = apiKey == null ? "" : apiKey.strip();
        this.apiKey = trimmedKey;
        this.mode = protector.mode();
        write();
    }

    /** Records which team this machine talks to. Local configuration, not a cached claim. */
    public void saveTeam(Long teamId, String teamName) {
        this.teamId = teamId;
        this.teamName = teamName == null ? "" : teamName.strip();
        write();
    }

    /** Forget everything and delete the file, leaving no ciphertext behind. */
    public void clear() {
        this.baseUrl = "";
        this.apiKey = "";
        this.username = "";
        this.teamId = null;
        this.teamName = "";
        this.mode = protector.mode();
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            throw new IllegalStateException("Could not clear team settings at " + file, e);
        }
    }

    private void write() {
        Properties props = new Properties();
        props.setProperty(BASE_URL_PROPERTY, baseUrl);
        props.setProperty(USERNAME_PROPERTY, username);
        props.setProperty(TEAM_NAME_PROPERTY, teamName);
        props.setProperty(TEAM_ID_PROPERTY, teamId == null ? "" : Long.toString(teamId));
        if (apiKey.isBlank()) {
            props.setProperty(KEY_PROPERTY, "");
            props.setProperty(MODE_PROPERTY, "");
        } else {
            props.setProperty(KEY_PROPERTY, protector.protect(apiKey));
            props.setProperty(MODE_PROPERTY, protector.mode().name());
        }
        try (OutputStream out = Files.newOutputStream(file)) {
            props.store(out, "CreatorFlow team provenance store — do not commit; key protected per storageMode");
        } catch (IOException e) {
            throw new IllegalStateException("Could not save team settings to " + file, e);
        }
    }

    private static Long parseTeamId(String raw) {
        String trimmed = raw == null ? "" : raw.strip();
        if (trimmed.isEmpty()) return null;
        try {
            long parsed = Long.parseLong(trimmed);
            return parsed > 0 ? parsed : null;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    private static String normalize(String url) {
        String trimmed = url == null ? "" : url.strip();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        return trimmed;
    }

    public String baseUrl() {
        return baseUrl;
    }

    public String apiKey() {
        return apiKey;
    }

    public String username() {
        return username;
    }

    public Long teamId() {
        return teamId;
    }

    public String teamName() {
        return teamName;
    }

    /** A base URL, a key, and a selected team. All three, or team lookups cannot run at all. */
    public boolean isConfigured() {
        return !baseUrl.isBlank() && !apiKey.isBlank() && teamId != null;
    }

    /** Whether an account exists on the server, regardless of whether a team is selected yet. */
    public boolean hasAccount() {
        return !baseUrl.isBlank() && !apiKey.isBlank();
    }

    public KeyStorageMode storageMode() {
        return mode;
    }

    @Override
    public String toString() {
        // Deliberately omits the key.
        return "TeamSettings{file=" + file + ", baseUrl=" + baseUrl
                + ", configured=" + isConfigured() + ", storageMode=" + mode + '}';
    }
}
