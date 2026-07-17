package creatorflow.workflow;

import java.time.Instant;

/**
 * Lightweight release-list row that intentionally omits potentially large artifact JSON.
 * {@code publishedPlaceVersion} is a self-reported, human declaration of the Roblox place version
 * this release was published as — null until a team records it.
 */
public record ReleaseSummary(String id, String scanRunId, String releaseName, String policyResult,
                             String comparisonJson, Instant createdAt,
                             Long universeId, Long placeId, String experienceName,
                             Long publishedPlaceVersion) {
}
