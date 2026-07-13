package creatorflow.workflow;

/** Searchable evidence item derived from verification findings or a concrete match. */
public record ScanFinding(long id, long scanAssetId, String code, String severity, String message,
                          Integer matchedAssetOrdinal, String matchLayer, Integer matchDistance) {
}
