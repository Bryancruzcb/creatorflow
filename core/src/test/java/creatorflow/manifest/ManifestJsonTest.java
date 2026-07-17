package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import creatorflow.manifest.CreativeManifest.IntendedExperience;
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

        CreativeManifest withExperience = new CreativeManifest(CreativeManifest.SCHEMA,
                new CreativeManifest.Project("X", "1"), Instant.parse("2026-07-12T20:00:00Z"),
                emptySummary, List.of(), experience);
        String written = json.write(withExperience);
        assertTrue(written.contains("\"experience\""));
        assertTrue(written.contains("Obby Tower"));
        assertEquals(withExperience, json.read(written));
        assertEquals(experience, json.read(written).experience());

        CreativeManifest withoutExperience = new CreativeManifest(CreativeManifest.SCHEMA,
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
}
