package creatorflow.service.opencloud;

import java.io.IOException;
import java.util.Optional;

/**
 * The narrow subset of {@link OpenCloudClient} operations that {@link OwnershipVerifier} depends on.
 *
 * <p>Extracting it as a seam lets the verifier's decision tree be tested against an in-memory fake —
 * exercising every branch (match, mismatch, rate-limit, error, not-an-animation) without a live API
 * or an HTTP stub, and without re-testing the HTTP parsing that {@code OpenCloudClientTest} already
 * covers. Production wiring passes a real {@link OpenCloudClient}, which {@link OwnershipVerifier}
 * adapts internally; tests pass a fake.
 *
 * <p>Package-private on purpose: this is an internal test seam, not part of the public surface. The
 * three methods mirror {@link OpenCloudClient} exactly, {@code throws IOException} and all — an
 * {@link OpenCloudException} (or its {@link RateLimitedException} subtype) flows through the same
 * contract as a raw network failure.
 */
interface OpenCloudGateway {

    OpenCloudClient.AssetInfo getAsset(long assetId) throws IOException;

    OpenCloudClient.UniverseOwner getUniverse(long universeId) throws IOException;

    Optional<Integer> groupMemberRank(long groupId, long userId) throws IOException;
}
