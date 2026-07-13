package creatorflow.manifest;

import java.util.List;
import java.util.Objects;

/** Completed or cleanly cancelled scan output, including a usable partial manifest. */
public record ScanResult(
        String runId,
        State state,
        CreativeManifest manifest,
        ScanStatistics statistics,
        List<ScanProblem> problems) {

    public enum State {
        COMPLETED,
        CANCELLED
    }

    public ScanResult {
        if (runId == null || runId.isBlank()) throw new IllegalArgumentException("runId is required");
        runId = runId.strip();
        state = Objects.requireNonNull(state, "state");
        manifest = Objects.requireNonNull(manifest, "manifest");
        statistics = Objects.requireNonNull(statistics, "statistics");
        problems = List.copyOf(problems);
    }
}
