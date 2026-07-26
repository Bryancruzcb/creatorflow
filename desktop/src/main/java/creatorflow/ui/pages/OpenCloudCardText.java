package creatorflow.ui.pages;

import creatorflow.service.opencloud.KeyStorageMode;
import creatorflow.service.opencloud.OpenCloudClient;

/**
 * Every sentence the Settings page's Open Cloud card can put on screen, as pure functions of the
 * facts behind them. Extracted from {@link SettingsPage} so the wording can be tested without a
 * JavaFX harness — the card itself is only wiring.
 *
 * <p>These strings are where the honesty invariants become visible to a person, so they are held to
 * them directly:
 * <ul>
 *   <li>The at-rest line always repeats the {@link KeyStorageMode}'s own label, so the UI can never
 *       imply a protection the OS did not apply.</li>
 *   <li>A connectivity probe reports connectivity and key acceptance only. It says nothing about
 *       ownership, rights, or what a later verification will find.</li>
 *   <li>Only an actual rejection (401/403) blames the key. A throttle or an outage must not read as
 *       "your key is bad".</li>
 * </ul>
 *
 * <p>No method takes the key itself — the card's messages are derived from booleans and enums, so
 * there is nothing here that could echo the secret onto the screen.
 */
final class OpenCloudCardText {

    /** Shown after a save that stored nothing, and after an explicit clear. */
    static final String CLEARED = "Cleared — no key stored.";

    /** Shown when "Test connection" is pressed with no key saved yet. */
    static final String SAVE_BEFORE_TESTING = "Save a key first, then test the connection.";

    private OpenCloudCardText() {
    }

    /** The at-rest protection note, always quoting the mode's own honest label. */
    static String storageLine(KeyStorageMode mode) {
        return "Key storage: " + mode.label() + ".";
    }

    /** Whether a key is on file — a capability statement, never a claim about any asset. */
    static String configurationStatus(boolean configured) {
        return configured
                ? "Configured — ownership can be verified for animations with a Roblox id."
                : "Not configured — add a key to verify who owns an animation and its experience.";
    }

    /** The outcome of pressing Save: what is stored now, and how it is protected. */
    static String savedStatus(boolean configured, KeyStorageMode mode) {
        return configured ? "Saved — key stored, " + mode.label() + "." : CLEARED;
    }

    /** Plain-language mapping of a connectivity probe outcome. */
    static String connectionMessage(OpenCloudClient.ConnectionStatus status) {
        return switch (status) {
            case OK -> "Open Cloud reachable — your key is accepted.";
            case KEY_REJECTED -> "Roblox rejected the key. Check the value and that it has asset, "
                    + "universe, and group read scopes.";
            case RATE_LIMITED -> "Rate-limited by Roblox — the key works; wait a moment and try again.";
            case UNREACHABLE -> "Could not reach Roblox Open Cloud. Check your connection and try again.";
        };
    }
}
