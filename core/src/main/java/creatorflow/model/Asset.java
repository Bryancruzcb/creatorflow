package creatorflow.model;

import java.time.Instant;

/**
 * A file managed by the library, together with the fingerprints and verification
 * verdict computed at import time.
 *
 * <p>Hash fields are nullable: perceptual hashes exist only for decodable images,
 * the audio fingerprint only for supported audio files. {@code findings} holds
 * newline-joined notes from the metadata inspection layer.
 */
public record Asset(
        long id,
        long projectId,
        String fileName,
        String storedPath,
        String fileType,
        long sizeBytes,
        int width,
        int height,
        String sha256,
        Long dHash,
        Long pHash,
        Long audioFp,
        String license,
        boolean ownershipDeclared,
        VerificationStatus status,
        String findings,
        Instant addedAt) {

    public Asset withId(long newId) {
        return new Asset(newId, projectId, fileName, storedPath, fileType, sizeBytes, width, height,
                sha256, dHash, pHash, audioFp, license, ownershipDeclared, status, findings, addedAt);
    }

    public boolean isImage() {
        return width > 0 && height > 0;
    }
}
