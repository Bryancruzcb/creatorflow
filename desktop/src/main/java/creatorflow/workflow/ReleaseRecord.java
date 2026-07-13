package creatorflow.workflow;

import java.time.Instant;

/** Exact exported manifest and its policy outcome at release time. */
public record ReleaseRecord(String id, String scanRunId, String releaseName, String manifestJson,
                            String policyResult, String reportJson, String comparisonJson,
                            Instant createdAt) {
}
