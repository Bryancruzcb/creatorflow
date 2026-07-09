package creatorflow.model;

/** Outcome of the originality check that runs on every imported asset. */
public enum VerificationStatus {
    CLEAR("Clear", "No matches against the indexed library."),
    SIMILAR("Similar", "Perceptually close to an existing asset; review before publishing."),
    DUPLICATE("Duplicate", "Byte-identical to an existing asset.");

    private final String label;
    private final String summary;

    VerificationStatus(String label, String summary) {
        this.label = label;
        this.summary = summary;
    }

    public String label() {
        return label;
    }

    public String summary() {
        return summary;
    }
}
