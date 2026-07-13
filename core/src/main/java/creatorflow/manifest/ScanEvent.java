package creatorflow.manifest;

import java.time.Instant;
import java.util.Objects;

/** A serializable, monotonically sequenced project-scan progress event. */
public record ScanEvent(
        long sequence,
        String runId,
        Instant timestamp,
        Type type,
        long processedFiles,
        long discoveredFiles,
        long bytesProcessed,
        String currentRelativePath,
        String warning,
        String error) {

    public enum Type {
        STARTED,
        DISCOVERED,
        FILE_STARTED,
        FILE_COMPLETED,
        FILE_SKIPPED,
        WARNING,
        ERROR,
        CANCELLED,
        COMPLETED
    }

    public ScanEvent {
        if (sequence < 1) throw new IllegalArgumentException("sequence must be positive");
        runId = requireText(runId, "runId");
        timestamp = Objects.requireNonNull(timestamp, "timestamp");
        type = Objects.requireNonNull(type, "type");
        if (processedFiles < 0 || discoveredFiles < 0 || bytesProcessed < 0) {
            throw new IllegalArgumentException("scan progress counters cannot be negative");
        }
        currentRelativePath = cleanOptional(currentRelativePath);
        warning = cleanOptional(warning);
        error = cleanOptional(error);
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }

    private static String cleanOptional(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }
}
