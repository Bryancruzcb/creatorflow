package creatorflow.service.team;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.service.opencloud.ApiKeyProtector;
import creatorflow.service.opencloud.KeyStorageMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The team store's at-rest behaviour, exercised through a forced protector so the same assertions
 * hold on any OS.
 *
 * <p>The important case is the last one: a stored value whose protection mode is missing or
 * unrecognized is <em>undecodable</em>, so the store reports itself not configured. Guessing
 * PLAINTEXT there would hand DPAPI ciphertext out as the API key and send it to the server
 * verbatim — the same failure {@code OpenCloudSettings} was built to avoid, and the reason this
 * reuses that machinery instead of writing a second, weaker one.
 */
class TeamSettingsTest {

    @TempDir
    Path directory;

    /** A protector that visibly transforms the key, so a decode failure cannot pass unnoticed. */
    private static final class ReversingProtector implements ApiKeyProtector {
        @Override
        public KeyStorageMode mode() {
            return KeyStorageMode.DPAPI_WINDOWS;
        }

        @Override
        public String protect(String plaintext) {
            return new StringBuilder(plaintext).reverse().toString();
        }

        @Override
        public String unprotect(String stored) {
            return new StringBuilder(stored).reverse().toString();
        }
    }

    @Test
    void nothingIsConfiguredOnAFreshDataDir() {
        TeamSettings settings = new TeamSettings(directory, new ReversingProtector());
        assertFalse(settings.isConfigured());
        assertFalse(settings.hasAccount());
        assertNull(settings.teamId());
        assertEquals("", settings.apiKey());
    }

    @Test
    void aUrlAndKeyAreNotEnoughWithoutASelectedTeam() {
        TeamSettings settings = new TeamSettings(directory, new ReversingProtector());
        settings.save("http://team.example:8080/", "secret-key", "mira");

        assertTrue(settings.hasAccount());
        assertFalse(settings.isConfigured(), "a lookup needs a team to scope it");
        assertEquals("http://team.example:8080", settings.baseUrl(), "trailing slash is normalized away");

        settings.saveTeam(7L, "Harbor Studio");
        assertTrue(settings.isConfigured());
    }

    @Test
    void theKeyIsNotStoredInPlaintextAndSurvivesAReload() throws Exception {
        TeamSettings settings = new TeamSettings(directory, new ReversingProtector());
        settings.save("http://team.example:8080", "secret-key", "mira");
        settings.saveTeam(7L, "Harbor Studio");

        String onDisk = Files.readString(directory.resolve("team.properties"));
        assertFalse(onDisk.contains("secret-key"), "the key was written in plaintext");

        TeamSettings reloaded = new TeamSettings(directory, new ReversingProtector());
        assertEquals("secret-key", reloaded.apiKey());
        assertEquals(7L, reloaded.teamId());
        assertEquals("Harbor Studio", reloaded.teamName());
        assertEquals("mira", reloaded.username());
    }

    @Test
    void anUnlabelledStoredValueIsUndecodableRatherThanAssumedPlaintext() throws Exception {
        Properties props = new Properties();
        props.setProperty("baseUrl", "http://team.example:8080");
        props.setProperty("teamId", "7");
        props.setProperty("apiKey", "yek-terces");
        // storageMode deliberately absent: this file could have been written by anything.
        try (var out = Files.newOutputStream(directory.resolve("team.properties"))) {
            props.store(out, "hand-written");
        }

        TeamSettings settings = new TeamSettings(directory, new ReversingProtector());
        assertEquals("", settings.apiKey(),
                "an unlabelled value must never be handed out as a key — it might be ciphertext");
        assertFalse(settings.isConfigured());
        // The non-secret half still loads: the user only has to re-save the key.
        assertEquals("http://team.example:8080", settings.baseUrl());
    }

    @Test
    void clearingLeavesNoFileAndNoCiphertext() {
        TeamSettings settings = new TeamSettings(directory, new ReversingProtector());
        settings.save("http://team.example:8080", "secret-key", "mira");
        settings.saveTeam(7L, "Harbor Studio");

        settings.clear();
        assertFalse(Files.exists(directory.resolve("team.properties")));
        assertFalse(settings.isConfigured());
        assertNull(settings.teamId());
    }

    @Test
    void toStringNeverCarriesTheKey() {
        TeamSettings settings = new TeamSettings(directory, new ReversingProtector());
        settings.save("http://team.example:8080", "secret-key", "mira");
        assertFalse(settings.toString().contains("secret-key"));
    }
}
