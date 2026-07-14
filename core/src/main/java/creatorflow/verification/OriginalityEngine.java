package creatorflow.verification;

import creatorflow.model.Asset;
import creatorflow.model.AssetMatch;
import creatorflow.model.OriginalityReport;
import creatorflow.model.VerificationStatus;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Runs every applicable verification layer against a candidate file and
 * compares the resulting fingerprints with the already-indexed library.
 *
 * <p>Layer order (cheap and exact first):
 * <ol>
 *   <li>SHA-256 — byte-identical duplicates, any file type</li>
 *   <li>dHash + pHash — perceptually similar images (resized, re-encoded, lightly edited)</li>
 *   <li>Energy fingerprint — re-uploaded PCM audio, volume-invariant</li>
 *   <li>Metadata inspection — informational provenance findings, never affects the verdict</li>
 * </ol>
 *
 * <p>The verdict is the worst match found: any exact hash match is DUPLICATE,
 * otherwise any perceptual match within the threshold is SIMILAR, otherwise CLEAR.
 * Detection can prove a conflict; it can never prove originality — which is why
 * imports also record an explicit ownership declaration and license.
 */
public final class OriginalityEngine {

    /** Hamming distance (out of 64) at or below which two fingerprints count as similar. */
    public static final int SIMILARITY_THRESHOLD = 10;

    private static final Set<String> IMAGE_TYPES = Set.of("png", "jpg", "jpeg", "gif", "bmp");
    private static final Set<String> AUDIO_TYPES = Set.of("wav", "aif", "aiff", "au");

    /** Everything the pipeline computed for one candidate file. */
    public record Result(OriginalityReport report, String sha256,
                         Long dHash, Long pHash, Long audioFp, int width, int height) {
    }

    public Result verify(Path file, List<Asset> indexed) throws IOException {
        String fileType = fileType(file);
        List<String> layersRun = new ArrayList<>();
        List<AssetMatch> matches = new ArrayList<>();
        List<String> findings = new ArrayList<>();

        // Layer 1: exact hash
        String sha256 = Sha256.hash(file);
        layersRun.add("SHA-256 exact hash");
        for (Asset other : indexed) {
            if (other.sha256().equals(sha256)) {
                matches.add(new AssetMatch(other.id(), other.fileName(), "sha256", 0,
                        "Byte-identical to “" + other.fileName() + "”"));
            }
        }

        // Layer 2: perceptual image hashes
        Long dHash = null;
        Long pHash = null;
        int width = 0;
        int height = 0;
        if (IMAGE_TYPES.contains(fileType)) {
            BufferedImage image = SafeImageIo.read(file.toFile());
            if (image != null) {
                width = image.getWidth();
                height = image.getHeight();
                dHash = ImageHashes.dHash(image);
                pHash = ImageHashes.pHash(image);
                layersRun.add("Perceptual image hash (dHash + pHash)");
                collectPerceptualMatches(matches, indexed, dHash, pHash);
            } else {
                findings.add("Image could not be decoded; perceptual layer skipped.");
            }
        }

        // Layer 3: audio fingerprint
        Long audioFp = null;
        if (AUDIO_TYPES.contains(fileType)) {
            try {
                audioFp = WavFingerprint.fingerprint(file);
                layersRun.add("Audio energy fingerprint");
                collectAudioMatches(matches, indexed, audioFp);
            } catch (Exception e) {
                findings.add("Audio could not be fingerprinted (" + e.getMessage() + ").");
            }
        }

        // Layer 4: provenance metadata (informational only)
        findings.addAll(MetadataInspector.inspect(file));
        layersRun.add("Embedded metadata inspection");

        VerificationStatus status = verdict(matches);
        return new Result(new OriginalityReport(status, List.copyOf(matches), List.copyOf(findings),
                List.copyOf(layersRun)), sha256, dHash, pHash, audioFp, width, height);
    }

    private void collectPerceptualMatches(List<AssetMatch> matches, List<Asset> indexed,
                                          long dHash, long pHash) {
        for (Asset other : indexed) {
            if (other.dHash() == null || other.pHash() == null) {
                continue;
            }
            if (alreadyMatched(matches, other.id())) {
                continue; // exact duplicates don't need perceptual evidence on top
            }
            int dDist = ImageHashes.hammingDistance(dHash, other.dHash());
            int pDist = ImageHashes.hammingDistance(pHash, other.pHash());
            int best = Math.min(dDist, pDist);
            if (best <= SIMILARITY_THRESHOLD) {
                String layer = pDist <= dDist ? "phash" : "dhash";
                matches.add(new AssetMatch(other.id(), other.fileName(), layer, best,
                        "Visually similar to “" + other.fileName() + "” (distance " + best
                                + "/64 — likely a resized or re-encoded copy)"));
            }
        }
    }

    private void collectAudioMatches(List<AssetMatch> matches, List<Asset> indexed, long audioFp) {
        for (Asset other : indexed) {
            if (other.audioFp() == null || alreadyMatched(matches, other.id())) {
                continue;
            }
            int dist = ImageHashes.hammingDistance(audioFp, other.audioFp());
            if (dist <= SIMILARITY_THRESHOLD) {
                matches.add(new AssetMatch(other.id(), other.fileName(), "audio", dist,
                        "Same energy envelope as “" + other.fileName() + "” (distance " + dist
                                + "/64 — likely the same recording)"));
            }
        }
    }

    private static boolean alreadyMatched(List<AssetMatch> matches, long assetId) {
        return matches.stream().anyMatch(m -> m.matchedAssetId() == assetId);
    }

    private static VerificationStatus verdict(List<AssetMatch> matches) {
        if (matches.stream().anyMatch(m -> "sha256".equals(m.layer()))) {
            return VerificationStatus.DUPLICATE;
        }
        return matches.isEmpty() ? VerificationStatus.CLEAR : VerificationStatus.SIMILAR;
    }

    public static String fileType(Path file) {
        String name = file.getFileName().toString();
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }
}
