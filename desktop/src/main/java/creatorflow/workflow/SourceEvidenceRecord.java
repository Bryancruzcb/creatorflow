package creatorflow.workflow;

import java.time.Instant;

/** Provenance/license evidence associated with a specific immutable scan asset. */
public record SourceEvidenceRecord(long id, long scanAssetId, String source, String license,
                                   String evidenceUrl, boolean resolved, Instant recordedAt) {
}
