package creatorflow.manifest;

/** A recoverable path-level problem encountered while scanning. */
public record ScanProblem(String path, Code code, String message) {

    public enum Code {
        EXCLUDED,
        UNREADABLE,
        MISSING_DEPENDENCY,
        SOURCE_RESOLUTION,
        FAILED
    }

    public ScanProblem {
        path = path == null || path.isBlank() ? null : path.strip();
        if (code == null) throw new NullPointerException("code");
        if (message == null || message.isBlank()) throw new IllegalArgumentException("message is required");
        message = message.strip();
    }
}
