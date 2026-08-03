package creatorflow.workflow;

import java.time.Instant;

/**
 * Provenance/license evidence associated with a specific immutable scan asset.
 *
 * <p>{@code batchId} is null for evidence recorded one file at a time, and carries the
 * {@link DecisionBatchRecord} id when the same source/license pair was declared over several files
 * at once. The declaration stays DECLARED either way — a batch never upgrades what is known about
 * provenance, it only records that one person claimed these files share it.
 */
public record SourceEvidenceRecord(long id, long scanAssetId, String source, String license,
                                   String evidenceUrl, boolean resolved, Instant recordedAt,
                                   String batchId) {
}
