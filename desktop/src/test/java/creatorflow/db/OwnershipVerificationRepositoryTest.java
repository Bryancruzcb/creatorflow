package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.OwnershipEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
import creatorflow.workflow.OwnershipVerificationRecord;
import creatorflow.workflow.ScanAccounting;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class OwnershipVerificationRepositoryTest {

    private static final long UNIVERSE_ID = 90110L;

    @TempDir
    Path directory;

    /**
     * The ledger may only carry columns production code actually writes. {@code raw_response_json}
     * was a column (and a record component) whose javadoc claimed the upstream body was "captured
     * for audit" while no writer ever populated it — an audit promise the schema could not back.
     * A column with no writer is a false claim waiting to be believed, so the shape is pinned here.
     */
    @Test
    void theLedgerCarriesOnlyColumnsProductionCodeActuallyWrites() throws Exception {
        try (Database database = new Database(directory.resolve("columns.db"))) {
            List<String> columns = new java.util.ArrayList<>();
            try (var statement = database.connection().createStatement();
                 var result = statement.executeQuery("PRAGMA table_info(ownership_verifications)")) {
                while (result.next()) {
                    columns.add(result.getString("name"));
                }
            }
            assertEquals(List.of("id", "scan_asset_id", "roblox_asset_id", "universe_id",
                            "creator_type", "creator_id", "asset_type", "moderation_state",
                            "owner_type", "owner_id", "member_rank", "outcome", "checked_at"),
                    columns);
        }
    }

    @Test
    void insertAndLatestForAssetRoundTripEveryFactIncludingNulls() {
        try (Database database = new Database(directory.resolve("ownership.db"))) {
            var scans = new ScanRepository(database);
            var verifications = new OwnershipVerificationRepository(database);
            String runId = seedRun(database, scans, "art/hero.rbxm");
            long scanAssetId = scans.listAssets(runId, 10, 0).getFirst().id();

            Instant checkedAt = Instant.parse("2026-07-24T12:00:00Z");
            OwnershipEvidence match = new OwnershipEvidence(507766388L, OwnershipEvidence.TYPE_USER, 42L,
                    "Animation", "Approved", OwnershipEvidence.TYPE_USER, 42L, null,
                    OwnershipOutcome.MATCH, checkedAt);
            OwnershipVerificationRecord inserted = verifications.insert(scanAssetId, UNIVERSE_ID, match);

            OwnershipVerificationRecord loaded = verifications.latestForAsset(scanAssetId).orElseThrow();
            assertEquals(inserted.id(), loaded.id());
            assertEquals(scanAssetId, loaded.scanAssetId());
            assertEquals(507766388L, loaded.robloxAssetId());
            assertEquals(UNIVERSE_ID, loaded.universeId());
            assertEquals(OwnershipEvidence.TYPE_USER, loaded.creatorType());
            assertEquals(42L, loaded.creatorId());
            assertEquals("Animation", loaded.assetType());
            assertEquals("Approved", loaded.moderationState());
            assertEquals(OwnershipEvidence.TYPE_USER, loaded.ownerType());
            assertEquals(42L, loaded.ownerId());
            assertNull(loaded.memberRank());
            assertEquals(OwnershipOutcome.MATCH, loaded.outcome());
            assertEquals(checkedAt, loaded.checkedAt());
        }
    }

    @Test
    void persistsAGroupMembershipRankAndTheUnverifiableAllNullShape() {
        try (Database database = new Database(directory.resolve("facts.db"))) {
            var scans = new ScanRepository(database);
            var verifications = new OwnershipVerificationRepository(database);
            String runId = seedRun(database, scans, "art/walk.rbxm");
            long scanAssetId = scans.listAssets(runId, 10, 0).getFirst().id();

            Instant early = Instant.parse("2026-07-24T09:00:00Z");
            verifications.insert(scanAssetId, UNIVERSE_ID, new OwnershipEvidence(123L, null, null, null, null,
                    null, null, null, OwnershipOutcome.UNVERIFIABLE, early));
            OwnershipVerificationRecord unverifiable = verifications.latestForAsset(scanAssetId).orElseThrow();
            assertEquals(OwnershipOutcome.UNVERIFIABLE, unverifiable.outcome());
            assertNull(unverifiable.creatorType());
            assertNull(unverifiable.creatorId());
            assertNull(unverifiable.ownerType());
            assertNull(unverifiable.ownerId());
            assertNull(unverifiable.memberRank());
            assertNull(unverifiable.assetType());
            assertNull(unverifiable.moderationState());

            Instant later = Instant.parse("2026-07-24T10:00:00Z");
            verifications.insert(scanAssetId, UNIVERSE_ID, new OwnershipEvidence(999L, OwnershipEvidence.TYPE_USER,
                    7L, "Animation", "Approved", OwnershipEvidence.TYPE_GROUP, 295182L, 12,
                    OwnershipOutcome.MATCH, later));

            OwnershipVerificationRecord latest = verifications.latestForAsset(scanAssetId).orElseThrow();
            assertEquals(OwnershipOutcome.MATCH, latest.outcome());
            assertEquals(OwnershipEvidence.TYPE_USER, latest.creatorType());
            assertEquals(OwnershipEvidence.TYPE_GROUP, latest.ownerType());
            assertEquals(295182L, latest.ownerId());
            assertEquals(12, latest.memberRank());
        }
    }

    @Test
    void latestForAssetBreaksCheckedAtTiesOnInsertionOrder() {
        try (Database database = new Database(directory.resolve("tiebreak.db"))) {
            var scans = new ScanRepository(database);
            var verifications = new OwnershipVerificationRepository(database);
            String runId = seedRun(database, scans, "art/idle.rbxm");
            long scanAssetId = scans.listAssets(runId, 10, 0).getFirst().id();

            // Two verifications stamped at the identical instant: latestForAsset must deterministically
            // return the one inserted LAST (the most recent observation), never an arbitrary row.
            Instant tied = Instant.parse("2026-07-24T00:00:00Z");
            verifications.insert(scanAssetId, UNIVERSE_ID, new OwnershipEvidence(500L, OwnershipEvidence.TYPE_USER,
                    1L, "Animation", "Approved", OwnershipEvidence.TYPE_USER, 2L, null,
                    OwnershipOutcome.MISMATCH, tied));
            verifications.insert(scanAssetId, UNIVERSE_ID, new OwnershipEvidence(500L, OwnershipEvidence.TYPE_USER,
                    2L, "Animation", "Approved", OwnershipEvidence.TYPE_USER, 2L, null,
                    OwnershipOutcome.MATCH, tied));

            assertEquals(OwnershipOutcome.MATCH, verifications.latestForAsset(scanAssetId).orElseThrow().outcome());
        }
    }

    @Test
    void latestForRunReturnsOneLatestRowPerAsset() {
        try (Database database = new Database(directory.resolve("run.db"))) {
            var scans = new ScanRepository(database);
            var verifications = new OwnershipVerificationRepository(database);
            String runId = seedRun(database, scans, "art/a.rbxm", "art/b.rbxm");
            List<Long> assetIds = scans.listAssets(runId, 10, 0).stream().map(a -> a.id()).toList();
            long assetA = assetIds.get(0);
            long assetB = assetIds.get(1);

            // Asset A: verified twice (older UNVERIFIABLE, newer MATCH) — the newer must win.
            verifications.insert(assetA, UNIVERSE_ID, new OwnershipEvidence(11L, null, null, null, null,
                    null, null, null, OwnershipOutcome.UNVERIFIABLE, Instant.parse("2026-07-24T08:00:00Z")));
            verifications.insert(assetA, UNIVERSE_ID, new OwnershipEvidence(11L, OwnershipEvidence.TYPE_USER,
                    5L, "Animation", "Approved", OwnershipEvidence.TYPE_USER, 5L, null,
                    OwnershipOutcome.MATCH, Instant.parse("2026-07-24T09:00:00Z")));
            // Asset B: verified once.
            verifications.insert(assetB, UNIVERSE_ID, new OwnershipEvidence(22L, OwnershipEvidence.TYPE_USER,
                    6L, "Animation", "Approved", OwnershipEvidence.TYPE_USER, 7L, null,
                    OwnershipOutcome.MISMATCH, Instant.parse("2026-07-24T09:30:00Z")));

            Map<Long, OwnershipVerificationRecord> latest = verifications.latestForRun(runId);
            assertEquals(2, latest.size());
            assertEquals(OwnershipOutcome.MATCH, latest.get(assetA).outcome());
            assertEquals(5L, latest.get(assetA).creatorId());
            assertEquals(OwnershipOutcome.MISMATCH, latest.get(assetB).outcome());
        }
    }

    @Test
    void insertRejectsEvidenceMissingRequiredFacts() {
        try (Database database = new Database(directory.resolve("reject.db"))) {
            var scans = new ScanRepository(database);
            var verifications = new OwnershipVerificationRepository(database);
            String runId = seedRun(database, scans, "art/x.rbxm");
            long scanAssetId = scans.listAssets(runId, 10, 0).getFirst().id();

            // unchecked() has a null roblox asset id — there is nothing that was actually checked to persist.
            assertThrows(IllegalArgumentException.class,
                    () -> verifications.insert(scanAssetId, UNIVERSE_ID, OwnershipEvidence.unchecked()));
            // A verification with no timestamp cannot be a point-in-time observation.
            OwnershipEvidence noTimestamp = new OwnershipEvidence(1L, OwnershipEvidence.TYPE_USER, 1L,
                    "Animation", "Approved", OwnershipEvidence.TYPE_USER, 1L, null, OwnershipOutcome.MATCH, null);
            assertThrows(IllegalArgumentException.class,
                    () -> verifications.insert(scanAssetId, UNIVERSE_ID, noTimestamp));
        }
    }

    @Test
    void verificationsSurviveRestartAndCascadeWithTheProject() throws Exception {
        Path file = directory.resolve("cascade.db");
        long scanAssetId;
        long projectId;
        try (Database database = new Database(file)) {
            var localProjects = new LocalProjectRepository(database);
            var scans = new ScanRepository(database);
            var verifications = new OwnershipVerificationRepository(database);
            projectId = localProjects.adopt(directory).projectId();
            String runId = seedRun(projectId, database, scans, "art/keep.rbxm");
            scanAssetId = scans.listAssets(runId, 10, 0).getFirst().id();
            verifications.insert(scanAssetId, UNIVERSE_ID, new OwnershipEvidence(77L, OwnershipEvidence.TYPE_GROUP,
                    3L, "Animation", "Approved", OwnershipEvidence.TYPE_GROUP, 3L, null,
                    OwnershipOutcome.MATCH, Instant.parse("2026-07-24T11:00:00Z")));
        }

        try (Database reopened = new Database(file)) {
            var verifications = new OwnershipVerificationRepository(reopened);
            OwnershipVerificationRecord survived = verifications.latestForAsset(scanAssetId).orElseThrow();
            assertEquals(OwnershipOutcome.MATCH, survived.outcome());

            try (var statement = reopened.connection().prepareStatement("DELETE FROM projects WHERE id = ?")) {
                statement.setLong(1, projectId);
                assertEquals(1, statement.executeUpdate());
            }
            assertTrue(verifications.latestForAsset(scanAssetId).isEmpty());
        }
    }

    private String seedRun(Database database, ScanRepository scans, String... relativePaths) {
        long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
        return seedRun(projectId, database, scans, relativePaths);
    }

    private String seedRun(long projectId, Database database, ScanRepository scans, String... relativePaths) {
        var run = scans.create(projectId, directory, "1.0.0", List.of("node_modules"), List.of("rbxm"));
        scans.markStarted(run.id());
        List<AssetEntry> assets = new java.util.ArrayList<>();
        char fill = 'a';
        for (String path : relativePaths) {
            String fileName = path.substring(path.lastIndexOf('/') + 1);
            assets.add(new AssetEntry(path, fileName, "rbxm", 128,
                    String.valueOf(fill).repeat(64), 64, 64, new Fingerprints("01", "02", null),
                    VerificationStatus.CLEAR, new SourceEvidence(null, null, null),
                    ReleaseDecision.PENDING, List.of(), List.of()));
            fill++;
        }
        CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("proj", "1.0.0"), Instant.now(),
                new CreativeManifest.Summary(assets.size(), assets.size(), 0, 0, assets.size(), assets.size()), assets);
        scans.complete(run.id(), manifest, new ScanAccounting(assets.size(), 0, 0, 0, 0, 0, 128), List.of());
        return run.id();
    }
}
