package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
import java.time.Instant;
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
    void ownershipIsNotVerifiedForAnAssetThatCarriesNoOwnershipEvidence() {
        AssetEntry best = asset(VerificationStatus.CLEAR, resolvedSource(), ReleaseDecision.APPROVED);
        assertNull(best.ownership(), "an asset never verified carries no ownership evidence");
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(best).ownership());

        AssetEntry worst = asset(VerificationStatus.DUPLICATE, SourceEvidence.unresolved(), ReleaseDecision.PENDING);
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(worst).ownership());
    }

    @Test
    void ownershipIsVerifiedOnceFactsWereObtainedWhetherTheOutcomeIsMatchOrMismatch() {
        // VERIFIED = "we obtained authoritative facts from Roblox", which is true for BOTH a MATCH
        // and a MISMATCH — a mismatch is a review lead, not an absence of verification.
        for (OwnershipOutcome obtained : new OwnershipOutcome[] {OwnershipOutcome.MATCH, OwnershipOutcome.MISMATCH}) {
            AssetEntry asset = assetWithOwnership(evidence(obtained));
            assertEquals(EvidenceBasis.VERIFIED, EvidenceBases.of(asset).ownership(),
                    "obtained facts (" + obtained + ") must read as a VERIFIED ownership basis");
        }
    }

    @Test
    void ownershipStaysNotVerifiedWhenTheVerificationCouldNotObtainFacts() {
        AssetEntry unverifiable = assetWithOwnership(OwnershipEvidence.unchecked());
        assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.of(unverifiable).ownership(),
                "UNVERIFIABLE is an honest unknown, never a false VERIFIED");
    }

    /**
     * The ownership-basis truth table, mirrored verbatim by {@code evidenceBasis.test.ts}'s
     * {@code ownershipBasis} parity test so the Java export path and the TS UI never diverge on
     * what an outcome means: the two obtained-fact outcomes are VERIFIED, the unknown is not.
     */
    @Test
    void ownershipBasisTruthTableMatchesTheCrossRuntimeContract() {
        assertEquals(EvidenceBasis.VERIFIED, ownershipBasisFor(OwnershipOutcome.MATCH));
        assertEquals(EvidenceBasis.VERIFIED, ownershipBasisFor(OwnershipOutcome.MISMATCH));
        assertEquals(EvidenceBasis.NOT_VERIFIED, ownershipBasisFor(OwnershipOutcome.UNVERIFIABLE));
        // Absence of any evidence is also NOT_VERIFIED (there is nothing to have verified).
        assertEquals(EvidenceBasis.NOT_VERIFIED,
                EvidenceBases.of(asset(VerificationStatus.CLEAR, resolvedSource(), ReleaseDecision.APPROVED)).ownership());
    }

    private static EvidenceBasis ownershipBasisFor(OwnershipOutcome outcome) {
        return EvidenceBases.of(assetWithOwnership(evidence(outcome))).ownership();
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

    private static AssetEntry assetWithOwnership(OwnershipEvidence ownership) {
        return asset(VerificationStatus.CLEAR, resolvedSource(), ReleaseDecision.APPROVED)
                .withOwnershipEvidence(ownership);
    }

    private static OwnershipEvidence evidence(OwnershipOutcome outcome) {
        return new OwnershipEvidence(507766388L, OwnershipEvidence.TYPE_USER, 1L, "Animation",
                "Approved", OwnershipEvidence.TYPE_USER, 1L, null, outcome,
                Instant.parse("2026-07-23T18:30:00Z"));
    }
}
