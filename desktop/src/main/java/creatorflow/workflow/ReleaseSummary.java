package creatorflow.workflow;

import java.time.Instant;

/** Lightweight release-list row that intentionally omits potentially large artifact JSON. */
public record ReleaseSummary(String id, String scanRunId, String releaseName, String policyResult,
                             String comparisonJson, Instant createdAt) {
}
