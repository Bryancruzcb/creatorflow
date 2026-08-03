package creatorflow.ui.pages;

import creatorflow.service.opencloud.KeyStorageMode;

/**
 * Every sentence the Settings page's team provenance card can put on screen, as pure functions of
 * the facts behind them. Extracted from {@link SettingsPage} the same way {@link OpenCloudCardText}
 * was, so the wording can be tested without a JavaFX harness — the card itself is only wiring.
 *
 * <p>These strings are where Phase E's honesty invariants become visible to a person, so they are
 * held to them here:
 * <ul>
 *   <li><strong>Never "unshares".</strong> Retract removes a claim from future lookups. It cannot
 *       recall a copy a teammate already read, and saying otherwise would promise something no
 *       server can do.</li>
 *   <li><strong>Never "original" or "unique".</strong> A store with no matching record found a
 *       <em>record</em>, not an origin.</li>
 *   <li>The at-rest line always repeats the {@link KeyStorageMode}'s own label, so the UI can
 *       never imply a protection the OS did not apply.</li>
 *   <li>One account each. A shared account makes every claim read "(you)" and collapses the
 *       attribution the whole feature is for.</li>
 * </ul>
 *
 * <p>No method takes the API key — every message here is derived from booleans, names and enums.
 */
final class TeamCardText {

    /** The card's standing promise, shown whether or not anything is configured. */
    static final String OPTIONAL = "CreatorFlow works fully without any of this. Nothing is ever "
            + "uploaded automatically — you share one snapshot at a time, on purpose.";

    static final String NOT_CONFIGURED =
            "Not configured — provenance lookups are unavailable, which reads as unknown, never as "
                    + "\"no one else has this\".";

    static final String SAVE_BEFORE_TESTING = "Enter a server URL first, then test the connection.";

    static final String ONE_ACCOUNT_EACH =
            "One account per person. A shared account makes every claim read \"(you)\" and loses "
                    + "the attribution this is for.";

    /** Shown next to a freshly minted join code. */
    static final String CODE_SHOWN_ONCE =
            "Copy it now — the server stored only its hash, so this is the only time it can be read. "
                    + "Single-use, expires in 24 hours.";

    private TeamCardText() {
    }

    static String storageLine(KeyStorageMode mode) {
        return "Key storage: " + mode.label() + ".";
    }

    static String connectionMessage(boolean reachable, String baseUrl) {
        return reachable
                ? "Server reachable. That says the store is up — nothing about any animation."
                : "Could not reach " + baseUrl.strip() + " — is the server running?";
    }

    static String accountCreated(String username) {
        return "Account “" + username + "” created — key saved. " + ONE_ACCOUNT_EACH;
    }

    static String accountFailed(String reason) {
        return "Could not create the account: " + reason;
    }

    /** What is configured right now, in the order a second team member needs it. */
    static String configurationStatus(boolean hasAccount, String teamName) {
        if (!hasAccount) return NOT_CONFIGURED;
        if (teamName == null || teamName.isBlank()) {
            return "Signed in — now join a team with a code, or create one.";
        }
        return "Connected to “" + teamName + "”. Lookups on the comparison view are live; nothing "
                + "is cached on this machine.";
    }

    static String joinedTeam(String teamName) {
        return "Joined “" + teamName + "”. Your teammates' claims are looked up live, per comparison.";
    }

    static String createdTeam(String teamName) {
        return "Created “" + teamName + "” — you are its owner. Mint a join code to bring someone in.";
    }

    static String failed(String action, String reason) {
        return "Could not " + action + ": " + reason;
    }
}
