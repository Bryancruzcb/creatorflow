package creatorflow.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.OwnershipVerificationRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.EvidenceBases;
import creatorflow.manifest.EvidenceBasis;
import creatorflow.manifest.ManifestJson;
import creatorflow.manifest.OwnershipEvidence;
import creatorflow.manifest.ReleaseGate;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
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
    void recordsASelfReportedPublishedPlaceVersionOnTheReleaseRowAndRejectsAnUnknownRelease() throws Exception {
        try (Database database = new Database(directory.resolve("published-version.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.CLEAR, resolved())));

            ReleaseBundle bundle = fixture.service.create(project.projectId(), run.id(), "1.0.0");
            assertEquals(null, bundle.release().publishedPlaceVersion());
            assertEquals(null, fixture.releases.findById(bundle.release().id()).orElseThrow()
                    .publishedPlaceVersion());

            fixture.releases.recordPublishedVersion(bundle.release().id(), 42);

            ReleaseRecord reloaded = fixture.releases.findById(bundle.release().id()).orElseThrow();
            assertEquals(42L, reloaded.publishedPlaceVersion());

            assertThrows(IllegalArgumentException.class,
                    () -> fixture.releases.recordPublishedVersion("not-a-real-release-id", 1));
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

    /**
     * Pins the bases derived for assets with <em>no</em> ownership verification row: source follows
     * resolution, verification is always CreatorFlow's own computation, and ownership stays
     * NOT_VERIFIED because nothing was checked. Since Phase A ownership is no longer unconditionally
     * NOT_VERIFIED — a persisted MATCH/MISMATCH makes it VERIFIED, which
     * {@link #stampsPersistedOwnershipOntoTheManifestFlippingTheBasisOnlyWhenFactsWereObtained()} covers. This test's subject
     * is the un-checked default, not a global rule.
     */
    @Test
    void populatesEvidenceBasesFromSourceResolutionAndLeavesOwnershipNotVerifiedWhenNothingWasChecked()
            throws Exception {
        try (Database database = new Database(directory.resolve("evidence-bases.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.SIMILAR, SourceEvidence.unresolved()),
                    asset("audio/theme.wav", "b", VerificationStatus.CLEAR,
                            new SourceEvidence("Studio", "Owned", "https://example.test/theme"))));

            ReleaseBundle bundle = fixture.service.create(project.projectId(), run.id(), "1.0.0");

            AssetEntry unresolved = bundle.manifest().assets().stream()
                    .filter(entryAsset -> entryAsset.path().equals("art/hero.png")).findFirst().orElseThrow();
            AssetEntry resolved = bundle.manifest().assets().stream()
                    .filter(entryAsset -> entryAsset.path().equals("audio/theme.wav")).findFirst().orElseThrow();

            // BLOCKED/unresolved asset: source is honestly unknown; nobody entered an animation id
            // for it, so there is no verification row and ownership reads NOT_VERIFIED — an unknown.
            assertEquals(EvidenceBasis.NOT_VERIFIED, unresolved.evidenceBases().source());
            assertEquals(EvidenceBasis.NOT_VERIFIED, unresolved.evidenceBases().ownership());
            assertEquals(EvidenceBasis.VERIFIED, unresolved.evidenceBases().verification());
            assertEquals(null, unresolved.evidenceBases().decision());

            // Resolved asset: a human recorded source/license, so it's DECLARED. Ownership is still
            // NOT_VERIFIED here for the same reason — unchecked, not checked-and-found-wanting.
            assertEquals(EvidenceBasis.DECLARED, resolved.evidenceBases().source());
            assertEquals(EvidenceBasis.NOT_VERIFIED, resolved.evidenceBases().ownership());
            assertEquals(EvidenceBasis.VERIFIED, resolved.evidenceBases().verification());

            assertTrue(bundle.release().manifestJson().contains("\"evidenceBases\""));
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

    @Test
    void stampsPersistedOwnershipOntoTheManifestFlippingTheBasisOnlyWhenFactsWereObtained()
            throws Exception {
        try (Database database = new Database(directory.resolve("ownership-stamp.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.CLEAR, resolved()),
                    asset("art/villain.png", "b", VerificationStatus.CLEAR, resolved()),
                    asset("audio/theme.wav", "c", VerificationStatus.CLEAR, resolved())));
            long heroId = assetId(fixture, run, "art/hero.png");
            long villainId = assetId(fixture, run, "art/villain.png");

            // A MATCH: authoritative facts obtained. Persisted at the Task-6 verify route, read here.
            Instant checkedAt = Instant.parse("2026-07-24T12:00:00Z");
            OwnershipEvidence match = new OwnershipEvidence(507766388L, OwnershipEvidence.TYPE_USER, 42L,
                    "Animation", "Approved", OwnershipEvidence.TYPE_USER, 42L, null,
                    OwnershipOutcome.MATCH, checkedAt);
            fixture.ownershipVerifications.insert(heroId, 90110L, match);
            // A real observation that obtained NO facts (e.g. GetAsset 404): a row exists, outcome
            // UNVERIFIABLE — it must never masquerade as a false VERIFIED.
            OwnershipEvidence unverifiable = new OwnershipEvidence(507777826L, null, null, null, null,
                    null, null, null, OwnershipOutcome.UNVERIFIABLE, Instant.parse("2026-07-24T13:00:00Z"));
            fixture.ownershipVerifications.insert(villainId, 90110L, unverifiable);
            // audio/theme.wav is never verified — no row at all.

            ReleaseBundle bundle = fixture.service.create(project.projectId(), run.id(), "1.0.0");

            AssetEntry hero = entryFor(bundle, "art/hero.png");
            AssetEntry villain = entryFor(bundle, "art/villain.png");
            AssetEntry theme = entryFor(bundle, "audio/theme.wav");

            // Facts obtained: ownership stamped verbatim, checkedAt exactly as persisted, basis VERIFIED.
            assertEquals(match, hero.ownership());
            assertEquals(checkedAt, hero.ownership().checkedAt());
            assertEquals(EvidenceBasis.VERIFIED, hero.evidenceBases().ownership());

            // A row exists but no facts were obtained: the observation is carried, yet the basis stays
            // NOT_VERIFIED — absence of proof is never a false VERIFIED.
            assertNotNull(villain.ownership());
            assertEquals(OwnershipOutcome.UNVERIFIABLE, villain.ownership().outcome());
            assertEquals(EvidenceBasis.NOT_VERIFIED, villain.evidenceBases().ownership());

            // Never verified: no ownership block at all, basis NOT_VERIFIED.
            assertNull(theme.ownership());
            assertEquals(EvidenceBasis.NOT_VERIFIED, theme.evidenceBases().ownership());

            // The stamped ownership survives serialization into the persisted manifest JSON.
            assertTrue(bundle.release().manifestJson().contains("\"robloxAssetId\" : 507766388"));
            assertTrue(bundle.release().manifestJson().contains("\"checkedAt\" : \"2026-07-24T12:00:00Z\""));

            // The export records WHICH animation id was checked and that a person supplied it. The
            // ownership FACTS are CreatorFlow's (VERIFIED); the file-to-animation link is the user's
            // (DECLARED) — an exported manifest must never let the two read as one verified claim.
            assertEquals(507766388L, hero.ownership().robloxAssetId());
            assertEquals(OwnershipEvidence.ASSET_ID_DECLARED_BY_USER, hero.ownership().assetIdSource());
            assertEquals(EvidenceBasis.DECLARED, EvidenceBases.ownershipLinkBasis(hero.ownership()));
            assertEquals(EvidenceBasis.NOT_VERIFIED, EvidenceBases.ownershipLinkBasis(theme.ownership()));
            assertTrue(bundle.release().manifestJson().contains("\"assetIdSource\" : \"DECLARED_BY_USER\""));
        }
    }

    @Test
    void recreatingAReleaseWithPersistedOwnershipRowsIsByteIdentical() throws Exception {
        try (Database database = new Database(directory.resolve("ownership-determinism.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "scan-1", List.of(
                    asset("art/hero.png", "a", VerificationStatus.CLEAR, resolved()),
                    asset("audio/theme.wav", "b", VerificationStatus.CLEAR, resolved())));
            long heroId = assetId(fixture, run, "art/hero.png");
            long themeId = assetId(fixture, run, "audio/theme.wav");

            fixture.ownershipVerifications.insert(heroId, 90110L, new OwnershipEvidence(507766388L,
                    OwnershipEvidence.TYPE_USER, 42L, "Animation", "Approved", OwnershipEvidence.TYPE_USER,
                    42L, null, OwnershipOutcome.MATCH, Instant.parse("2026-07-24T12:00:00Z")));
            // A MISMATCH is still "facts obtained": creator is a user, owner is a group they don't belong to.
            fixture.ownershipVerifications.insert(themeId, 90110L, new OwnershipEvidence(507777826L,
                    OwnershipEvidence.TYPE_USER, 7L, "Animation", "Approved", OwnershipEvidence.TYPE_GROUP,
                    295182L, null, OwnershipOutcome.MISMATCH, Instant.parse("2026-07-24T12:30:00Z")));

            ReleaseBundle first = fixture.service.create(project.projectId(), run.id(), "1.0.0");
            ReleaseBundle second = fixture.service.create(project.projectId(), run.id(), "1.0.0");

            // Determinism holds WITH ownership rows present: no wall-clock/random enters the manifest —
            // the persisted checkedAt is stamped as-is, so two exports of the same scan+evidence state
            // are byte-identical.
            assertEquals(first.manifest(), second.manifest());
            assertEquals(first.release().manifestJson(), second.release().manifestJson());
            assertTrue(first.release().manifestJson().contains("\"checkedAt\""));

            // Facts were obtained on both sides, so both bases are VERIFIED — a MISMATCH is authoritative
            // facts too, never demoted to NOT_VERIFIED.
            assertEquals(EvidenceBasis.VERIFIED, entryFor(first, "art/hero.png").evidenceBases().ownership());
            AssetEntry theme = entryFor(first, "audio/theme.wav");
            assertEquals(EvidenceBasis.VERIFIED, theme.evidenceBases().ownership());
            assertEquals(OwnershipOutcome.MISMATCH, theme.ownership().outcome());
        }
    }

    /**
     * The extraction's whole point, asserted rather than argued.
     *
     * <p>A preview is only allowed to be called a preview if it is the same evaluation the persisted
     * release performs. So this compares the two directly on identical state: the manifest bytes are
     * asserted byte-for-byte against what the release actually stored, and the reports are asserted
     * whole — with only {@code evaluatedAt} normalised away, because both stamp their own wall clock
     * and always will (that is the one field a point-in-time check must not share).
     */
    @Test
    void previewEvaluatesTheSameGateTheReleaseDoesOnIdenticalState() throws Exception {
        try (Database database = new Database(directory.resolve("preview-parity.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            // All four violation kinds, so the whole-record comparison below actually covers them:
            // hero carries UNRESOLVED_SOURCE + FLAGGED_WITHOUT_APPROVAL, villain a BLOCKED_DECISION,
            // and outsider an OWNERSHIP_MISMATCH_WITHOUT_DECISION.
            ScanRun run = fixture.persistScan(project, "1.4.0", List.of(
                    asset("art/hero.png", "a", VerificationStatus.SIMILAR, SourceEvidence.unresolved()),
                    asset("art/villain.png", "c", VerificationStatus.CLEAR, resolved()),
                    asset("audio/outsider.wav", "d", VerificationStatus.CLEAR, resolved()),
                    asset("audio/theme.wav", "b", VerificationStatus.CLEAR, resolved())));
            long villainId = assetId(fixture, run, "art/villain.png");
            long outsiderId = assetId(fixture, run, "audio/outsider.wav");
            fixture.decisions.append(villainId, DecisionType.BLOCKED, "Licence expired");
            fixture.ownershipVerifications.insert(outsiderId, 90110L, new OwnershipEvidence(507777826L,
                    OwnershipEvidence.TYPE_USER, 7L, "Animation", "Approved", OwnershipEvidence.TYPE_GROUP,
                    295182L, null, OwnershipOutcome.MISMATCH, Instant.parse("2026-07-24T12:30:00Z")));

            GatePreview preview = fixture.service.preview(project.projectId(), run.id());
            ReleaseBundle bundle = fixture.service.create(project.projectId(), run.id(), run.releaseName());

            assertEquals(new ManifestJson().write(bundle.manifest()),
                    new ManifestJson().write(preview.manifest()),
                    "the preview's manifest is not byte-identical to the one the release persisted");
            // Against the persisted bytes too, not only the in-memory object. Stripped because
            // ReleaseRepository.insert runs the manifest through requireText, so the row loses the
            // trailing newline ManifestJson.write appends — a storage detail, not a difference.
            assertEquals(bundle.release().manifestJson(),
                    new ManifestJson().write(preview.manifest()).strip());
            assertEquals(withEvaluatedAt(bundle.report(), preview.report().evaluatedAt()), preview.report(),
                    "the preview's report differs from the release's beyond its own timestamp");
            assertEquals(run.releaseName(), preview.releaseName());
            assertEquals(run.id(), preview.scanRunId());

            // The gate copies the manifest's project block into its Report, so a differently-named
            // release yields a report differing in project() alone. What preview relies on is that
            // the VERDICT is name-independent — assert that directly rather than trusting the
            // sentence in preview()'s javadoc.
            ReleaseBundle renamed = fixture.service.create(project.projectId(), run.id(), "9.9.9-renamed");
            assertEquals(preview.report().passed(), renamed.report().passed());
            assertEquals(preview.report().summary(), renamed.report().summary());
            assertEquals(preview.report().violations(), renamed.report().violations());

            // And it tracks state, rather than caching the first answer: resolving everything
            // standing against the three assets flips the same preview to passed. APPROVED
            // supersedes villain's BLOCKED and clears outsider's ownership lead.
            long heroId = assetId(fixture, run, "art/hero.png");
            fixture.scans.appendEvidence(heroId,
                    new SourceEvidence("Commission contract", "Owned", "https://example.test/hero"));
            fixture.decisions.append(heroId, DecisionType.APPROVED, "Contract verified");
            fixture.decisions.append(villainId, DecisionType.APPROVED, "Licence renewed");
            fixture.decisions.append(outsiderId, DecisionType.APPROVED, "Studio confirmed the rights");

            GatePreview after = fixture.service.preview(project.projectId(), run.id());
            assertTrue(after.report().passed());
            assertEquals(0, after.report().summary().violations());
        }
    }

    /**
     * A preview writes nothing. That is not a nicety: today the only way to re-check a BLOCKED
     * release is to build another one, and {@code createInTransaction} reads
     * {@code releases.latestForProject} as the diff baseline — so every throwaway build becomes the
     * comparison baseline and the rollback target the workspace renders for the next real release.
     */
    @Test
    void previewInsertsNoReleaseRowAndAppendsNoAuditEvent() throws Exception {
        try (Database database = new Database(directory.resolve("preview-persists-nothing.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);
            ScanRun run = fixture.persistScan(project, "1.0.0", List.of(
                    asset("art/hero.png", "a", VerificationStatus.SIMILAR, SourceEvidence.unresolved())));

            ReleaseBundle baseline = fixture.service.create(project.projectId(), run.id(), "1.0.0");
            int releasesBefore = fixture.releases.forProject(project.projectId()).size();
            int auditBefore = fixture.audit.forScan(run.id()).size();

            for (int attempt = 0; attempt < 5; attempt++) {
                assertFalse(fixture.service.preview(project.projectId(), run.id()).report().passed());
            }

            assertEquals(releasesBefore, fixture.releases.forProject(project.projectId()).size());
            assertEquals(auditBefore, fixture.audit.forScan(run.id()).size());
            // The baseline the NEXT real release diffs against is still the last real release, which
            // is what five throwaway builds would have destroyed.
            assertEquals(baseline.release().id(),
                    fixture.releases.latestForProject(project.projectId()).orElseThrow().id());
            assertEquals(baseline.release().id(),
                    fixture.service.create(project.projectId(), run.id(), "1.0.1")
                            .comparison().previousReleaseId());
        }
    }

    @Test
    void previewRefusesARunThatIsNotACompletedImmutableScan() throws Exception {
        try (Database database = new Database(directory.resolve("preview-preconditions.db"))) {
            Fixture fixture = new Fixture(database);
            LocalProject project = fixture.projects.adopt(directory);

            ScanRun running = fixture.scans.create(project.projectId(), project.root(), "1.0.0",
                    List.of(), List.of("png"));
            fixture.scans.markStarted(running.id());
            IllegalStateException incomplete = assertThrows(IllegalStateException.class,
                    () -> fixture.service.preview(project.projectId(), running.id()));
            assertTrue(incomplete.getMessage().contains("completed immutable scan"), incomplete.getMessage());

            assertThrows(IllegalArgumentException.class,
                    () -> fixture.service.preview(project.projectId(), "no-such-run"));
            assertThrows(IllegalArgumentException.class,
                    () -> fixture.service.preview(project.projectId(), "  "));
        }
    }

    /** Same report, with one field replaced — the only honest way to compare two point-in-time checks. */
    private static ReleaseGate.Report withEvaluatedAt(ReleaseGate.Report report, Instant evaluatedAt) {
        return new ReleaseGate.Report(report.schema(), report.manifestSchema(), report.project(),
                evaluatedAt, report.passed(), report.summary(), report.violations());
    }

    private static AssetEntry entryFor(ReleaseBundle bundle, String path) {
        return bundle.manifest().assets().stream()
                .filter(entry -> entry.path().equals(path)).findFirst().orElseThrow();
    }

    private static long assetId(Fixture fixture, ScanRun run, String relativePath) {
        return fixture.scans.listAllAssets(run.id()).stream()
                .filter(asset -> asset.relativePath().equals(relativePath)).findFirst().orElseThrow().id();
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
        private final OwnershipVerificationRepository ownershipVerifications;
        private final ReleaseExportService service;

        private Fixture(Database database) {
            projects = new LocalProjectRepository(database);
            scans = new ScanRepository(database);
            decisions = new DecisionRepository(database);
            releases = new ReleaseRepository(database);
            audit = new AuditRepository(database);
            ownershipVerifications = new OwnershipVerificationRepository(database);
            service = new ReleaseExportService(database, projects, scans, decisions, releases, audit,
                    ownershipVerifications);
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
