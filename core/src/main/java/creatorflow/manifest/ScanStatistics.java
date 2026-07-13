package creatorflow.manifest;

/** Terminal counters for one scan run. Excluded counts pruned paths, not their descendants. */
public record ScanStatistics(
        int supported,
        int ignored,
        int excluded,
        int unreadable,
        int missingDependencies,
        int failed,
        long bytesProcessed) {

    public ScanStatistics {
        if (supported < 0 || ignored < 0 || excluded < 0 || unreadable < 0
                || missingDependencies < 0 || failed < 0 || bytesProcessed < 0) {
            throw new IllegalArgumentException("scan statistics cannot be negative");
        }
    }
}
