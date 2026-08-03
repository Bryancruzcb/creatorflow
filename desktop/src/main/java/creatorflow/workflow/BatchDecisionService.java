package creatorflow.workflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionBatchRepository;
import creatorflow.db.DecisionRepository;
import creatorflow.db.ScanRepository;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.ReleaseGate;
import creatorflow.workflow.ReviewGroups.ReviewGroup;
import creatorflow.workflow.ReviewGroups.ReviewGroupAsset;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Group review: resolving a same-violation-kind set of assets with one shared, written justification.
 *
 * <p>Two things about this class are load-bearing, and both are refusals.
 *
 * <p><strong>The groups are the gate.</strong> {@link #reviewGroups} runs
 * {@link ReleaseExportService#preview} — the identical evaluation a release performs — and buckets
 * {@code report.violations()} by code. There is no second copy of the gate's predicates here, so the
 * panel and the gate can never disagree about which rows are outstanding.
 *
 * <p><strong>What can be batched is a short, enforced list.</strong> {@code APPROVED} and
 * {@code BLOCKED} are never batchable, in any group, and {@code EXCLUDED} is batchable only on
 * {@code UNRESOLVED_SOURCE}. That is enforced <em>here</em>, on every write, not merely left out of
 * the UI: a disabled control is bypassable by a stale tab or a hand-rolled request, and a bulk
 * "approve these thirty flagged files" is precisely the false-clearance this product exists not to
 * manufacture. {@code BLOCKED_DECISION} offers nothing at all — those assets already carry a
 * deliberate human "no", and superseding thirty of them in one click is the rubber stamp inverted.
 *
 * <p>Every batch is one {@link Database#transaction}: a partially applied batch would be a
 * half-made judgement, and there would be a state in which some assets carry a decision the person's
 * screen never showed them.
 */
public final class BatchDecisionService {

    /**
     * A review-quality cap, not a technical one. {@code MAX_REQUEST_BYTES} would allow several times
     * this; 200 is the number that keeps a batch something a person can actually look at, and the UI
     * says so in those words rather than reporting a limit.
     */
    public static final int MAX_BATCH_ASSETS = 200;

    /** Below this it is a per-file decision, and the per-file form is where it belongs. */
    public static final int MIN_BATCH_ASSETS = 2;

    private final Database database;
    private final ScanRepository scans;
    private final DecisionRepository decisions;
    private final DecisionBatchRepository batches;
    private final AuditRepository audit;
    private final ReleaseExportService releaseExports;
    private final ObjectMapper json = JsonMapper.builder().addModule(new JavaTimeModule()).build();

    public BatchDecisionService(Database database, ScanRepository scans, DecisionRepository decisions,
                                DecisionBatchRepository batches, AuditRepository audit,
                                ReleaseExportService releaseExports) {
        this.database = Objects.requireNonNull(database, "database");
        this.scans = Objects.requireNonNull(scans, "scans");
        this.decisions = Objects.requireNonNull(decisions, "decisions");
        this.batches = Objects.requireNonNull(batches, "batches");
        this.audit = Objects.requireNonNull(audit, "audit");
        this.releaseExports = Objects.requireNonNull(releaseExports, "releaseExports");
    }

    /**
     * One batch act by id, for the marker every affected file carries in its inspector and history.
     *
     * <p>That marker is the honesty payoff of the whole feature: without it, thirty decisions written
     * by one gesture and thirty written by thirty considered reviews are indistinguishable rows. It
     * is served on the ordinary decision and evidence payloads rather than behind a route a client
     * has to know to ask for, so nothing has to opt in to seeing it.
     */
    public java.util.Optional<DecisionBatchRecord> findBatch(String batchId) {
        return batchId == null ? java.util.Optional.empty() : batches.findById(batchId);
    }

    /**
     * What a person can batch on, and what is standing under each rule. Writes nothing.
     *
     * <p>Runs in a transaction because it reads the gate evaluation and then three more ledgers
     * (assets, decisions, evidence) that must describe the same instant — the drift tokens it hands
     * out would otherwise be stale before they were sent.
     */
    public ReviewGroups reviewGroups(long projectId, String scanRunId) {
        return database.transaction(() -> groupsOf(releaseExports.preview(projectId, scanRunId)));
    }

    /**
     * Records one decision per asset, all carrying the same rationale and one shared batch id.
     *
     * <p>Guards run in this order, and every one of them is a 400 except the last: the type
     * allow-list, the size floor and cap, a non-blank rationale, the server-side re-derivation of
     * the group (a request can never smuggle an asset into a group by labelling it), and then the
     * per-asset drift check, which rejects the <em>whole</em> batch with a 409 and writes nothing.
     */
    public DecisionBatchResult recordDecisions(long projectId, String scanRunId, ReleaseGate.Code code,
                                               DecisionType type, String rationale,
                                               List<DecisionBatchEntry> entries) {
        Objects.requireNonNull(code, "code");
        Objects.requireNonNull(type, "type");
        requireBatchableDecision(code, type);
        String reason = requireRationale(rationale);
        requireBatchSize(entries.size());
        return database.transaction(() -> {
            Map<Long, ReviewGroupAsset> group = groupAssets(projectId, scanRunId, code);
            List<ReviewGroupAsset> targets = resolveTargets(group,
                    entries.stream().map(DecisionBatchEntry::scanAssetId).toList());
            List<Long> drifted = new ArrayList<>();
            for (DecisionBatchEntry entry : entries) {
                ReviewGroupAsset asset = group.get(entry.scanAssetId());
                if (!Objects.equals(asset.latestDecisionId(), entry.supersedesDecisionId())) {
                    drifted.add(entry.scanAssetId());
                }
            }
            if (!drifted.isEmpty()) {
                throw new BatchDriftException("The decision on "
                        + (drifted.size() == 1 ? "one of these files" : drifted.size() + " of these files")
                        + " changed since this group was loaded, so nothing was recorded. Reload the"
                        + " group and check those files before batching them.", drifted);
            }
            DecisionBatchRecord batch = batches.insert(scanRunId, DecisionBatchKind.DECISION,
                    code.name(), type.name(), reason, targets.size());
            List<DecisionRecord> written = new ArrayList<>(entries.size());
            for (DecisionBatchEntry entry : entries) {
                written.add(decisions.appendInBatch(entry.scanAssetId(), type, reason,
                        entry.supersedesDecisionId(), batch.id()));
            }
            audit.append(scanRunId, "DECISION_BATCH_RECORDED", auditPayload(batch));
            return new DecisionBatchResult(batch, List.copyOf(written));
        });
    }

    /**
     * Records the same source/license declaration against several assets, with one shared batch id.
     *
     * <p>The rationale is required here too, and it is not decoration: the source/license pair is the
     * declaration, but the claim the tool cannot check is that <em>these</em> files share it. Forcing
     * that sentence is the only guardrail on the uniformity claim.
     *
     * <p>Drift is checked against each asset's latest evidence row rather than a decision, because
     * {@code source_evidence} has no supersedes column and "newest wins" would otherwise silently
     * clobber a different source somebody recorded meanwhile.
     */
    public SourceEvidenceBatchResult recordSourceEvidence(long projectId, String scanRunId,
                                                          ReleaseGate.Code code, String source,
                                                          String license, String evidenceUrl,
                                                          String rationale,
                                                          List<SourceEvidenceBatchEntry> entries) {
        Objects.requireNonNull(code, "code");
        requireBatchableAction(code, "SOURCE_EVIDENCE");
        String cleanSource = requireDeclaration(source, "source");
        String cleanLicense = requireDeclaration(license, "license");
        String reason = requireRationale(rationale);
        requireBatchSize(entries.size());
        SourceEvidence declaration = new SourceEvidence(cleanSource, cleanLicense,
                evidenceUrl == null || evidenceUrl.isBlank() ? null : evidenceUrl.strip());
        return database.transaction(() -> {
            Map<Long, ReviewGroupAsset> group = groupAssets(projectId, scanRunId, code);
            List<ReviewGroupAsset> targets = resolveTargets(group,
                    entries.stream().map(SourceEvidenceBatchEntry::scanAssetId).toList());
            List<Long> drifted = new ArrayList<>();
            for (SourceEvidenceBatchEntry entry : entries) {
                ReviewGroupAsset asset = group.get(entry.scanAssetId());
                if (!Objects.equals(asset.latestSourceEvidenceId(), entry.latestSourceEvidenceId())) {
                    drifted.add(entry.scanAssetId());
                }
            }
            if (!drifted.isEmpty()) {
                throw new BatchDriftException("The source record on "
                        + (drifted.size() == 1 ? "one of these files" : drifted.size() + " of these files")
                        + " changed since this group was loaded, so nothing was recorded. Reload the"
                        + " group and check those files before batching them.", drifted);
            }
            DecisionBatchRecord batch = batches.insert(scanRunId, DecisionBatchKind.SOURCE_EVIDENCE,
                    code.name(), "SOURCE_EVIDENCE", reason, targets.size());
            List<SourceEvidenceRecord> written = new ArrayList<>(entries.size());
            for (SourceEvidenceBatchEntry entry : entries) {
                written.add(scans.appendEvidence(entry.scanAssetId(), declaration, batch.id()));
            }
            audit.append(scanRunId, "SOURCE_EVIDENCE_BATCH_RECORDED", auditPayload(batch));
            return new SourceEvidenceBatchResult(batch, List.copyOf(written));
        });
    }

    /**
     * What may be batched under each gate rule, and the only place that answer is written down.
     *
     * <ul>
     *   <li>{@code UNRESOLVED_SOURCE} — a shared source declaration (the honest fix), an exclusion
     *       (a scope claim that reduces what ships), or needs-review triage.</li>
     *   <li>{@code FLAGGED_WITHOUT_APPROVAL} / {@code OWNERSHIP_MISMATCH_WITHOUT_DECISION} —
     *       needs-review only. Approving is a per-evidence judgement by nature ("I looked at
     *       <em>this</em> finding"), and excluding here is the closest thing available to making
     *       flags go away in one click, so it is withheld pending an owner decision rather than
     *       shipped with strong copy. Needs-review clears nothing at the gate by construction, which
     *       is exactly why it is safe.</li>
     *   <li>{@code BLOCKED_DECISION} — nothing.</li>
     * </ul>
     */
    public static List<String> batchableActions(ReleaseGate.Code code) {
        return switch (code) {
            case UNRESOLVED_SOURCE -> List.of("SOURCE_EVIDENCE", "EXCLUDED", "NEEDS_REVIEW");
            case FLAGGED_WITHOUT_APPROVAL, OWNERSHIP_MISMATCH_WITHOUT_DECISION -> List.of("NEEDS_REVIEW");
            case BLOCKED_DECISION -> List.of();
        };
    }

    private ReviewGroups groupsOf(GatePreview preview) {
        String runId = preview.scanRunId();
        Map<String, Long> assetIdsByPath = scans.assetIdsByPath(runId);
        Map<Long, ScanAsset> assetsById = new LinkedHashMap<>();
        for (ScanAsset asset : scans.listAllAssets(runId)) assetsById.put(asset.id(), asset);
        Map<Long, DecisionRecord> latestDecisions = decisions.latestForRun(runId);
        Map<Long, SourceEvidenceRecord> latestEvidence = scans.latestEvidenceForRun(runId);

        Map<ReleaseGate.Code, List<ReleaseGate.Violation>> byCode = new EnumMap<>(ReleaseGate.Code.class);
        for (ReleaseGate.Violation violation : preview.report().violations()) {
            byCode.computeIfAbsent(violation.code(), key -> new ArrayList<>()).add(violation);
        }

        List<ReviewGroup> groups = new ArrayList<>();
        // ReleaseGate.Code's own declaration order, so the panel reads in the order the gate
        // evaluates and a reader can trace one to the other.
        for (ReleaseGate.Code code : ReleaseGate.Code.values()) {
            List<ReleaseGate.Violation> violations = byCode.getOrDefault(code, List.of());
            if (violations.isEmpty()) continue;
            List<ReviewGroupAsset> assets = new ArrayList<>(violations.size());
            LinkedHashSet<Long> seen = new LinkedHashSet<>();
            for (ReleaseGate.Violation violation : violations) {
                Long assetId = assetIdsByPath.get(violation.path());
                // An unresolvable path has nothing honest to act on, so it is not offered as a
                // batchable row. It stays visible in the gate check, which reports every violation.
                if (assetId == null || !seen.add(assetId)) continue;
                ScanAsset asset = assetsById.get(assetId);
                if (asset == null) continue;
                DecisionRecord decision = latestDecisions.get(assetId);
                SourceEvidenceRecord evidence = latestEvidence.get(assetId);
                assets.add(new ReviewGroupAsset(asset.id(), asset.relativePath(), asset.fileName(),
                        asset.fileType(), asset.sha256(), asset.verification().name(),
                        decision == null ? "PENDING" : decision.type().name(), violation.message(),
                        decision == null ? null : decision.id(),
                        evidence == null ? null : evidence.id()));
            }
            if (assets.isEmpty()) continue;
            assets.sort(Comparator.comparingLong(ReviewGroupAsset::scanAssetId));
            groups.add(new ReviewGroup(code.name(), violations.getFirst().message(),
                    batchableActions(code), assets));
        }
        return new ReviewGroups(runId, preview.report().passed(), preview.report().evaluatedAt(),
                List.copyOf(groups));
    }

    /**
     * The group as the <em>server</em> currently sees it, keyed by asset id. Re-derived on every
     * write rather than trusted from the request: without this, a request could post arbitrary asset
     * ids under a group label and have them treated as though the gate had put them there.
     */
    private Map<Long, ReviewGroupAsset> groupAssets(long projectId, String scanRunId, ReleaseGate.Code code) {
        ReviewGroups groups = groupsOf(releaseExports.preview(projectId, scanRunId));
        ReviewGroup group = groups.groups().stream()
                .filter(candidate -> candidate.code().equals(code.name()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "No files are standing under that rule on this scan any more"));
        Map<Long, ReviewGroupAsset> byId = new LinkedHashMap<>();
        for (ReviewGroupAsset asset : group.assets()) byId.put(asset.scanAssetId(), asset);
        return byId;
    }

    private static List<ReviewGroupAsset> resolveTargets(Map<Long, ReviewGroupAsset> group, List<Long> requested) {
        LinkedHashSet<Long> unique = new LinkedHashSet<>(requested);
        if (unique.size() != requested.size()) {
            throw new IllegalArgumentException("The same file was listed twice in one batch");
        }
        List<ReviewGroupAsset> targets = new ArrayList<>(requested.size());
        for (Long assetId : requested) {
            ReviewGroupAsset asset = group.get(assetId);
            if (asset == null) {
                throw new IllegalArgumentException(
                        "One of these files is not standing under that rule on this scan, so the batch"
                                + " was not recorded");
            }
            targets.add(asset);
        }
        return targets;
    }

    private static void requireBatchableDecision(ReleaseGate.Code code, DecisionType type) {
        if (type == DecisionType.APPROVED || type == DecisionType.BLOCKED) {
            throw new IllegalArgumentException("APPROVED and BLOCKED are per-file decisions — open the"
                    + " file and record it there");
        }
        requireBatchableAction(code, type.name());
    }

    private static void requireBatchableAction(ReleaseGate.Code code, String action) {
        if (!batchableActions(code).contains(action)) {
            throw new IllegalArgumentException("That action cannot be batched on " + code.name()
                    + " — record it one file at a time");
        }
    }

    private static void requireBatchSize(int size) {
        if (size < MIN_BATCH_ASSETS) {
            throw new IllegalArgumentException("A batch needs at least " + MIN_BATCH_ASSETS
                    + " files — a single file is a per-file decision");
        }
        if (size > MAX_BATCH_ASSETS) {
            throw new IllegalArgumentException("A batch is capped at " + MAX_BATCH_ASSETS
                    + " files so the set stays something a person can actually look at — narrow it and"
                    + " do it in passes");
        }
    }

    private static String requireRationale(String rationale) {
        if (rationale == null || rationale.isBlank()) {
            throw new IllegalArgumentException("A batch needs a written reason these files belong together");
        }
        return rationale.strip();
    }

    private static String requireDeclaration(String value, String label) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("A shared source declaration needs both a source and a"
                    + " license — the gate reads them together, so " + label + " cannot be blank");
        }
        return value.strip();
    }

    private String auditPayload(DecisionBatchRecord batch) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("batchId", batch.id());
        payload.put("kind", batch.kind().name());
        payload.put("groupCode", batch.groupCode());
        payload.put("action", batch.action());
        payload.put("assetCount", batch.assetCount());
        try {
            return json.writeValueAsString(payload);
        } catch (IOException e) {
            throw new IllegalStateException("Could not serialize batch audit payload", e);
        }
    }

    /** One asset in a decision batch, with the decision the client believed was current for it. */
    public record DecisionBatchEntry(long scanAssetId, String supersedesDecisionId) {
    }

    /** One asset in a source-evidence batch, with the evidence row the client believed was current. */
    public record SourceEvidenceBatchEntry(long scanAssetId, Long latestSourceEvidenceId) {
    }

    public record DecisionBatchResult(DecisionBatchRecord batch, List<DecisionRecord> decisions) {
    }

    public record SourceEvidenceBatchResult(DecisionBatchRecord batch, List<SourceEvidenceRecord> evidence) {
    }

    /**
     * Something moved between loading a group and submitting it. Carries the assets that moved so
     * the panel can point at them; the batch as a whole is rejected and nothing is written, because
     * a partly applied batch would leave assets carrying a judgement nobody's screen ever showed.
     */
    public static final class BatchDriftException extends RuntimeException {
        private final List<Long> driftedAssetIds;

        public BatchDriftException(String message, List<Long> driftedAssetIds) {
            super(message);
            this.driftedAssetIds = List.copyOf(driftedAssetIds);
        }

        public List<Long> driftedAssetIds() {
            return driftedAssetIds;
        }
    }
}
