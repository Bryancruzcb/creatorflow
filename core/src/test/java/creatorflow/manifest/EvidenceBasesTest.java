package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Full truth table for the {@link EvidenceBases} classifier — the single source of truth. */
class EvidenceBasesTest {

    @Test
    void verificationIsAlwaysVerifiedRegardlessOfTheFingerprintOutcome() {
        for (VerificationStatus status : VerificationStatus.values()) {
            AssetEntry asset = asset(status, SourceEvidence.unresolved(), ReleaseDecision.PENDING);
            assertEquals(EvidenceBasis.VERIFIED, EvidenceBases.of(asset).verification(),
                    "verification must be VERIFIED for " + status);
        }
    }

    @Test
    void sourceIsDeclaredWhenResolvedAndNotVerifiedWhenUnresolved() {
        AssetEntry resolved = asset(VerificationStatus.CLEAR, resolvedSource(), ReleaseDecision.PENDING);
        assertEquals(EvidenceBasis.DECLARED, EvidenceBases.of(resolved).source());

        AssetEntry unresolved = asset(VerificationStatus.CLEAR, SourceEvidence.unresolved(), ReleaseDecision.PENDING);
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(unresolved).source());

        // Partial evidence (only one of source/license) is still unresolved, not merely "pending".
        AssetEntry partial = asset(VerificationStatus.CLEAR,
                new SourceEvidence("Studio archive", null, null), ReleaseDecision.PENDING);
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(partial).source());
    }

    @Test
    void decisionIsAbsentWhenPendingAndDeclaredForEveryHumanDecisionType() {
        AssetEntry pending = asset(VerificationStatus.CLEAR, resolvedSource(), ReleaseDecision.PENDING);
        assertNull(EvidenceBases.of(pending).decision(), "no decision yet must be absent, not a basis");

        for (ReleaseDecision decision : ReleaseDecision.values()) {
            if (decision == ReleaseDecision.PENDING) continue;
            AssetEntry asset = asset(VerificationStatus.CLEAR, resolvedSource(), decision);
            assertEquals(EvidenceBasis.DECLARED, EvidenceBases.of(asset).decision(),
                    "decision must be DECLARED for " + decision);
        }
    }

    @Test
    void ownershipIsAlwaysNotVerifiedNoMatterWhatElseIsTrueOfTheAsset() {
        AssetEntry best = asset(VerificationStatus.CLEAR, resolvedSource(), ReleaseDecision.APPROVED);
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(best).ownership());

        AssetEntry worst = asset(VerificationStatus.DUPLICATE, SourceEvidence.unresolved(), ReleaseDecision.PENDING);
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(worst).ownership());
    }

    @Test
    void fullCrossProductOfVerificationSourceAndDecisionMatchesTheDocumentedRules() {
        for (VerificationStatus verification : VerificationStatus.values()) {
            for (boolean sourceResolved : new boolean[] {true, false}) {
                for (ReleaseDecision decision : ReleaseDecision.values()) {
                    SourceEvidence source = sourceResolved ? resolvedSource() : SourceEvidence.unresolved();
                    AssetEntry entry = asset(verification, source, decision);
                    EvidenceBases bases = EvidenceBases.of(entry);

                    assertEquals(EvidenceBasis.VERIFIED, bases.verification());
                    assertEquals(sourceResolved ? EvidenceBasis.DECLARED : EvidenceBasis.NOT_VERIFIED, bases.source());
                    assertEquals(decision == ReleaseDecision.PENDING ? null : EvidenceBasis.DECLARED, bases.decision());
                    assertEquals(EvidenceBasis.NOT_VERIFIED, bases.ownership());
                }
            }
        }
    }

    @Test
    void rejectsANullAsset() {
        assertThrows(NullPointerException.class, () -> EvidenceBases.of(null));
    }

    @Test
    void rejectsNullVerificationSourceOrOwnershipButAllowsANullDecision() {
        assertThrows(NullPointerException.class,
                () -> new EvidenceBases(null, EvidenceBasis.DECLARED, null, EvidenceBasis.NOT_VERIFIED));
        assertThrows(NullPointerException.class,
                () -> new EvidenceBases(EvidenceBasis.VERIFIED, null, null, EvidenceBasis.NOT_VERIFIED));
        assertThrows(NullPointerException.class,
                () -> new EvidenceBases(EvidenceBasis.VERIFIED, EvidenceBasis.DECLARED, null, null));

        EvidenceBases withoutDecision =
                new EvidenceBases(EvidenceBasis.VERIFIED, EvidenceBasis.DECLARED, null, EvidenceBasis.NOT_VERIFIED);
        assertNull(withoutDecision.decision());
    }

    private static SourceEvidence resolvedSource() {
        return new SourceEvidence("Studio archive", "Owned", "https://example.test/evidence");
    }

    private static AssetEntry asset(VerificationStatus verification, SourceEvidence source,
                                    ReleaseDecision decision) {
        return new AssetEntry("art/hero.png", "hero.png", "png", 10, "a".repeat(64), 0, 0,
                new Fingerprints(null, null, null), verification, source, decision, List.of(), List.of());
    }
}
