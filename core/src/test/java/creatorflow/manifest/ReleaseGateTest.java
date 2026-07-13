package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
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

    private static AssetEntry asset(String path, VerificationStatus verification,
                                    ReleaseDecision decision, boolean sourceResolved) {
        SourceEvidence source = sourceResolved
                ? new SourceEvidence("Studio archive", "Owned", "https://example.test/evidence/" + path)
                : SourceEvidence.unresolved();
        return new AssetEntry(path, path, "png", 1,
                "a".repeat(64), 1, 1, new Fingerprints(null, null, null), verification,
                source, decision, List.of(), List.of());
    }

    private static CreativeManifest manifest(List<AssetEntry> assets) {
        int clear = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.CLEAR).count();
        int similar = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.SIMILAR).count();
        int duplicate = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.DUPLICATE).count();
        int unresolved = (int) assets.stream().filter(a -> !a.source().resolved()).count();
        int pending = (int) assets.stream().filter(a -> a.decision() == ReleaseDecision.PENDING).count();
        return new CreativeManifest(CreativeManifest.SCHEMA,
                new CreativeManifest.Project("Gate test", "1.0"),
                Instant.parse("2026-07-12T20:00:00Z"),
                new CreativeManifest.Summary(assets.size(), clear, similar, duplicate, unresolved, pending),
                assets);
    }
}
