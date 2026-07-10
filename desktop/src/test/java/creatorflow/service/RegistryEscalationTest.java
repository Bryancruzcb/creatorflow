package creatorflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import creatorflow.db.AssetRepository;
import creatorflow.db.Database;
import creatorflow.db.ProjectRepository;
import creatorflow.model.Asset;
import creatorflow.model.Project;
import creatorflow.model.VerificationStatus;
import creatorflow.service.AssetImporter.ImportRequest;
import creatorflow.service.AssetImporter.ImportResult;
import creatorflow.service.registry.RegistryClient;
import creatorflow.verification.OriginalityEngine;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The community registry can escalate a locally-clear import, and failures must be soft. */
class RegistryEscalationTest {

    @TempDir
    Path dir;

    private Database database;
    private AssetRepository assets;
    private Project project;
    private ProjectRepository projects;

    @BeforeEach
    void setUp() {
        database = new Database(dir.resolve("test.db"));
        projects = new ProjectRepository(database);
        assets = new AssetRepository(database);
        project = projects.insert("Test project", "");
    }

    @AfterEach
    void tearDown() {
        database.close();
    }

    @Test
    void remoteDuplicateEscalatesVerdictAndPersistsEvidence() throws Exception {
        RegistryClient remoteDuplicate = new RegistryClient() {
            @Override
            public boolean isConfigured() {
                return true;
            }

            @Override
            public RemoteVerdict verify(String fileName, String sha256, Long dHash, Long pHash, Long audioFp) {
                return new RemoteVerdict(VerificationStatus.DUPLICATE, List.of(new RemoteMatch(
                        77, "original.png", "someone_else", "sha256", 0,
                        "Byte-identical to “original.png” registered by someone_else")));
            }

            @Override
            public void register(Asset asset) {
                // accepted silently
            }
        };
        AssetImporter importer = new AssetImporter(assets, new OriginalityEngine(),
                dir.resolve("library"), remoteDuplicate);

        Path source = TestMedia.writePng(dir, "sprite.png", TestMedia.structuredImage(5));
        ImportResult result = importer.importFile(
                new ImportRequest(source, project.id(), "All rights reserved", true));

        assertEquals(VerificationStatus.DUPLICATE, result.asset().status(),
                "a registry duplicate must override a locally-clear verdict");
        assertEquals(1, assets.matchesFor(result.asset().id()).size());
        assertEquals("registry", assets.matchesFor(result.asset().id()).get(0).layer());
        assertTrue(result.report().layersRun().stream().anyMatch(l -> l.contains("Community registry")));
    }

    @Test
    void unreachableRegistryFailsSoft() throws Exception {
        RegistryClient unreachable = new RegistryClient() {
            @Override
            public boolean isConfigured() {
                return true;
            }

            @Override
            public RemoteVerdict verify(String fileName, String sha256, Long dHash, Long pHash, Long audioFp)
                    throws IOException {
                throw new IOException("connection refused");
            }

            @Override
            public void register(Asset asset) throws IOException {
                throw new IOException("connection refused");
            }
        };
        AssetImporter importer = new AssetImporter(assets, new OriginalityEngine(),
                dir.resolve("library"), unreachable);

        Path source = TestMedia.writePng(dir, "sprite.png", TestMedia.structuredImage(5));
        ImportResult result = importer.importFile(
                new ImportRequest(source, project.id(), "All rights reserved", true));

        assertEquals(VerificationStatus.CLEAR, result.asset().status(),
                "imports must still succeed when the registry is down");
        assertTrue(result.asset().findings().contains("Community registry unreachable"));
    }
}
