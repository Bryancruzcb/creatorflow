package creatorflow.model;

/**
 * One piece of match evidence produced by a verification layer.
 *
 * @param matchedAssetId  id of the already-indexed asset this candidate matched
 * @param matchedFileName denormalized for display, so reports survive deletions
 * @param layer           which layer produced the match: "sha256", "dhash", "phash" or "audio"
 * @param distance        Hamming distance (0 for exact SHA-256 matches)
 * @param note            human-readable explanation shown in the report
 */
public record AssetMatch(long matchedAssetId, String matchedFileName, String layer, int distance, String note) {
}
