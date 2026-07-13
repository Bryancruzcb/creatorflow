package creatorflow.workflow;

import java.time.Instant;

/** Append-only human decision. Undo is represented by a later superseding record. */
public record DecisionRecord(String id, long scanAssetId, DecisionType type, String reason,
                             String supersedesDecisionId, Instant createdAt) {
}
