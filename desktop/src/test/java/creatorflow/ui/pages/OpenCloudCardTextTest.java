package creatorflow.ui.pages;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.service.opencloud.KeyStorageMode;
import creatorflow.service.opencloud.OpenCloudClient.ConnectionStatus;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The Settings page's Open Cloud card is JavaFX wiring around {@link OpenCloudCardText}; the
 * sentences are what a person actually reads, so they are pinned here. The codebase has no JavaFX
 * test harness and this suite deliberately does not add one — every assertion below is on a pure
 * function of a boolean or an enum.
 *
 * <p>The tests are written against the honesty invariants rather than the exact prose: a connection
 * probe may report connectivity and key acceptance and nothing else, only a real rejection may
 * blame the key, and the at-rest note must always repeat the storage mode's own label.
 */
class OpenCloudCardTextTest {

    // ---- storage-mode label -----------------------------------------------------------------

    @Test
    void everyStorageModeLineQuotesThatModesOwnLabel() {
        for (KeyStorageMode mode : KeyStorageMode.values()) {
            String line = OpenCloudCardText.storageLine(mode);
            assertTrue(line.contains(mode.label()),
                    "the at-rest note must repeat the mode's own label, not paraphrase it: " + line);
        }
    }

    @Test
    void theFallbackStorageLineSaysTheKeyIsNotEncrypted() {
        String line = OpenCloudCardText.storageLine(KeyStorageMode.PLAINTEXT);

        assertEquals("Key storage: not encrypted on this OS.", line);
        assertTrue(line.contains("not encrypted"),
                "the fallback must state plainly that no protection was applied");
    }

    @Test
    void theWindowsStorageLineNamesTheProtectionThatWasActuallyApplied() {
        assertEquals("Key storage: encrypted (Windows DPAPI).",
                OpenCloudCardText.storageLine(KeyStorageMode.DPAPI_WINDOWS));
    }

    @Test
    void theTwoStorageLinesAreNotInterchangeable() {
        assertNotEquals(OpenCloudCardText.storageLine(KeyStorageMode.PLAINTEXT),
                OpenCloudCardText.storageLine(KeyStorageMode.DPAPI_WINDOWS),
                "a user must be able to tell an encrypted key from an unencrypted one");
    }

    // ---- configured / not configured --------------------------------------------------------

    @Test
    void theNotConfiguredStatusSaysSoAndSaysWhatToDo() {
        String status = OpenCloudCardText.configurationStatus(false);

        assertTrue(status.startsWith("Not configured"), status);
        assertTrue(status.contains("add a key"), status);
    }

    @Test
    void theConfiguredStatusPromisesOnlyThatVerificationCanRunNotItsOutcome() {
        String status = OpenCloudCardText.configurationStatus(true);

        assertTrue(status.startsWith("Configured"), status);
        assertTrue(status.contains("can be verified"),
                "a saved key enables a check; it is not itself a result: " + status);
        assertFalse(status.toLowerCase(Locale.ROOT).contains("verified that"), status);
    }

    @Test
    void configuredAndNotConfiguredNeverReadTheSame() {
        assertNotEquals(OpenCloudCardText.configurationStatus(true),
                OpenCloudCardText.configurationStatus(false));
    }

    // ---- save / clear -----------------------------------------------------------------------

    @Test
    void theSavedMessageNamesTheProtectionActuallyAppliedToThisKey() {
        assertEquals("Saved — key stored, not encrypted on this OS.",
                OpenCloudCardText.savedStatus(true, KeyStorageMode.PLAINTEXT));
        assertEquals("Saved — key stored, encrypted (Windows DPAPI).",
                OpenCloudCardText.savedStatus(true, KeyStorageMode.DPAPI_WINDOWS));
    }

    @Test
    void savingABlankKeyReportsAClearedStoreUnderEveryMode() {
        for (KeyStorageMode mode : KeyStorageMode.values()) {
            assertEquals(OpenCloudCardText.CLEARED, OpenCloudCardText.savedStatus(false, mode),
                    "nothing was stored, so no mode may be claimed for it");
            assertFalse(OpenCloudCardText.savedStatus(false, mode).contains(mode.label()),
                    "an empty store has no at-rest protection to describe");
        }
    }

    @Test
    void theClearedMessageSaysNoKeyIsStored() {
        assertEquals("Cleared — no key stored.", OpenCloudCardText.CLEARED);
    }

    // ---- test-connection results ------------------------------------------------------------

    @Test
    void everyConnectionOutcomeHasItsOwnNonBlankMessage() {
        Set<String> seen = new HashSet<>();
        for (ConnectionStatus status : ConnectionStatus.values()) {
            String message = OpenCloudCardText.connectionMessage(status);
            assertFalse(message == null || message.isBlank(), "no outcome may render as silence: " + status);
            assertTrue(seen.add(message), "two outcomes must not read identically: " + status);
        }
    }

    @Test
    void aSuccessfulProbeClaimsConnectivityAndNothingAboutOwnership() {
        String message = OpenCloudCardText.connectionMessage(ConnectionStatus.OK).toLowerCase(Locale.ROOT);

        assertTrue(message.contains("accepted"), message);
        // The probe reads one public ROBLOX asset. It proves the key works — not that the user owns
        // anything, and not that any later check will come back VERIFIED.
        assertFalse(message.contains("own"), "a connectivity probe says nothing about ownership: " + message);
        assertFalse(message.contains("rights"), message);
        assertFalse(message.contains("verified"), message);
    }

    @Test
    void onlyAnActualRejectionBlamesTheKey() {
        assertTrue(OpenCloudCardText.connectionMessage(ConnectionStatus.KEY_REJECTED)
                .toLowerCase(Locale.ROOT).contains("rejected the key"));

        String throttled = OpenCloudCardText.connectionMessage(ConnectionStatus.RATE_LIMITED)
                .toLowerCase(Locale.ROOT);
        assertTrue(throttled.contains("the key works"),
                "a throttle is transient and must not read as a bad key: " + throttled);
        assertFalse(throttled.contains("rejected"), throttled);

        String unreachable = OpenCloudCardText.connectionMessage(ConnectionStatus.UNREACHABLE)
                .toLowerCase(Locale.ROOT);
        assertFalse(unreachable.contains("key"),
                "an outage teaches nothing about the key, so it must not mention it: " + unreachable);
        assertTrue(unreachable.contains("could not reach"), unreachable);
    }

    @Test
    void testingWithoutASavedKeyAsksForOneInsteadOfReportingAResult() {
        assertEquals("Save a key first, then test the connection.", OpenCloudCardText.SAVE_BEFORE_TESTING);
        for (ConnectionStatus status : ConnectionStatus.values()) {
            assertNotEquals(OpenCloudCardText.connectionMessage(status), OpenCloudCardText.SAVE_BEFORE_TESTING,
                    "a probe that never ran must not borrow a probe outcome's wording");
        }
    }
}
