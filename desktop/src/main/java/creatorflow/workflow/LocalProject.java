package creatorflow.workflow;

import java.nio.file.Path;
import java.time.Instant;

/** A user-approved local project root; paths are never accepted directly from browser requests. */
public record LocalProject(long projectId, String name, Path root, Instant adoptedAt,
                           String activeScanRunId, String uiStateJson) {
}
