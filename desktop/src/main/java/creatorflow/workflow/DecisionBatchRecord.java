package creatorflow.workflow;

import java.time.Instant;

/**
 * One human act that wrote the same judgement, with the same written rationale, to several assets.
 *
 * <p>Insert-only, like every other ledger row here. It records what a person did, not what the
 * files are: {@code groupCode} is the {@code ReleaseGate.Code} the group was formed on, and
 * {@code assetCount} is how many records carry this batch's id.
 *
 * <p>The batch never replaces the per-asset rows — each asset still has its own decision (or source
 * evidence) row with its own id and timestamp. This row only says those rows came from one act, so
 * that "N considered reviews" and "one gesture over N files" stop being indistinguishable in the
 * ledger.
 */
public record DecisionBatchRecord(String id, String scanRunId, DecisionBatchKind kind,
                                  String groupCode, String action, String rationale,
                                  int assetCount, Instant createdAt) {
}
