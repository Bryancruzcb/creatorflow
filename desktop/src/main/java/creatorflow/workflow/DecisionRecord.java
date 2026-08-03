package creatorflow.workflow;

import java.time.Instant;

/**
 * Append-only human decision. Undo is represented by a later superseding record.
 *
 * <p>{@code batchId} is null for a decision recorded one file at a time, and carries the
 * {@link DecisionBatchRecord} id when this row was written as part of a batch act. Null means "not
 * part of a batch", never "unknown": every row written before batches existed is genuinely not one.
 * The row is otherwise identical to a hand-made one — same shape, own id, own timestamp — because
 * that is what it is; the id only says how it came to be recorded.
 */
public record DecisionRecord(String id, long scanAssetId, DecisionType type, String reason,
                             String supersedesDecisionId, Instant createdAt, String batchId) {
}
