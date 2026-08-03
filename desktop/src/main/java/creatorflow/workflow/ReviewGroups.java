package creatorflow.workflow;

import creatorflow.manifest.ReleaseGate;
import java.time.Instant;
import java.util.List;

/**
 * The gate's own violations, grouped by rule, as something a person can act on.
 *
 * <p>These groups <strong>are</strong> the gate: they come from one {@link ReleaseGate#evaluate}
 * call on the manifest a release would have built, with the violations bucketed by
 * {@link ReleaseGate.Code}. No predicate is re-implemented anywhere, so a group review panel cannot
 * offer to fix a set of files the gate disagrees about.
 *
 * <p>{@code evaluatedAt} is the point-in-time stamp of that evaluation, wall-clock, and lives only
 * in this response — nothing here is ever written into an exported artifact.
 */
public record ReviewGroups(String scanRunId, boolean passed, Instant evaluatedAt,
                           List<ReviewGroup> groups) {

    public ReviewGroups {
        groups = List.copyOf(groups);
    }

    /**
     * One rule's worth of outstanding work.
     *
     * <p>{@code batchableActions} is the whole safety surface of this feature, and it is served to
     * the client only so the panel can render honestly — the same table is enforced on every write,
     * so an empty list here is a refusal, not a hidden control.
     *
     * <p>{@code message} is the gate's own sentence for the first asset in the group. It is not
     * always the sentence for every asset: {@code OWNERSHIP_MISMATCH_WITHOUT_DECISION} words itself
     * differently depending on the standing decision, which is why each asset carries its own
     * message too and the panel shows it whenever the two differ.
     */
    public record ReviewGroup(String code, String message, List<String> batchableActions,
                              List<ReviewGroupAsset> assets) {
        public ReviewGroup {
            batchableActions = List.copyOf(batchableActions);
            assets = List.copyOf(assets);
        }
    }

    /**
     * One asset standing in a group, with everything the panel needs to narrow by computed facts
     * (folder, type, identical SHA-256) and everything the server needs to detect drift.
     *
     * <p>{@code latestDecisionId} and {@code latestSourceEvidenceId} are the two "what I was looking
     * at" tokens: a batch request echoes them back, and any mismatch at submit time rejects the
     * whole batch rather than silently clobbering a write someone else made meanwhile.
     *
     * <p>{@code alsoStandingCodes} is the other rules this same file is standing under right now,
     * and it exists because <strong>{@code EXCLUDED} is asset-level at the gate, not
     * per-violation</strong>: {@code ReleaseGate.java:44} skips an excluded asset before the flagged
     * check and before the ownership check, so excluding a file to settle its missing source record
     * would silence its similarity flag too. A file standing anywhere else is therefore refused for
     * batch exclusion — see {@code BatchDecisionService.requireExclusionIsSingleRule} — and this list
     * is what both the refusal and the panel's visible reason are built from. Empty is the ordinary
     * case: the file stands under this rule alone.
     */
    public record ReviewGroupAsset(long scanAssetId, String relativePath, String fileName,
                                   String fileType, String sha256, String verification,
                                   String decision, String message, String latestDecisionId,
                                   Long latestSourceEvidenceId, List<String> alsoStandingCodes) {
        public ReviewGroupAsset {
            alsoStandingCodes = List.copyOf(alsoStandingCodes);
        }
    }
}
