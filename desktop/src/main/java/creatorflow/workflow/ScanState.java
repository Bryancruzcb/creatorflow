package creatorflow.workflow;

/** Durable lifecycle for an immutable project scan. */
public enum ScanState {
    QUEUED,
    RUNNING,
    CANCELLATION_REQUESTED,
    CANCELLED,
    COMPLETED,
    FAILED;

    public boolean terminal() {
        return this == CANCELLED || this == COMPLETED || this == FAILED;
    }
}
