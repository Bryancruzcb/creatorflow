package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReleaseGateTest {

    @TempDir
    Path dir;

    @Test
    void defaultPolicyDistinguishesClearFlaggedExcludedAndBlockedAssets() {
        CreativeManifest manifest = manifest(List.of(
                asset("clear.png", VerificationStatus.CLEAR, ReleaseDecision.PENDING, true),
                asset("similar.png", VerificationStatus.SIMILAR, ReleaseDecision.NEEDS_REVIEW, true),
                asset("excluded.png", VerificationStatus.DUPLICATE, ReleaseDecision.EXCLUDED, false),
                asset("blocked.png", VerificationStatus.CLEAR, ReleaseDecision.BLOCKED, true)));

        ReleaseGate.Report report = new ReleaseGate(Clock.fixed(
                Instant.parse("2026-07-12T21:00:00Z"), ZoneOffset.UTC)).evaluate(manifest);

        assertFalse(report.passed());
        assertEquals(2, report.violations().size());
        assertEquals(1, report.summary().blockedAssets());
        assertEquals(1, report.summary().flaggedWithoutApproval());
        assertEquals(0, report.summary().unresolvedAssets());
        assertEquals(Instant.parse("2026-07-12T21:00:00Z"), report.evaluatedAt());
    }

    @Test
    void resolvedClearAndApprovedFlaggedAssetsPass() {
        CreativeManifest manifest = manifest(List.of(
                asset("clear.png", VerificationStatus.CLEAR, ReleaseDecision.PENDING, true),
                asset("approved.png", VerificationStatus.SIMILAR, ReleaseDecision.APPROVED, true),
                asset("excluded.png", VerificationStatus.DUPLICATE, ReleaseDecision.EXCLUDED, false)));

        ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);

        assertTrue(report.passed());
        assertTrue(report.violations().isEmpty());
    }

    @Test
    void ownershipMismatchWithoutADecisionBlocksAsAReviewLead() {
        CreativeManifest manifest = manifest(List.of(
                assetWithOwnership("anim.rbxm", ReleaseDecision.PENDING,
                        ownership(OwnershipOutcome.MISMATCH))));

        ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);

        assertFalse(report.passed());
        assertEquals(1, report.violations().size());
        ReleaseGate.Violation violation = report.violations().get(0);
        assertEquals(ReleaseGate.Code.OWNERSHIP_MISMATCH_WITHOUT_DECISION, violation.code());
        assertEquals(1, report.summary().ownershipMismatchWithoutDecision());

        assertNoAccusation(violation.message());
        // ...but it must clearly prompt a human to record a decision.
        String message = violation.message().toLowerCase(Locale.ROOT);
        assertTrue(message.contains("no decision"), "message must surface the missing decision");
        assertTrue(message.contains("confirm"), "message must prompt a human confirmation");
        // ...and it must not present the file-to-animation link as CreatorFlow's own finding: the
        // animation id was typed in by a person, and the lead is only as good as that declaration.
        assertTrue(message.contains("entered"), "message must say the animation id was entered by a person");
    }

    /**
     * "Needs review" is a human saying review has NOT happened yet. It must not silence the lead —
     * otherwise a release passes carrying an ownership mismatch nobody ever looked at.
     */
    @Test
    void ownershipMismatchStillBlocksWhenTheOnlyDecisionRecordedIsNeedsReview() {
        CreativeManifest manifest = manifest(List.of(
                assetWithOwnership("anim.rbxm", ReleaseDecision.NEEDS_REVIEW,
                        ownership(OwnershipOutcome.MISMATCH))));

        ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);

        assertFalse(report.passed(), "NEEDS_REVIEW must not clear an ownership mismatch");
        assertEquals(1, report.violations().size());
        ReleaseGate.Violation violation = report.violations().get(0);
        assertEquals(ReleaseGate.Code.OWNERSHIP_MISMATCH_WITHOUT_DECISION, violation.code());
        assertEquals(ReleaseDecision.NEEDS_REVIEW, violation.decision());
        assertEquals(1, report.summary().ownershipMismatchWithoutDecision());

        assertNoAccusation(violation.message());
        String message = violation.message().toLowerCase(Locale.ROOT);
        // The message must stay TRUE for this state: a decision *was* recorded, it just isn't one
        // that resolves the lead. Claiming "no decision has been recorded" here would be a lie.
        assertFalse(message.contains("no decision"),
                "a decision was recorded — the message must not claim otherwise");
        assertTrue(message.contains("needs review"), "message must name the standing state");
        assertTrue(message.contains("confirm"), "message must prompt a human confirmation");
        assertTrue(message.contains("entered"), "message must say the animation id was entered by a person");
    }

    @Test
    void ownershipMismatchIsClearedOnlyByApprovedOrExcluded() {
        CreativeManifest manifest = manifest(List.of(
                assetWithOwnership("approved.rbxm", ReleaseDecision.APPROVED,
                        ownership(OwnershipOutcome.MISMATCH)),
                assetWithOwnership("excluded.rbxm", ReleaseDecision.EXCLUDED,
                        ownership(OwnershipOutcome.MISMATCH))));

        ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);

        assertTrue(report.passed());
        assertTrue(report.violations().isEmpty());
        assertEquals(0, report.summary().ownershipMismatchWithoutDecision());
    }

    @Test
    void matchAndUnverifiableOwnershipNeverBlockWhateverTheDecision() {
        CreativeManifest manifest = manifest(List.of(
                assetWithOwnership("match.rbxm", ReleaseDecision.PENDING,
                        ownership(OwnershipOutcome.MATCH)),
                assetWithOwnership("match-needs-review.rbxm", ReleaseDecision.NEEDS_REVIEW,
                        ownership(OwnershipOutcome.MATCH)),
                assetWithOwnership("unknown.rbxm", ReleaseDecision.PENDING,
                        OwnershipEvidence.unchecked()),
                assetWithOwnership("unknown-needs-review.rbxm", ReleaseDecision.NEEDS_REVIEW,
                        OwnershipEvidence.unchecked())));

        ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);

        assertTrue(report.passed());
        assertTrue(report.violations().isEmpty());
        assertEquals(0, report.summary().ownershipMismatchWithoutDecision());
    }

    /** A mismatch is a review lead, never an accusation of wrongdoing — in every message branch. */
    private static void assertNoAccusation(String raw) {
        String message = raw.toLowerCase(Locale.ROOT);
        assertFalse(message.contains("infring"), "message must not allege infringement");
        assertFalse(message.contains("stolen"), "message must not allege theft");
        assertFalse(message.contains("steal"), "message must not allege theft");
        assertFalse(message.contains("illegal"), "message must not allege illegality");
        assertFalse(message.contains("unauthoriz"), "message must not allege unauthorized use");
    }

    @Test
    void cliReturnsStableExitCodesAndMachineReadableOutput() throws Exception {
        Path blocked = dir.resolve("blocked.json");
        new ManifestJson().write(blocked, manifest(List.of(
                asset("asset.png", VerificationStatus.CLEAR, ReleaseDecision.PENDING, false))));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ByteArrayOutputStream errors = new ByteArrayOutputStream();

        int blockedCode = ReleaseGateCli.run(new String[]{blocked.toString()},
                new PrintStream(output, true, StandardCharsets.UTF_8),
                new PrintStream(errors, true, StandardCharsets.UTF_8));

        assertEquals(2, blockedCode);
        assertTrue(output.toString(StandardCharsets.UTF_8).contains("\"passed\" : false"));

        output.reset();
        Path pass = dir.resolve("pass.json");
        Path report = dir.resolve("reports/gate.json");
        new ManifestJson().write(pass, manifest(List.of(
                asset("asset.png", VerificationStatus.CLEAR, ReleaseDecision.PENDING, true))));
        int passCode = ReleaseGateCli.run(
                new String[]{pass.toString(), "--output", report.toString()},
                new PrintStream(output, true, StandardCharsets.UTF_8),
                new PrintStream(errors, true, StandardCharsets.UTF_8));

        assertEquals(0, passCode);
        assertTrue(Files.readString(report).contains("\"passed\" : true"));

        output.reset();
        Path invalid = dir.resolve("invalid.json");
        Files.writeString(invalid, "not json");
        assertEquals(3, ReleaseGateCli.run(new String[]{invalid.toString()},
                new PrintStream(output, true, StandardCharsets.UTF_8),
                new PrintStream(errors, true, StandardCharsets.UTF_8)));
        assertTrue(output.toString(StandardCharsets.UTF_8).contains("\"exitCode\" : 3"));
    }

    @Test
    void cliAcceptsAV2ManifestWhoseEmbeddedGateMatchesTheRecomputedResult() throws Exception {
        CreativeManifest.Gate correctGate = new CreativeManifest.Gate("PASS", List.of());
        Path pass = dir.resolve("v2-pass.json");
        new ManifestJson().write(pass, manifestV2(List.of(
                asset("asset.png", VerificationStatus.CLEAR, ReleaseDecision.PENDING, true)), correctGate));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ByteArrayOutputStream errors = new ByteArrayOutputStream();

        int code = ReleaseGateCli.run(new String[]{pass.toString()},
                new PrintStream(output, true, StandardCharsets.UTF_8),
                new PrintStream(errors, true, StandardCharsets.UTF_8));

        assertEquals(0, code);
        assertTrue(output.toString(StandardCharsets.UTF_8).contains("\"passed\" : true"));
    }

    /**
     * A manifest exported before Phase A carries no ownership block at all. Tightening the
     * ownership rule must not change how such a manifest recomputes — otherwise every archived
     * v0.2 release would suddenly read as tampered (exit 4).
     */
    @Test
    void cliRecomputesAPrePhaseAV2ManifestWithNoOwnershipBlockIdentically() throws Exception {
        CreativeManifest.Gate embeddedPass = new CreativeManifest.Gate("PASS", List.of());
        Path legacy = dir.resolve("v2-legacy-no-ownership.json");
        new ManifestJson().write(legacy, manifestV2(List.of(
                asset("clear-pending.png", VerificationStatus.CLEAR, ReleaseDecision.PENDING, true),
                asset("clear-needs-review.png", VerificationStatus.CLEAR, ReleaseDecision.NEEDS_REVIEW, true),
                asset("dupe-excluded.png", VerificationStatus.DUPLICATE, ReleaseDecision.EXCLUDED, false)),
                embeddedPass));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ByteArrayOutputStream errors = new ByteArrayOutputStream();

        int code = ReleaseGateCli.run(new String[]{legacy.toString()},
                new PrintStream(output, true, StandardCharsets.UTF_8),
                new PrintStream(errors, true, StandardCharsets.UTF_8));

        String out = output.toString(StandardCharsets.UTF_8);
        assertEquals(0, code, "a pre-Phase-A v0.2 manifest must still recompute to its embedded PASS");
        assertFalse(out.contains("does not match"), "no tamper cross-check failure expected");
        assertTrue(out.contains("\"passed\" : true"));
        assertEquals(0, new ReleaseGate().evaluate(new ManifestJson().read(legacy))
                .summary().ownershipMismatchWithoutDecision());
    }

    @Test
    void cliExitsWithADistinctCodeWhenTheEmbeddedGateIsTamperedOrStale() throws Exception {
        // The asset is BLOCKED (must recompute to BLOCKED), but the embedded gate falsely claims PASS.
        CreativeManifest.Gate tamperedGate = new CreativeManifest.Gate("PASS", List.of());
        Path tampered = dir.resolve("v2-tampered.json");
        new ManifestJson().write(tampered, manifestV2(List.of(
                asset("asset.png", VerificationStatus.CLEAR, ReleaseDecision.BLOCKED, true)), tamperedGate));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ByteArrayOutputStream errors = new ByteArrayOutputStream();

        int code = ReleaseGateCli.run(new String[]{tampered.toString()},
                new PrintStream(output, true, StandardCharsets.UTF_8),
                new PrintStream(errors, true, StandardCharsets.UTF_8));

        assertEquals(4, code);
        String out = output.toString(StandardCharsets.UTF_8);
        assertTrue(out.contains("\"exitCode\" : 4"));
        assertTrue(out.contains("does not match"));
        assertTrue(errors.toString(StandardCharsets.UTF_8).contains("embedded gate"));
    }

    private static CreativeManifest manifestV2(List<AssetEntry> assets, CreativeManifest.Gate gate) {
        int clear = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.CLEAR).count();
        int similar = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.SIMILAR).count();
        int duplicate = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.DUPLICATE).count();
        int unresolved = (int) assets.stream().filter(a -> !a.source().resolved()).count();
        int pending = (int) assets.stream().filter(a -> a.decision() == ReleaseDecision.PENDING).count();
        return new CreativeManifest(CreativeManifest.SCHEMA_V2,
                new CreativeManifest.Project("Gate test", "1.0"),
                Instant.parse("2026-07-12T20:00:00Z"),
                new CreativeManifest.Summary(assets.size(), clear, similar, duplicate, unresolved, pending),
                assets, null, gate);
    }

    private static AssetEntry asset(String path, VerificationStatus verification,
                                    ReleaseDecision decision, boolean sourceResolved) {
        SourceEvidence source = sourceResolved
                ? new SourceEvidence("Studio archive", "Owned", "https://example.test/evidence/" + path)
                : SourceEvidence.unresolved();
        return new AssetEntry(path, path, "png", 1,
                "a".repeat(64), 1, 1, new Fingerprints(null, null, null), verification,
                source, decision, List.of(), List.of());
    }

    /** A CLEAR, source-resolved animation asset carrying a persisted ownership observation. */
    private static AssetEntry assetWithOwnership(String path, ReleaseDecision decision,
                                                 OwnershipEvidence ownership) {
        return new AssetEntry(path, path, "rbxm", 1, "a".repeat(64), 1, 1,
                new Fingerprints(null, null, null), VerificationStatus.CLEAR,
                new SourceEvidence("Studio archive", "Owned", "https://example.test/evidence/" + path),
                decision, List.of(), List.of(), null, ownership);
    }

    private static OwnershipEvidence ownership(OwnershipOutcome outcome) {
        long creatorId = 100L;
        long ownerId = outcome == OwnershipOutcome.MATCH ? 100L : 200L;
        return new OwnershipEvidence(1234L, "USER", creatorId, "Animation", "Approved",
                "USER", ownerId, null, outcome, Instant.parse("2026-07-20T00:00:00Z"));
    }

    private static CreativeManifest manifest(List<AssetEntry> assets) {
        int clear = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.CLEAR).count();
        int similar = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.SIMILAR).count();
        int duplicate = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.DUPLICATE).count();
        int unresolved = (int) assets.stream().filter(a -> !a.source().resolved()).count();
        int pending = (int) assets.stream().filter(a -> a.decision() == ReleaseDecision.PENDING).count();
        return new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("Gate test", "1.0"),
                Instant.parse("2026-07-12T20:00:00Z"),
                new CreativeManifest.Summary(assets.size(), clear, similar, duplicate, unresolved, pending),
                assets);
    }
}
