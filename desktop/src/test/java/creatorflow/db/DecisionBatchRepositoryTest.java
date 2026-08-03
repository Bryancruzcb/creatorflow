package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.VerificationStatus;
import creatorflow.workflow.DecisionBatchKind;
import creatorflow.workflow.DecisionBatchRecord;
import creatorflow.workflow.DecisionType;
import creatorflow.workflow.ScanAccounting;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DecisionBatchRepositoryTest {

    @TempDir
    Path directory;

    /**
     * The shape the whole feature rests on: N assets, N decision rows, one batch row.
     *
     * <p>A single row covering many assets would be smaller and would break {@code latestFor} — but
     * more importantly it would make "one judgement" and "one record" the same thing, which is the
     * conflation the batch id exists to disclose rather than create.
     */
    @Test
    void aBatchLabelsPerAssetRowsRatherThanReplacingThem() {
        try (Database database = new Database(directory.resolve("batches.db"))) {
            var localProjects = new LocalProjectRepository(database);
            var scans = new ScanRepository(database);
            var decisions = new DecisionRepository(database);
            var batches = new DecisionBatchRepository(database);
            List<Long> assetIds = seed(localProjects, scans);
            String runId = scans.findAsset(assetIds.getFirst()).orElseThrow().scanRunId();

            DecisionBatchRecord batch = batches.insert(runId, DecisionBatchKind.DECISION,
                    "UNRESOLVED_SOURCE", "NEEDS_REVIEW", "All three are placeholder concepts.", 3);
            for (long assetId : assetIds) {
                decisions.appendInBatch(assetId, DecisionType.NEEDS_REVIEW,
                        "All three are placeholder concepts.", null, batch.id());
            }

            assertEquals(3, batch.assetCount());
            assertEquals(batch, batches.findById(batch.id()).orElseThrow());
            assertEquals(List.of(batch), batches.forRun(runId));
            for (long assetId : assetIds) {
                var history = decisions.historyFor(assetId);
                assertEquals(1, history.size(), "every asset keeps its own row");
                assertEquals(batch.id(), history.getFirst().batchId());
                // The rationale is stored verbatim; the batch id carries the "this was a batch" fact
                // structurally rather than by decorating a person's own sentence.
                assertEquals("All three are placeholder concepts.", history.getFirst().reason());
            }

            // A per-file decision recorded afterwards is not retroactively part of anything.
            var single = decisions.append(assetIds.getFirst(), DecisionType.APPROVED, "Checked alone");
            assertEquals(null, single.batchId());
            assertEquals(single.id(), decisions.latestFor(assetIds.getFirst()).orElseThrow().id());
        }
    }

    /** The rationale is the guardrail, so the column refuses a blank one as well as the route. */
    @Test
    void aBatchCannotBeRecordedWithoutAWrittenReason() {
        try (Database database = new Database(directory.resolve("blank.db"))) {
            var localProjects = new LocalProjectRepository(database);
            var scans = new ScanRepository(database);
            var batches = new DecisionBatchRepository(database);
            List<Long> assetIds = seed(localProjects, scans);
            String runId = scans.findAsset(assetIds.getFirst()).orElseThrow().scanRunId();

            assertThrows(IllegalArgumentException.class, () -> batches.insert(runId,
                    DecisionBatchKind.DECISION, "UNRESOLVED_SOURCE", "NEEDS_REVIEW", "   ", 2));
            assertTrue(batches.forRun(runId).isEmpty());
        }
    }

    private List<Long> seed(LocalProjectRepository localProjects, ScanRepository scans) {
        long projectId = localProjects.adopt(directory).projectId();
        var run = scans.create(projectId, directory, "1.0.0", List.of(), List.of("rbxm"));
        scans.markStarted(run.id());
        List<AssetEntry> assets = List.of(entry(1), entry(2), entry(3));
        CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project("proj", "1.0.0"), Instant.now(),
                new CreativeManifest.Summary(3, 3, 0, 0, 3, 3), assets);
        scans.complete(run.id(), manifest, new ScanAccounting(3, 0, 0, 0, 0, 0, 384), List.of());
        return scans.listAssets(run.id(), 10, 0).stream().map(asset -> asset.id()).toList();
    }

    private static AssetEntry entry(int index) {
        return new AssetEntry("art/asset-" + index + ".rbxm", "asset-" + index + ".rbxm", "rbxm", 128,
                String.format("%064x", index), 64, 64, new Fingerprints("01", "02", null),
                VerificationStatus.CLEAR, new SourceEvidence(null, null, null),
                ReleaseDecision.PENDING, List.of(), List.of());
    }
}
