package creatorflow.service.registry;

import creatorflow.model.Asset;
import creatorflow.model.VerificationStatus;
import java.io.IOException;
import java.util.List;

/** Optional connection to a shared fingerprint registry. Only fingerprints travel, never files. */
public interface RegistryClient {

    record RemoteMatch(long assetId, String fileName, String owner, String layer, int distance, String note) {
    }

    record RemoteVerdict(VerificationStatus verdict, List<RemoteMatch> matches) {
    }

    boolean isConfigured();

    RemoteVerdict verify(String fileName, String sha256, Long dHash, Long pHash, Long audioFp) throws IOException;

    void register(Asset asset) throws IOException;

    static RegistryClient disabled() {
        return new RegistryClient() {
            @Override
            public boolean isConfigured() {
                return false;
            }

            @Override
            public RemoteVerdict verify(String fileName, String sha256, Long dHash, Long pHash, Long audioFp) {
                throw new IllegalStateException("registry not configured");
            }

            @Override
            public void register(Asset asset) {
                throw new IllegalStateException("registry not configured");
            }
        };
    }
}
