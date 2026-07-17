package creatorflow.workflow;

import java.nio.file.Path;
import java.time.Instant;

/**
 * A user-approved local project root; paths are never accepted directly from browser requests.
 * {@code universeId}/{@code placeId}/{@code experienceName} are an optional, user-declared
 * intended Roblox experience binding — a human declaration, not a verified fact — and are
 * either all null (unbound) or all populated.
 */
public record LocalProject(long projectId, String name, Path root, Instant adoptedAt,
                           String activeScanRunId, String uiStateJson,
                           Long universeId, Long placeId, String experienceName) {
}
