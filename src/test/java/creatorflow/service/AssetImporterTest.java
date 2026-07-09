package creatorflow.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.TestMedia;
import creatorflow.db.AssetRepository;
import creatorflow.db.Database;
import creatorflow.db.ProjectRepository;
import creatorflow.model.Project;
import creatorflow.model.VerificationStatus;
import creatorflow.service.AssetImporter.ImportRequest;
import creatorflow.service.AssetImporter.ImportResult;
import creatorflow.verification.OriginalityEngine;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AssetImporterTest {

    @TempDir
    Path dir;

    private Database database;
    private ProjectRepository projects;
    private AssetRepository assets;
    private AssetImporter importer;
    private Project project;

    @BeforeEach
    void setUp() {
        database = new Database(dir.resolve("test.db"));
        projects = new ProjectRepository(database);
        assets = new AssetRepository(database);
        importer = new AssetImporter(assets, new OriginalityEngine(), dir.resolve("library"));
        project = projects.insert("Test project", "");
    }

    @AfterEach
    void tearDown() {
        database.close();
    }

    @Test
    void importCopiesFileVerifiesAndPersists() throws Exception {
        Path source = TestMedia.writePng(dir, "sprite.png", TestMedia.structuredImage(5));

        ImportResult result = importer.importFile(
                new ImportRequest(source, project.id(), "CC0 (public domain)", true));

        assertEquals(VerificationStatus.CLEAR, result.asset().status());
        assertTrue(result.asset().id() > 0);
        assertTrue(Files.exists(Path.of(result.asset().storedPath())), "file should be copied into the library");
        assertEquals("CC0 (public domain)", result.asset().license());
        assertEquals(1, assets.count());
        assertTrue(result.asset().width() > 0);
    }

    @Test
    void reimportingSameBytesIsFlaggedDuplicateAndEvidencePersisted() throws Exception {
        Path source = TestMedia.writePng(dir, "sprite.png", TestMedia.structuredImage(5));
        importer.importFile(new ImportRequest(source, project.id(), "All rights reserved", true));

        ImportResult second = importer.importFile(
                new ImportRequest(source, project.id(), "All rights reserved", true));

        assertEquals(VerificationStatus.DUPLICATE, second.asset().status());
        assertEquals(1, second.report().matches().size());
        assertEquals(1, assets.matchesFor(second.asset().id()).size());

        // same file name imported twice: the stored copies must not collide
        var all = assets.findAll();
        assertEquals(2, all.size());
        assertNotEquals(all.get(0).storedPath(), all.get(1).storedPath());
    }
}
