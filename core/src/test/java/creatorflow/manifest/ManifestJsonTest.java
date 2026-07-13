package creatorflow.manifest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import java.nio.file.Path;
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
}
