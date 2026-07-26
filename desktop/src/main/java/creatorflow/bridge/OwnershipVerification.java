package creatorflow.bridge;

import creatorflow.manifest.OwnershipEvidence;
import creatorflow.service.opencloud.RateLimitedException;
import java.time.Instant;

/**
 * The one operation the bridge's verify-ownership route needs: turn an animation asset id plus the
 * bound experience's universe id into an {@link OwnershipEvidence} stamped at {@code now}.
 *
 * <p>Extracted as a seam so the route can be driven by a fake in {@code LocalBridgeServerTest}
 * without a live Open Cloud call. Production wires a
 * {@link creatorflow.service.opencloud.OwnershipVerifier} method reference
 * ({@code verifier::verify}); the concrete verifier owns the real decision tree and the only live
 * HTTP client. This mirrors the concrete signature exactly, {@code throws RateLimitedException} and
 * all, so the transient 429 case propagates to the route (which surfaces it distinctly) rather than
 * being folded into an {@code UNVERIFIABLE}.
 */
@FunctionalInterface
public interface OwnershipVerification {

    /**
     * @param robloxAssetId the animation asset id to check
     * @param universeId the bound experience's universe id
     * @param now the point-in-time to stamp into {@link OwnershipEvidence#checkedAt()}
     * @return the evidence — {@code MATCH}/{@code MISMATCH} when facts were obtained, otherwise
     *     {@code UNVERIFIABLE} with whatever partial facts were gathered
     * @throws RateLimitedException when Open Cloud returned 429; the route reports it as a 429
     */
    OwnershipEvidence verify(long robloxAssetId, long universeId, Instant now) throws RateLimitedException;
}
