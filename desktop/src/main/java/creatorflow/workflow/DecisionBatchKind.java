package creatorflow.workflow;

/** Which ledger a batch wrote into. Stored in {@code decision_batches.kind}. */
public enum DecisionBatchKind {
    DECISION,
    SOURCE_EVIDENCE
}
