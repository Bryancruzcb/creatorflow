package creatorflow.workflow;

import java.time.Instant;

/** Last workspace location restored after application restart. */
public record WorkspaceState(Long activeProjectId, String activeScanRunId, Long selectedAssetId,
                             Long selectedFindingId, String filtersJson, String queueJson,
                             Instant updatedAt) {
}
