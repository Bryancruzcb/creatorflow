package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.model.Asset;
import creatorflow.model.AssetMatch;
import creatorflow.model.Project;
import creatorflow.model.VerificationStatus;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RepositoryTest {

    @TempDir
    Path dir;

    private Database database;
    private ProjectRepository projects;
    private AssetRepository assets;

    @BeforeEach
    void openDatabase() {
        database = new Database(dir.resolve("test.db"));
        projects = new ProjectRepository(database);
        assets = new AssetRepository(database);
    }

    @AfterEach
    void closeDatabase() {
        database.close();
    }

    @Test
    void projectRoundTrip() {
        Project created = projects.insert("Fantasy RPG", "sprites and sounds");
        assertTrue(created.id() > 0);

        List<Project> all = projects.findAll();
        assertEquals(1, all.size());
        assertEquals("Fantasy RPG", all.get(0).name());
        assertEquals(0, all.get(0).assetCount());
        assertEquals(1, projects.count());
        assertEquals("Fantasy RPG", projects.findById(created.id()).orElseThrow().name());
    }

    @Test
    void duplicateProjectNamesAreRejectedCaseInsensitively() {
        projects.insert("Fantasy RPG", "");
        assertThrows(IllegalArgumentException.class, () -> projects.insert("fantasy rpg", ""));
    }

    @Test
    void assetRoundTripIncludingNullableHashesAndMatches() {
        Project project = projects.insert("P", "");
        Asset saved = assets.insert(asset(project.id(), "a.png", "sha-a", 42L, 43L,
                        VerificationStatus.SIMILAR),
                List.of(new AssetMatch(7, "other.png", "phash", 4, "close match")));

        assertTrue(saved.id() > 0);
        List<Asset> all = assets.findAll();
        assertEquals(1, all.size());
        Asset loaded = all.get(0);
        assertEquals("a.png", loaded.fileName());
        assertEquals(42L, loaded.dHash());
        assertEquals(43L, loaded.pHash());
        assertNull(loaded.audioFp());
        assertEquals(VerificationStatus.SIMILAR, loaded.status());
        assertTrue(loaded.ownershipDeclared());

        List<AssetMatch> matches = assets.matchesFor(saved.id());
        assertEquals(1, matches.size());
        assertEquals("phash", matches.get(0).layer());
        assertEquals(4, matches.get(0).distance());
        assertEquals("other.png", matches.get(0).matchedFileName());

        assertEquals(1, projects.findAll().get(0).assetCount());
    }

    @Test
    void statusCountsAndFlaggedFilter() {
        Project project = projects.insert("P", "");
        assets.insert(asset(project.id(), "a.png", "sha-a", 1L, 1L, VerificationStatus.CLEAR), List.of());
        assets.insert(asset(project.id(), "b.png", "sha-b", 2L, 2L, VerificationStatus.SIMILAR), List.of());
        assets.insert(asset(project.id(), "c.png", "sha-c", 3L, 3L, VerificationStatus.DUPLICATE), List.of());

        var byStatus = assets.countByStatus();
        assertEquals(1, byStatus.get(VerificationStatus.CLEAR));
        assertEquals(1, byStatus.get(VerificationStatus.SIMILAR));
        assertEquals(1, byStatus.get(VerificationStatus.DUPLICATE));
        assertEquals(3, assets.count());
        assertEquals(2, assets.findFlagged().size());
        assertEquals(3 * 100, assets.totalSizeBytes());
    }

    @Test
    void recentAssetsAreNewestFirst() {
        Project project = projects.insert("P", "");
        assets.insert(asset(project.id(), "old.png", "sha-1", null, null, VerificationStatus.CLEAR,
                Instant.parse("2026-01-01T00:00:00Z")), List.of());
        assets.insert(asset(project.id(), "new.png", "sha-2", null, null, VerificationStatus.CLEAR,
                Instant.parse("2026-06-01T00:00:00Z")), List.of());

        List<Asset> recent = assets.findRecent(1);
        assertEquals(1, recent.size());
        assertEquals("new.png", recent.get(0).fileName());
        assertEquals(2, assets.findByProject(project.id()).size());
    }

    private static Asset asset(long projectId, String name, String sha, Long dHash, Long pHash,
                               VerificationStatus status) {
        return asset(projectId, name, sha, dHash, pHash, status, Instant.now());
    }

    private static Asset asset(long projectId, String name, String sha, Long dHash, Long pHash,
                               VerificationStatus status, Instant addedAt) {
        return new Asset(0, projectId, name, "/tmp/" + name, "png", 100, 64, 64, sha,
                dHash, pHash, null, "All rights reserved", true, status, "", addedAt);
    }
}
