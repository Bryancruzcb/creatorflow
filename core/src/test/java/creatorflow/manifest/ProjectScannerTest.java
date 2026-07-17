package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import creatorflow.model.VerificationStatus;
import creatorflow.verification.OriginalityEngine;
import java.awt.image.BufferedImage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProjectScannerTest {

    @TempDir
    Path dir;

    @Test
    void scansRealFilesInStablePathOrderAndFindsRelationships() throws Exception {
        BufferedImage original = TestMedia.structuredImage(42);
        Path art = Files.createDirectories(dir.resolve("Art"));
        Path audio = Files.createDirectories(dir.resolve("Audio"));
        TestMedia.writePng(art, "original.png", original);
        TestMedia.writePng(art, "resized.png", TestMedia.resize(original, 128, 128));
        Path tone = TestMedia.writeWav(audio, "tone.wav", TestMedia.tone(1));
        Files.copy(tone, audio.resolve("tone-copy.wav"));
        Files.writeString(dir.resolve("notes.txt"), "not a creative asset");
        Files.writeString(Files.createDirectories(dir.resolve(".cache")).resolve("hidden.svg"), "<svg/>");

        Clock clock = Clock.fixed(Instant.parse("2026-07-12T20:00:00Z"), ZoneOffset.UTC);
        ProjectScanner scanner = new ProjectScanner(new OriginalityEngine(), clock);
        CreativeManifest manifest = scanner.scan(dir, "Northwind", "1.2.0");

        assertEquals(CreativeManifest.SCHEMA_V1, manifest.schema());
        assertEquals(4, manifest.assets().size());
        assertEquals(manifest.assets().stream().map(CreativeManifest.AssetEntry::path).sorted().toList(),
                manifest.assets().stream().map(CreativeManifest.AssetEntry::path).toList());
        assertTrue(manifest.assets().stream().noneMatch(asset -> asset.path().startsWith("/")));
        assertTrue(manifest.assets().stream().anyMatch(asset -> asset.verification() == VerificationStatus.SIMILAR));
        assertTrue(manifest.assets().stream().anyMatch(asset -> asset.verification() == VerificationStatus.DUPLICATE));
        assertEquals(4, manifest.summary().unresolvedSources());
        assertEquals(4, manifest.summary().pendingDecisions());
        assertFalse(manifest.assets().stream().anyMatch(asset -> asset.fileName().equals("notes.txt")));
    }

    @Test
    void acceptsResolvedSourceEvidenceWithoutAutoApprovingRelease() throws Exception {
        TestMedia.writePng(dir, "licensed.png", TestMedia.structuredImage(8));

        CreativeManifest manifest = new ProjectScanner().scan(dir, "Licensed", "0.1",
                ignored -> new CreativeManifest.SourceEvidence(
                        "Khronos sample", "CC0 1.0", "https://example.test/source"));

        assertTrue(manifest.assets().getFirst().source().resolved());
        assertEquals(0, manifest.summary().unresolvedSources());
        assertEquals(CreativeManifest.ReleaseDecision.PENDING, manifest.assets().getFirst().decision());
    }

    @Test
    void defaultsPruneDependencyAndBuildDirectories() throws Exception {
        TestMedia.writePng(dir, "kept.png", TestMedia.structuredImage(1));
        TestMedia.writePng(Files.createDirectories(dir.resolve("node_modules/pkg")),
                "ignored.png", TestMedia.structuredImage(2));
        TestMedia.writePng(Files.createDirectories(dir.resolve("dist")),
                "built.png", TestMedia.structuredImage(3));

        ScanResult result = new ProjectScanner().scanDetailed(dir, "Policy", "1",
                SourceEvidenceResolver.unresolved(), ScanOptions.defaults(),
                ScanObserver.noop(), new ScanCancellation());

        assertEquals(List.of("kept.png"), result.manifest().assets().stream()
                .map(CreativeManifest.AssetEntry::path).toList());
        assertEquals(2, result.statistics().excluded());
    }

    @Test
    void cancellationReturnsAUsablePartialManifestAndOrderedEvents() throws Exception {
        TestMedia.writePng(dir, "a.png", TestMedia.structuredImage(1));
        TestMedia.writePng(dir, "b.png", TestMedia.structuredImage(2));
        ScanCancellation cancellation = new ScanCancellation();
        List<ScanEvent> events = new ArrayList<>();
        ScanObserver observer = event -> {
            events.add(event);
            if (event.type() == ScanEvent.Type.FILE_COMPLETED && event.processedFiles() == 1) {
                cancellation.cancel();
            }
        };

        ScanResult result = new ProjectScanner().scanDetailed(dir, "Cancel", "1",
                SourceEvidenceResolver.unresolved(), ScanOptions.defaults(), observer, cancellation);

        assertEquals(ScanResult.State.CANCELLED, result.state());
        assertEquals(1, result.manifest().assets().size());
        assertEquals(2, result.statistics().supported());
        assertEquals(ScanEvent.Type.CANCELLED, events.getLast().type());
        for (int i = 0; i < events.size(); i++) assertEquals(i + 1, events.get(i).sequence());
        assertEquals(List.of("a.png", "b.png"), events.stream()
                .filter(event -> event.type() == ScanEvent.Type.DISCOVERED)
                .map(ScanEvent::currentRelativePath).toList());
    }

    @Test
    void aFileThatDisappearsDoesNotAbortRemainingFiles() throws Exception {
        Path disappearing = TestMedia.writePng(dir, "a.png", TestMedia.structuredImage(1));
        TestMedia.writePng(dir, "b.png", TestMedia.structuredImage(2));
        ScanObserver observer = event -> {
            if (event.type() == ScanEvent.Type.FILE_STARTED
                    && "a.png".equals(event.currentRelativePath())) {
                try {
                    Files.deleteIfExists(disappearing);
                } catch (Exception error) {
                    throw new RuntimeException(error);
                }
            }
        };

        ScanResult result = new ProjectScanner().scanDetailed(dir, "Failure isolation", "1",
                SourceEvidenceResolver.unresolved(), ScanOptions.defaults(), observer,
                new ScanCancellation());

        assertEquals(ScanResult.State.COMPLETED, result.state());
        assertEquals(List.of("b.png"), result.manifest().assets().stream()
                .map(CreativeManifest.AssetEntry::path).toList());
        assertEquals(1, result.statistics().unreadable());
        assertTrue(result.problems().stream().anyMatch(problem ->
                problem.code() == ScanProblem.Code.UNREADABLE));
    }

    @Test
    void followedSymlinkCannotEscapeTheSelectedRoot() throws Exception {
        Path outside = Files.createTempFile(dir.getParent(), "creatorflow-outside-", ".svg");
        try {
            Files.writeString(outside, "<svg/>");
            Files.createSymbolicLink(dir.resolve("outside.svg"), outside);

            ScanResult result = new ProjectScanner().scanDetailed(dir, "Containment", "1",
                    SourceEvidenceResolver.unresolved(),
                    ScanOptions.defaults().withFollowSymbolicLinks(true),
                    ScanObserver.noop(), new ScanCancellation());

            assertTrue(result.manifest().assets().isEmpty());
            assertEquals(1, result.statistics().excluded());
            assertTrue(result.problems().stream().anyMatch(problem ->
                    problem.message().contains("escapes")));
        } finally {
            Files.deleteIfExists(outside);
        }
    }

    @Test
    void completedScansKeepFixedClockManifestSemantics() throws Exception {
        TestMedia.writePng(dir, "asset.png", TestMedia.structuredImage(7));
        Instant expected = Instant.parse("2026-07-12T20:00:00Z");
        ProjectScanner scanner = new ProjectScanner(new OriginalityEngine(),
                Clock.fixed(expected, ZoneOffset.UTC));

        CreativeManifest first = scanner.scan(dir, "Stable", "1");
        CreativeManifest second = scanner.scan(dir, "Stable", "1");

        assertEquals(expected, first.generatedAt());
        assertEquals(first, second);
        assertNotEquals(null, first.assets().getFirst().sha256());
    }

    @Test
    void recordsMissingLocalGltfDependenciesWithoutDroppingTheAsset() throws Exception {
        Files.writeString(dir.resolve("scene.gltf"), """
                {"asset":{"version":"2.0"},"buffers":[{"uri":"missing.bin","byteLength":4}]}
                """);

        ScanResult result = new ProjectScanner().scanDetailed(dir, "Dependencies", "1",
                SourceEvidenceResolver.unresolved(), ScanOptions.defaults(),
                ScanObserver.noop(), new ScanCancellation());

        assertEquals(1, result.manifest().assets().size());
        assertEquals(1, result.statistics().missingDependencies());
        assertTrue(result.manifest().assets().getFirst().findings().stream()
                .anyMatch(finding -> finding.equals("Missing dependency: missing.bin")));
    }
}
