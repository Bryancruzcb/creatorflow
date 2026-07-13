package creatorflow.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.ManifestJson;
import creatorflow.model.VerificationStatus;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReleaseExportServiceTest {

    @TempDir
    Path directory;

    @Test
    void rebuildsFromLatestEvidenceAndDecisionsAndPersistsExactArtifacts() throws Exception {
        try (Database database = new Database(directory.resolve("release.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.SIMILAR, SourceEvidence.unresolved()),
                    asset("audio/theme.wav", "b", VerificationStatus.CLEAR,
                            new SourceEvidence("Studio", "Owned", "https://example.test/theme"))));

            ReleaseBundle first = fixture.service.create(project.projectId(), run.id(), "1.0.0");
            assertFalse(first.report().passed());
            assertEquals(2, first.comparison().added());
            assertEquals(1, first.comparison().unresolved());
            assertEquals(first.manifest(), new ManifestJson().read(first.release().manifestJson()));
            assertTrue(first.release().reportJson().contains("FLAGGED_WITHOUT_APPROVAL"));

            ScanAsset hero = fixture.scans.listAllAssets(run.id()).getFirst();
            fixture.scans.appendEvidence(hero.id(),
                    new SourceEvidence("Commission contract", "Owned", "https://example.test/hero"));
            fixture.decisions.append(hero.id(), DecisionType.APPROVED, "Contract verified");

            ReleaseBundle second = fixture.service.create(project.projectId(), run.id(), "1.0.1");
            assertTrue(second.report().passed());
            assertEquals(first.release().id(), second.comparison().previousReleaseId());
            assertEquals(List.of("art/hero.png"), second.comparison().changedPaths());
            assertEquals(0, second.comparison().unresolved());
            assertEquals(1, second.comparison().approved());
            assertEquals(ReleaseDecision.APPROVED,
                    second.manifest().assets().getFirst().decision());
            assertEquals("Commission contract",
                    second.manifest().assets().getFirst().source().source());
            assertEquals(second.release(), fixture.releases.findById(second.release().id()).orElseThrow());
            assertTrue(fixture.audit.forScan(run.id()).stream()
                    .anyMatch(event -> event.eventType().equals("RELEASE_CREATED")));
        }
    }

    @Test
    void comparisonUsesPreviousProjectReleaseAcrossImmutableScans() {
        try (Database database = new Database(directory.resolve("diff.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun firstRun = fixture.persistScan(project, "first", List.of(
                    asset("changed.png", "a", VerificationStatus.CLEAR, resolved()),
                    asset("removed.png", "b", VerificationStatus.CLEAR, resolved())));
            fixture.service.create(project.projectId(), firstRun.id(), "1.0");

            ScanRun secondRun = fixture.persistScan(project, "second", List.of(
                    asset("added.png", "c", VerificationStatus.CLEAR, resolved()),
                    asset("changed.png", "d", VerificationStatus.CLEAR, resolved())));
            ReleaseBundle second = fixture.service.create(project.projectId(), secondRun.id(), "2.0");

            assertEquals(List.of("added.png"), second.comparison().addedPaths());
            assertEquals(List.of("changed.png"), second.comparison().changedPaths());
            assertEquals(List.of("removed.png"), second.comparison().removedPaths());
        }
    }

    private static SourceEvidence resolved() {
        return new SourceEvidence("Studio", "Owned", "https://example.test/evidence");
    }

    private static AssetEntry asset(String path, String hashSeed, VerificationStatus verification,
                                    SourceEvidence source) {
        return new AssetEntry(path, Path.of(path).getFileName().toString(),
                path.substring(path.lastIndexOf('.') + 1), 10, hashSeed.repeat(64), 0, 0,
                new Fingerprints(null, null, null), verification, source, ReleaseDecision.PENDING,
                List.of(), List.of());
    }

    private static CreativeManifest manifest(LocalProject project, String release,
                                             List<AssetEntry> assets) {
        int clear = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.CLEAR).count();
        int similar = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.SIMILAR).count();
        int duplicate = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.DUPLICATE).count();
        int unresolved = (int) assets.stream().filter(a -> !a.source().resolved()).count();
        return new CreativeManifest(CreativeManifest.SCHEMA,
                new CreativeManifest.Project(project.name(), release), Instant.now(),
                new CreativeManifest.Summary(assets.size(), clear, similar, duplicate, unresolved, assets.size()),
                assets);
    }

    private static final class Fixture {
        private final LocalProjectRepository projects;
        private final ScanRepository scans;
        private final DecisionRepository decisions;
        private final ReleaseRepository releases;
        private final AuditRepository audit;
        private final ReleaseExportService service;

        private Fixture(Database database) {
            projects = new LocalProjectRepository(database);
            scans = new ScanRepository(database);
            decisions = new DecisionRepository(database);
            releases = new ReleaseRepository(database);
            audit = new AuditRepository(database);
            service = new ReleaseExportService(database, projects, scans, decisions, releases, audit);
        }

        private ScanRun persistScan(LocalProject project, String name, List<AssetEntry> assets) {
            ScanRun run = scans.create(project.projectId(), project.root(), name, List.of(), List.of("png"));
            scans.markStarted(run.id());
            scans.complete(run.id(), manifest(project, name, assets), ScanAccounting.empty(), List.of());
            projects.setActiveScanRun(project.projectId(), run.id());
            return scans.findById(run.id()).orElseThrow();
        }
    }
}
