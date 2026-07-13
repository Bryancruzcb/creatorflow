package creatorflow.workflow;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

/** Persisted scan-run status and accounting. */
public record ScanRun(
        String id,
        long projectId,
        Path projectRoot,
        String releaseName,
        List<String> exclusions,
        List<String> supportedFormats,
        ScanState state,
        int discoveredCount,
        int processedCount,
        long bytesProcessed,
        int supportedCount,
        int ignoredCount,
        int excludedCount,
        int unreadableCount,
        int missingDependencyCount,
        int failedCount,
        List<String> warnings,
        String errorMessage,
        Instant createdAt,
        Instant startedAt,
        Instant completedAt) {

    public ScanRun {
        exclusions = List.copyOf(exclusions);
        supportedFormats = List.copyOf(supportedFormats);
        warnings = List.copyOf(warnings);
    }
}
