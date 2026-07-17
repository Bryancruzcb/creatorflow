package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.IntendedExperience;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ManifestJsonTest {

    @TempDir
    Path dir;

    @Test
    void roundTripsAndWritesStableVersionedJson() throws Exception {
        TestMedia.writePng(dir, "asset.png", TestMedia.structuredImage(5));
        CreativeManifest manifest = new ProjectScanner().scan(dir, "Round trip", "1.0.0");
        ManifestJson json = new ManifestJson();

        String first = json.write(manifest);
        String second = json.write(manifest);
        CreativeManifest parsed = json.read(first);

        assertEquals(first, second);
        assertEquals(manifest, parsed);
        assertTrue(first.contains("\"$schema\" : \"creatorflow.manifest/v0.1\""));
        assertTrue(first.endsWith("\n"));
    }

    @Test
    void rejectsUnsupportedSchemaOnRead() {
        String json = """
                {
                  "$schema": "creatorflow.manifest/v9",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 0, "clear": 0, "similar": 0, "duplicate": 0, "unresolvedSources": 0, "pendingDecisions": 0},
                  "assets": []
                }
                """;

        assertThrows(Exception.class, () -> new ManifestJson().read(json));
    }

    @Test
    void schemaShipsInsideTheCoreJar() throws Exception {
        try (var stream = ManifestJsonTest.class.getResourceAsStream("/creatorflow-manifest-v0.1.schema.json")) {
            assertTrue(stream != null);
            assertTrue(new String(stream.readAllBytes()).contains("creatorflow.manifest/v0.1"));
        }
    }

    @Test
    void v2SchemaAlsoShipsInsideTheCoreJar() throws Exception {
        try (var stream = ManifestJsonTest.class.getResourceAsStream("/creatorflow-manifest-v0.2.schema.json")) {
            assertTrue(stream != null);
            String contents = new String(stream.readAllBytes());
            assertTrue(contents.contains("creatorflow.manifest/v0.2"));
            assertTrue(contents.contains("\"gate\""));
        }
    }

    @Test
    void rejectsSemanticallyIncorrectSummaryAndUnsafeEvidenceUrl() {
        String wrongSummary = """
                {
                  "$schema": "creatorflow.manifest/v0.1",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 1, "clear": 1, "similar": 0, "duplicate": 0, "unresolvedSources": 1, "pendingDecisions": 1},
                  "assets": []
                }
                """;
        assertThrows(Exception.class, () -> new ManifestJson().read(wrongSummary));

        String unsafeUrl = """
                {
                  "$schema": "creatorflow.manifest/v0.1",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 1, "clear": 1, "similar": 0, "duplicate": 0, "unresolvedSources": 0, "pendingDecisions": 1},
                  "assets": [{
                    "path": "asset.png", "fileName": "asset.png", "fileType": "png", "sizeBytes": 1,
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "width": 1, "height": 1,
                    "fingerprints": {"dHash": null, "pHash": null, "audio": null}, "verification": "CLEAR",
                    "source": {"source": "X", "license": "Owned", "evidenceUrl": "javascript:alert(1)"},
                    "decision": "PENDING", "matches": [], "findings": []
                  }]
                }
                """;
        assertThrows(Exception.class, () -> new ManifestJson().read(unsafeUrl));
    }

    @Test
    void manifestWithADeclaredExperienceRoundTripsAndStillValidatesWithoutOne() throws Exception {
        ManifestJson json = new ManifestJson();
        CreativeManifest.Summary emptySummary = new CreativeManifest.Summary(0, 0, 0, 0, 0, 0);
        IntendedExperience experience = new IntendedExperience(1234567890L, 9876543210L, "Obby Tower");

        CreativeManifest withExperience = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                emptySummary, List.of(), experience);
        String written = json.write(withExperience);
        assertTrue(written.contains("\"experience\""));
        assertTrue(written.contains("Obby Tower"));
        assertEquals(withExperience, json.read(written));
        assertEquals(experience, json.read(written).experience());

        CreativeManifest withoutExperience = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                emptySummary, List.of());
        String writtenWithout = json.write(withoutExperience);
        assertFalse(writtenWithout.contains("\"experience\""));
        assertEquals(withoutExperience, json.read(writtenWithout));
        assertEquals(null, json.read(writtenWithout).experience());
    }

    @Test
    void rejectsAnIntendedExperienceWithABlankNameOrNonPositiveId() {
        assertThrows(IllegalArgumentException.class,
                () -> new IntendedExperience(0, 1, "X"));
        assertThrows(IllegalArgumentException.class,
                () -> new IntendedExperience(1, 0, "X"));
        assertThrows(IllegalArgumentException.class,
                () -> new IntendedExperience(1, 1, "  "));
        assertThrows(IllegalArgumentException.class,
                () -> new IntendedExperience(1, 1, null));
    }

    @Test
    void v2ManifestEmbedsAPassOrBlockedGateAndRoundTrips() throws Exception {
        ManifestJson json = new ManifestJson();
        CreativeManifest.Summary emptySummary = new CreativeManifest.Summary(0, 0, 0, 0, 0, 0);
        CreativeManifest.Gate pass = new CreativeManifest.Gate("PASS", List.of());

        CreativeManifest passing = new CreativeManifest(CreativeManifest.SCHEMA_V2,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                emptySummary, List.of(), null, pass);
        String written = json.write(passing);
        assertTrue(written.contains("\"gate\""));
        assertTrue(written.contains("\"result\" : \"PASS\""));
        assertTrue(written.contains("\"reasons\" : [ ]"));
        assertTrue(written.contains("\"$schema\" : \"creatorflow.manifest/v0.2\""));
        assertEquals(passing, json.read(written));
        assertEquals(pass, json.read(written).gate());

        CreativeManifest.Gate blocked = new CreativeManifest.Gate("BLOCKED", List.of(
                new CreativeManifest.Gate.Reason("BLOCKED_DECISION", "art/hero.png", "CLEAR", "BLOCKED",
                        "A BLOCKED decision always prevents release")));
        CreativeManifest failing = new CreativeManifest(CreativeManifest.SCHEMA_V2,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                emptySummary, List.of(), null, blocked);
        String writtenBlocked = json.write(failing);
        assertTrue(writtenBlocked.contains("\"result\" : \"BLOCKED\""));
        assertTrue(writtenBlocked.contains("\"assetPath\" : \"art/hero.png\""));
        assertEquals(failing, json.read(writtenBlocked));
        assertEquals(1, json.read(writtenBlocked).gate().reasons().size());
    }

    @Test
    void v1ManifestsStillValidateAndCarryNoGate() throws Exception {
        ManifestJson json = new ManifestJson();
        CreativeManifest.Summary emptySummary = new CreativeManifest.Summary(0, 0, 0, 0, 0, 0);
        CreativeManifest v1 = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                emptySummary, List.of());
        String written = json.write(v1);
        assertFalse(written.contains("\"gate\""));
        assertEquals(v1, json.read(written));
        assertEquals(null, json.read(written).gate());
    }

    @Test
    void rejectsAV2ManifestMissingItsGateBlock() {
        String noGate = """
                {
                  "$schema": "creatorflow.manifest/v0.2",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 0, "clear": 0, "similar": 0, "duplicate": 0, "unresolvedSources": 0, "pendingDecisions": 0},
                  "assets": []
                }
                """;
        assertThrows(Exception.class, () -> new ManifestJson().read(noGate));
    }

    @Test
    void rejectsAV1ManifestThatCarriesAGateBlock() {
        String v1WithGate = """
                {
                  "$schema": "creatorflow.manifest/v0.1",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 0, "clear": 0, "similar": 0, "duplicate": 0, "unresolvedSources": 0, "pendingDecisions": 0},
                  "gate": {"result": "PASS", "reasons": []},
                  "assets": []
                }
                """;
        assertThrows(Exception.class, () -> new ManifestJson().read(v1WithGate));
    }

    @Test
    void rejectsAnInvalidGateResultOrBlankReasonField() {
        assertThrows(IllegalArgumentException.class,
                () -> new CreativeManifest.Gate("MAYBE", List.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new CreativeManifest.Gate.Reason("", "path", "CLEAR", "PENDING", "message"));
        assertThrows(IllegalArgumentException.class,
                () -> new CreativeManifest.Gate.Reason("CODE", " ", "CLEAR", "PENDING", "message"));
    }

    @Test
    void anAssetWithEvidenceBasesRoundTripsAndAnAssetWithoutOneStillValidates() throws Exception {
        ManifestJson json = new ManifestJson();
        EvidenceBases bases = new EvidenceBases(EvidenceBasis.VERIFIED, EvidenceBasis.DECLARED,
                EvidenceBasis.DECLARED, EvidenceBasis.NOT_VERIFIED);
        AssetEntry withBases = new AssetEntry("art/hero.png", "hero.png", "png", 10, "a".repeat(64), 0, 0,
                new Fingerprints(null, null, null), VerificationStatus.CLEAR,
                new SourceEvidence("Studio", "Owned", "https://example.test/evidence"),
                ReleaseDecision.APPROVED, List.of(), List.of()).withEvidenceBases(bases);
        AssetEntry withoutBases = new AssetEntry("art/other.png", "other.png", "png", 10, "b".repeat(64), 0, 0,
                new Fingerprints(null, null, null), VerificationStatus.CLEAR, SourceEvidence.unresolved(),
                ReleaseDecision.PENDING, List.of(), List.of());
        assertEquals(null, withoutBases.evidenceBases());

        CreativeManifest.Summary summary = new CreativeManifest.Summary(2, 2, 0, 0, 1, 1);
        CreativeManifest.Gate gate = new CreativeManifest.Gate("BLOCKED", List.of());
        CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V2,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                summary, List.of(withBases, withoutBases), null, gate);

        String written = json.write(manifest);
        assertTrue(written.contains("\"evidenceBases\""));
        assertTrue(written.contains("\"verification\" : \"VERIFIED\""));
        assertTrue(written.contains("\"ownership\" : \"NOT_VERIFIED\""));

        CreativeManifest parsed = json.read(written);
        assertEquals(manifest, parsed);
        assertEquals(bases, parsed.assets().get(0).evidenceBases());
        assertEquals(null, parsed.assets().get(1).evidenceBases());
    }

    @Test
    void anOlderV2ManifestWithoutEvidenceBasesOnAnyAssetStillValidates() throws Exception {
        // Backward compat: evidenceBases is an OPTIONAL v0.2 field. A v0.2 manifest written before
        // this increment (no evidenceBases anywhere) must still read and validate cleanly.
        String olderV2 = """
                {
                  "$schema": "creatorflow.manifest/v0.2",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 1, "clear": 1, "similar": 0, "duplicate": 0, "unresolvedSources": 1, "pendingDecisions": 1},
                  "gate": {"result": "PASS", "reasons": []},
                  "assets": [{
                    "path": "asset.png", "fileName": "asset.png", "fileType": "png", "sizeBytes": 1,
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "width": 1, "height": 1,
                    "fingerprints": {"dHash": null, "pHash": null, "audio": null}, "verification": "CLEAR",
                    "source": {"source": null, "license": null, "evidenceUrl": null},
                    "decision": "PENDING", "matches": [], "findings": []
                  }]
                }
                """;
        CreativeManifest manifest = new ManifestJson().read(olderV2);
        assertEquals(null, manifest.assets().getFirst().evidenceBases());
    }

    @Test
    void rejectsAnInvalidEvidenceBasisEnumValue() {
        String invalidBasis = """
                {
                  "$schema": "creatorflow.manifest/v0.2",
                  "project": {"name": "X", "release": "1"},
                  "generatedAt": "2026-07-12T20:00:00Z",
                  "summary": {"total": 1, "clear": 1, "similar": 0, "duplicate": 0, "unresolvedSources": 1, "pendingDecisions": 1},
                  "gate": {"result": "PASS", "reasons": []},
                  "assets": [{
                    "path": "asset.png", "fileName": "asset.png", "fileType": "png", "sizeBytes": 1,
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "width": 1, "height": 1,
                    "fingerprints": {"dHash": null, "pHash": null, "audio": null}, "verification": "CLEAR",
                    "source": {"source": null, "license": null, "evidenceUrl": null},
                    "decision": "PENDING", "matches": [], "findings": [],
                    "evidenceBases": {"verification": "MAYBE", "source": "NOT_VERIFIED", "ownership": "NOT_VERIFIED"}
                  }]
                }
                """;
        assertThrows(Exception.class, () -> new ManifestJson().read(invalidBasis));
    }
}
