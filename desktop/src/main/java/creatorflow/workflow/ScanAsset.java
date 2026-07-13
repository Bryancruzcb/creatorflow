package creatorflow.workflow;

import creatorflow.model.VerificationStatus;
import java.util.List;

/** Immutable asset evidence captured by one scan run. */
public record ScanAsset(
        long id,
        String scanRunId,
        int ordinal,
        String relativePath,
        String fileName,
        String fileType,
        long sizeBytes,
        String sha256,
        int width,
        int height,
        String dHash,
        String pHash,
        String audioFingerprint,
        VerificationStatus verification,
        List<String> findings) {

    public ScanAsset {
        findings = List.copyOf(findings);
    }
}
