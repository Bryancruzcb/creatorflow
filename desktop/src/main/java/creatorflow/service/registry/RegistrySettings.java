package creatorflow.service.registry;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/** Registry connection settings, persisted to {@code registry.properties} in the data dir. */
public final class RegistrySettings {

    private final Path file;
    private String baseUrl = "";
    private String apiKey = "";
    private String username = "";

    public RegistrySettings(Path dataDir) {
        this.file = dataDir.resolve("registry.properties");
        load();
    }

    private void load() {
        if (!Files.exists(file)) {
            return;
        }
        Properties props = new Properties();
        try (InputStream in = Files.newInputStream(file)) {
            props.load(in);
            baseUrl = normalize(props.getProperty("baseUrl", ""));
            apiKey = props.getProperty("apiKey", "").strip();
            username = props.getProperty("username", "").strip();
        } catch (IOException e) {
            // unreadable settings mean "not configured"; the user can re-save from Settings
        }
    }

    public void save(String baseUrl, String apiKey, String username) {
        this.baseUrl = normalize(baseUrl);
        this.apiKey = apiKey == null ? "" : apiKey.strip();
        this.username = username == null ? "" : username.strip();
        Properties props = new Properties();
        props.setProperty("baseUrl", this.baseUrl);
        props.setProperty("apiKey", this.apiKey);
        props.setProperty("username", this.username);
        try (OutputStream out = Files.newOutputStream(file)) {
            props.store(out, "CreatorFlow community registry");
        } catch (IOException e) {
            throw new IllegalStateException("Could not save registry settings to " + file, e);
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

    public boolean isConfigured() {
        return !baseUrl.isBlank() && !apiKey.isBlank();
    }
}
