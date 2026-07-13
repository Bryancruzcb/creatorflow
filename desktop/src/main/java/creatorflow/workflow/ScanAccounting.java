package creatorflow.workflow;

/** Final scanner accounting, including non-asset files and recoverable failures. */
public record ScanAccounting(int supported, int ignored, int excluded, int unreadable,
                             int missingDependencies, int failed, long bytesProcessed) {

    public static ScanAccounting empty() {
        return new ScanAccounting(0, 0, 0, 0, 0, 0, 0);
    }
}
