package creatorflow.workflow;

import java.time.Instant;

/**
 * Exact exported manifest and its policy outcome at release time.
 * {@code universeId}/{@code placeId}/{@code experienceName} are stamped from the project's
 * declared intended experience at release time, if it was bound; otherwise all null.
 * {@code publishedPlaceVersion} is set later, after export, when a team records the Roblox place
 * version they published this release as. It is a human declaration only — CreatorFlow does not
 * verify it against Roblox — and is null until recorded.
 */
public record ReleaseRecord(String id, String scanRunId, String releaseName, String manifestJson,
                            String policyResult, String reportJson, String comparisonJson,
                            Instant createdAt, Long universeId, Long placeId, String experienceName,
                            Long publishedPlaceVersion) {
}
