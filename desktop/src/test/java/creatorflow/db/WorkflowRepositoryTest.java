package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.workflow.DecisionType;
import creatorflow.workflow.ScanAccounting;
import creatorflow.workflow.ScanState;
import creatorflow.workflow.WorkspaceState;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WorkflowRepositoryTest {

    @TempDir
    Path directory;

    @Test
    void migrationsPreserveLegacyTablesAndAreIdempotent() throws Exception {
        Path file = directory.resolve("legacy.db");
        try (var connection = DriverManager.getConnection("jdbc:sqlite:" + file);
             var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
            statement.execute("CREATE TABLE assets (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), file_name TEXT NOT NULL, stored_path TEXT NOT NULL, file_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL, dhash INTEGER, phash INTEGER, audio_fp INTEGER, license TEXT NOT NULL, ownership_declared INTEGER NOT NULL, status TEXT NOT NULL, findings TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL)");
            statement.execute("CREATE TABLE asset_matches (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL REFERENCES assets(id), matched_asset_id INTEGER NOT NULL, matched_file_name TEXT NOT NULL, layer TEXT NOT NULL, distance INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '')");
            statement.execute("INSERT INTO projects(name, description, created_at) VALUES ('Legacy', '', '2026-01-01T00:00:00Z')");
        }

        try (Database database = new Database(file)) {
            try (var statement = database.connection().createStatement();
                 var result = statement.executeQuery("SELECT COUNT(*) FROM schema_migrations")) {
                assertTrue(result.next());
                assertEquals(9, result.getInt(1));
            }
            assertEquals(1, new ProjectRepository(database).count());
        }
        try (Database reopened = new Database(file)) {
            assertEquals(1, new ProjectRepository(reopened).count());
        }
    }

    @Test
    void immutableScanSnapshotDecisionsAndWorkspaceRoundTrip() {
        try (Database database = new Database(directory.resolve("workflow.db"))) {
            var localProjects = new LocalProjectRepository(database);
            var scans = new ScanRepository(database);
            var decisions = new DecisionRepository(database);
            var workspace = new WorkspaceStateRepository(database);
            var project = localProjects.adopt(directory);
            var run = scans.create(project.projectId(), project.root(), "1.0.0",
                    List.of("node_modules"), List.of("png"));
            scans.markStarted(run.id());

            AssetEntry asset = new AssetEntry("art/hero.png", "hero.png", "png", 128,
                    "a".repeat(64), 64, 64, new Fingerprints("01", "02", null),
                    VerificationStatus.SIMILAR,
                    new SourceEvidence("Studio archive", "CC-BY-4.0", "https://example.test/evidence"),
                    ReleaseDecision.PENDING, List.of(), List.of("Perceptual match"));
            CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                    new CreativeManifest.Project(project.name(), "1.0.0"), Instant.now(),
                    new CreativeManifest.Summary(1, 0, 1, 0, 0, 1), List.of(asset));
            scans.complete(run.id(), manifest, new ScanAccounting(1, 2, 3, 4, 5, 6, 128),
                    List.of("one warning"));

            var completed = scans.findById(run.id()).orElseThrow();
            assertEquals(ScanState.COMPLETED, completed.state());
            assertEquals(1, scans.listAssets(run.id(), 100, 0).size());
            assertThrows(IllegalStateException.class,
                    () -> scans.complete(run.id(), manifest, ScanAccounting.empty(), List.of()));
            var savedAsset = scans.listAssets(run.id(), 100, 0).getFirst();
            assertEquals("Studio archive", scans.evidenceFor(savedAsset.id()).orElseThrow().source());
            assertFalse(scans.findingsFor(savedAsset.id()).isEmpty());

            assertThrows(IllegalArgumentException.class,
                    () -> decisions.append(savedAsset.id(), DecisionType.APPROVED, " "));
            var first = decisions.append(savedAsset.id(), DecisionType.NEEDS_REVIEW, "Confirm source");
            var second = decisions.supersede(first.id(), DecisionType.APPROVED, "Evidence verified");
            assertEquals(first.id(), second.supersedesDecisionId());
            assertEquals(2, decisions.historyFor(savedAsset.id()).size());
            assertEquals(DecisionType.APPROVED, decisions.latestFor(savedAsset.id()).orElseThrow().type());

            workspace.save(new WorkspaceState(project.projectId(), run.id(), savedAsset.id(), null,
                    "{\"status\":\"SIMILAR\"}", "[]", Instant.now()));
            assertEquals(savedAsset.id(), workspace.load().orElseThrow().selectedAssetId());
        }
    }

    @Test
    void bindsAndPersistsAnIntendedExperienceDeclarationOnALocalProject() {
        try (Database database = new Database(directory.resolve("experience.db"))) {
            var localProjects = new LocalProjectRepository(database);
            var project = localProjects.adopt(directory);
            assertEquals(null, project.universeId());
            assertEquals(null, project.placeId());
            assertEquals(null, project.experienceName());

            localProjects.bindExperience(project.projectId(), 1234567890L, 9876543210L, "Obby Tower");

            var reloaded = localProjects.findByProjectId(project.projectId()).orElseThrow();
            assertEquals(1234567890L, reloaded.universeId());
            assertEquals(9876543210L, reloaded.placeId());
            assertEquals("Obby Tower", reloaded.experienceName());

            assertThrows(IllegalArgumentException.class,
                    () -> localProjects.bindExperience(project.projectId() + 999, 1L, 2L, "Nope"));
        }
    }

    @Test
    void animationComparisonEvidenceSurvivesRestartAndCascadesWithProject() throws Exception {
        Path file = directory.resolve("motion.db");
        long projectId;
        String comparisonId;
        try (Database database = new Database(file)) {
            var project = new LocalProjectRepository(database).adopt(directory);
            projectId = project.projectId();
            var repository = new AnimationComparisonRepository(database);
            var record = repository.insert(projectId, "1001", "1002", "Walk A", "Walk B",
                    1.25, 1.18, "a".repeat(64), "b".repeat(64),
                    88, 91, 76, 100, false,
                    "{\"verdict\":\"MODERATE_SIMILARITY\"}", "creatorflow.motion-compare/v0.1");
            comparisonId = record.id();
            assertEquals(1, repository.forProject(projectId, 25, 0).size());
            assertEquals("1002", repository.findById(comparisonId).orElseThrow().candidateAssetId());
        }

        try (Database database = new Database(file)) {
            var repository = new AnimationComparisonRepository(database);
            assertEquals(88, repository.findById(comparisonId).orElseThrow().overallScore());
            try (var statement = database.connection().prepareStatement("DELETE FROM projects WHERE id = ?")) {
                statement.setLong(1, projectId);
                assertEquals(1, statement.executeUpdate());
            }
            assertTrue(repository.findById(comparisonId).isEmpty());
        }
    }

    @Test
    void fullWorkflowStateSurvivesADesktopRestartAcrossExperienceEvidenceDecisionsAndRelease() throws Exception {
        Path file = directory.resolve("restart.db");
        long projectId;
        long assetId;
        String runId;
        String decisionId;
        String releaseId;

        try (Database database = new Database(file)) {
            var localProjects = new LocalProjectRepository(database);
            var scans = new ScanRepository(database);
            var decisions = new DecisionRepository(database);
            var releases = new ReleaseRepository(database);

            var adopted = localProjects.adopt(directory);
            projectId = adopted.projectId();
            localProjects.bindExperience(projectId, 1234567890L, 9876543210L, "Restart Experience");
            var boundProject = localProjects.findByProjectId(projectId).orElseThrow();

            var run = scans.create(projectId, directory, "1.0.0", List.of("node_modules"), List.of("png"));
            runId = run.id();
            scans.markStarted(runId);

            AssetEntry asset = new AssetEntry("art/hero.png", "hero.png", "png", 128,
                    "c".repeat(64), 64, 64, new Fingerprints("01", "02", null),
                    VerificationStatus.CLEAR, new SourceEvidence(null, null, null),
                    ReleaseDecision.PENDING, List.of(), List.of());
            CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                    new CreativeManifest.Project(boundProject.name(), "1.0.0"), Instant.now(),
                    new CreativeManifest.Summary(1, 1, 0, 0, 1, 1), List.of(asset));
            scans.complete(runId, manifest, new ScanAccounting(1, 0, 0, 0, 0, 0, 128), List.of());

            var savedAsset = scans.listAssets(runId, 10, 0).getFirst();
            assetId = savedAsset.id();

            // evidenceFor() breaks ties on recorded_at alone (no id tiebreak), so give the
            // human-recorded evidence below a distinct, later timestamp than the scan-time row.
            Thread.sleep(5);

            // A human-recorded source/license pair, appended after the immutable scan snapshot.
            scans.appendEvidence(assetId,
                    new SourceEvidence("Studio archive", "CC-BY-4.0", "https://example.test/evidence"));

            // A human decision with its required reason — the append-only history starts here.
            var decision = decisions.append(assetId, DecisionType.APPROVED,
                    "Verified against studio archive license");
            decisionId = decision.id();

            var release = releases.insert(runId, "1.0.0", "{\"schema\":\"v1\"}", "PASS",
                    "{\"gate\":\"pass\"}", "{\"added\":1,\"changed\":0,\"removed\":0}",
                    boundProject.universeId(), boundProject.placeId(), boundProject.experienceName());
            releaseId = release.id();
            releases.recordPublishedVersion(releaseId, 42L);
        }

        // Close the database, then reopen a NEW Database instance over the SAME file — the desktop
        // app restart this test exists to prove survives without silently losing state.
        try (Database reopened = new Database(file)) {
            var localProjects = new LocalProjectRepository(reopened);
            var scans = new ScanRepository(reopened);
            var decisions = new DecisionRepository(reopened);
            var releases = new ReleaseRepository(reopened);

            var reloadedProject = localProjects.findByProjectId(projectId).orElseThrow();
            assertEquals(1234567890L, reloadedProject.universeId());
            assertEquals(9876543210L, reloadedProject.placeId());
            assertEquals("Restart Experience", reloadedProject.experienceName());

            var reloadedRun = scans.findById(runId).orElseThrow();
            assertEquals(ScanState.COMPLETED, reloadedRun.state());
            assertEquals(1, scans.listAssets(runId, 10, 0).size());

            var evidence = scans.evidenceFor(assetId).orElseThrow();
            assertEquals("Studio archive", evidence.source());
            assertEquals("CC-BY-4.0", evidence.license());
            assertTrue(evidence.resolved());

            var history = decisions.historyFor(assetId);
            assertEquals(1, history.size());
            assertEquals(decisionId, history.getFirst().id());
            assertEquals("Verified against studio archive license", history.getFirst().reason());
            assertEquals(DecisionType.APPROVED, decisions.latestFor(assetId).orElseThrow().type());

            var reloadedRelease = releases.findById(releaseId).orElseThrow();
            assertEquals("PASS", reloadedRelease.policyResult());
            assertEquals(42L, reloadedRelease.publishedPlaceVersion());
            assertEquals(1234567890L, reloadedRelease.universeId());
            assertEquals("Restart Experience", reloadedRelease.experienceName());
        }
    }
}
