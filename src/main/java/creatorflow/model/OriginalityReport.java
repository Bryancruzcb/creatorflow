package creatorflow.model;

import java.util.List;

/**
 * The full result of running the verification pipeline against one candidate file.
 *
 * @param status    overall verdict (worst match wins: DUPLICATE > SIMILAR > CLEAR)
 * @param matches   every match found, across all layers
 * @param findings  informational notes from metadata inspection (never affect the verdict)
 * @param layersRun which layers actually executed for this file type
 */
public record OriginalityReport(
        VerificationStatus status,
        List<AssetMatch> matches,
        List<String> findings,
        List<String> layersRun) {
}
