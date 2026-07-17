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
    void stampsABoundExperienceOntoTheManifestAndReleaseRowButOmitsItWhenUnbound() throws Exception {
        try (Database database = new Database(directory.resolve("experience-release.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.CLEAR, resolved())));

            ReleaseBundle unbound = fixture.service.create(project.projectId(), run.id(), "1.0.0");
            assertFalse(unbound.release().manifestJson().contains("\"experience\""));
            assertEquals(null, unbound.manifest().experience());
            assertEquals(null, unbound.release().universeId());
            assertEquals(null, unbound.release().placeId());
            assertEquals(null, unbound.release().experienceName());

            fixture.projects.bindExperience(project.projectId(), 1234567890L, 9876543210L, "Obby Tower");
            ScanRun secondRun = fixture.persistScan(project, "scan-2", List.of(
                    asset("art/hero.png", "a", VerificationStatus.CLEAR, resolved())));
            ReleaseBundle bound = fixture.service.create(project.projectId(), secondRun.id(), "1.0.1");

            assertEquals(new CreativeManifest.IntendedExperience(1234567890L, 9876543210L, "Obby Tower"),
                    bound.manifest().experience());
            assertTrue(bound.release().manifestJson().contains("Obby Tower"));
            assertEquals(1234567890L, bound.release().universeId());
            assertEquals(9876543210L, bound.release().placeId());
            assertEquals("Obby Tower", bound.release().experienceName());
            assertEquals(bound.release(), fixture.releases.findById(bound.release().id()).orElseThrow());
        }
    }

    @Test
    void embedsAGateBlockThatStaysConsistentWithTheSeparateReportAsEvidenceIsResolved() throws Exception {
        try (Database database = new Database(directory.resolve("gate-embed.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.SIMILAR, SourceEvidence.unresolved())));

            ReleaseBundle blocked = fixture.service.create(project.projectId(), run.id(), "1.0.0");

            assertFalse(blocked.report().passed());
            assertEquals("BLOCKED", blocked.manifest().gate().result());
            assertEquals(blocked.report().violations().size(), blocked.manifest().gate().reasons().size());
            assertTrue(blocked.manifest().gate().reasons().stream()
                    .anyMatch(reason -> reason.assetPath().equals("art/hero.png")));
            assertTrue(blocked.release().manifestJson().contains("\"gate\""));
            assertTrue(blocked.release().manifestJson().contains("\"result\" : \"BLOCKED\""));

            ScanAsset hero = fixture.scans.listAllAssets(run.id()).getFirst();
            fixture.scans.appendEvidence(hero.id(),
                    new SourceEvidence("Studio archive", "Owned", "https://example.test/hero"));
            fixture.decisions.append(hero.id(), DecisionType.APPROVED, "Reviewed and cleared for release");

            ReleaseBundle passing = fixture.service.create(project.projectId(), run.id(), "1.0.1");

            assertTrue(passing.report().passed());
            assertEquals("PASS", passing.manifest().gate().result());
            assertTrue(passing.manifest().gate().reasons().isEmpty());
            assertTrue(passing.release().manifestJson().contains("\"reasons\" : [ ]"));
        }
    }

    @Test
    void recreatingAReleaseFromTheSameCompletedScanRunIsByteIdentical() throws Exception {
        try (Database database = new Database(directory.resolve("determinism.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.CLEAR, resolved()),
                    asset("audio/theme.wav", "b", VerificationStatus.CLEAR, resolved())));
            ScanRun completed = fixture.scans.findById(run.id()).orElseThrow();

            ReleaseBundle first = fixture.service.create(project.projectId(), run.id(), "1.0.0");
            ReleaseBundle second = fixture.service.create(project.projectId(), run.id(), "1.0.0");

            assertEquals(completed.completedAt(), first.manifest().generatedAt());
            assertEquals(first.manifest().generatedAt(), second.manifest().generatedAt());
            assertEquals(first.manifest(), second.manifest());
            assertEquals(first.release().manifestJson(), second.release().manifestJson());
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
        return new CreativeManifest(CreativeManifest.SCHEMA_V1,
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
