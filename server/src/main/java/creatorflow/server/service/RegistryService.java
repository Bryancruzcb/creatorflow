package creatorflow.server.service;

import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.verification.ImageHashes;
import creatorflow.verification.OriginalityEngine;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Cross-account fingerprint matching — the same layers and threshold as the
 * desktop engine ({@code creatorflow-core}), applied to the shared registry.
 *
 * <p>Matching is a linear scan, which is fine at portfolio scale; the
 * production path is a BK-tree / ANN index over the fingerprints.
 */
@Service
public class RegistryService {

    public record Fingerprints(String fileName, String sha256, Long dHash, Long pHash, Long audioFp) {
    }

    public record Match(long assetId, String fileName, String owner, String layer, int distance, String note) {
    }

    public record Verdict(String verdict, List<Match> matches) {
    }

    private final RegisteredAssetRepository assets;

    public RegistryService(RegisteredAssetRepository assets) {
        this.assets = assets;
    }

    @Transactional(readOnly = true)
    public Verdict verify(Fingerprints fp, UserAccount requester) {
        List<Match> matches = new ArrayList<>();
        boolean exact = false;

        for (RegisteredAsset other : assets.findAll()) {
            String ownerNote = other.getOwner().getId().equals(requester.getId())
                    ? other.getOwner().getUsername() + " (you)"
                    : other.getOwner().getUsername();

            if (other.getSha256().equalsIgnoreCase(fp.sha256())) {
                exact = true;
                matches.add(new Match(other.getId(), other.getFileName(), other.getOwner().getUsername(),
                        "sha256", 0,
                        "Byte-identical to “" + other.getFileName() + "” registered by " + ownerNote));
                continue;
            }

            if (fp.dHash() != null && fp.pHash() != null
                    && other.getDHash() != null && other.getPHash() != null) {
                int dDist = ImageHashes.hammingDistance(fp.dHash(), other.getDHash());
                int pDist = ImageHashes.hammingDistance(fp.pHash(), other.getPHash());
                int best = Math.min(dDist, pDist);
                if (best <= OriginalityEngine.SIMILARITY_THRESHOLD) {
                    matches.add(new Match(other.getId(), other.getFileName(),
                            other.getOwner().getUsername(),
                            pDist <= dDist ? "phash" : "dhash", best,
                            "Visually similar to “" + other.getFileName() + "” registered by "
                                    + ownerNote + " (distance " + best + "/64)"));
                    continue;
                }
            }

            if (fp.audioFp() != null && other.getAudioFp() != null) {
                int dist = ImageHashes.hammingDistance(fp.audioFp(), other.getAudioFp());
                if (dist <= OriginalityEngine.SIMILARITY_THRESHOLD) {
                    matches.add(new Match(other.getId(), other.getFileName(),
                            other.getOwner().getUsername(), "audio", dist,
                            "Same energy envelope as “" + other.getFileName() + "” registered by "
                                    + ownerNote + " (distance " + dist + "/64)"));
                }
            }
        }

        String verdict = exact ? "DUPLICATE" : matches.isEmpty() ? "CLEAR" : "SIMILAR";
        return new Verdict(verdict, matches);
    }
}
