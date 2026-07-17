package creatorflow.workflow;

import java.time.Instant;

/**
 * Exact exported manifest and its policy outcome at release time.
 * {@code universeId}/{@code placeId}/{@code experienceName} are stamped from the project's
 * declared intended experience at release time, if it was bound; otherwise all null.
 */
public record ReleaseRecord(String id, String scanRunId, String releaseName, String manifestJson,
                            String policyResult, String reportJson, String comparisonJson,
                            Instant createdAt, Long universeId, Long placeId, String experienceName) {
}
