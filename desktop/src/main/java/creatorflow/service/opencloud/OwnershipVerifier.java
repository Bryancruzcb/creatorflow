package creatorflow.service.opencloud;

import creatorflow.manifest.OwnershipEvidence;
import creatorflow.ownership.GroupMembership;
import creatorflow.ownership.OwnershipOutcome;
import java.io.IOException;
import java.time.Instant;

/**
 * Orchestrates the raw Open Cloud lookups into one {@link OwnershipEvidence} for an animation asset:
 * {@code getAsset} → {@code getUniverse} → group {@code membership} (that last call made ONLY when a
 * user created an asset whose target experience is owned by a group). The obtained facts feed the
 * pure {@link OwnershipOutcome#evaluate} evaluator; the result is stamped with the caller-supplied
 * {@code checkedAt}.
 *
 * <p><strong>Honesty invariants (load-bearing).</strong>
 * <ul>
 *   <li>{@code VERIFIED} (i.e. {@link OwnershipEvidence#verified()}) means authoritative facts were
 *       obtained — it is true for both {@code MATCH} and {@code MISMATCH}, never for a failure.</li>
 *   <li>A {@code MISMATCH} is only ever produced from facts that were actually obtained (a creator
 *       who is provably neither the owner nor a member of the owning group). A lookup that
 *       <em>failed</em> is not proof of non-membership, so any client failure short-circuits to
 *       {@code UNVERIFIABLE} — it must never be read as a {@code MISMATCH}.</li>
 *   <li>Every non-rate-limit failure ({@link OpenCloudException} for a 4xx/5xx, or a raw
 *       {@link IOException} network error) is folded into an {@code UNVERIFIABLE} evidence carrying
 *       whatever facts <em>were</em> obtained before the failure — never a thrown exception, never a
 *       false {@code VERIFIED}.</li>
 *   <li>Group membership is a tri-state {@link GroupMembership}, never a nullable rank. A member
 *       whose rank could not be resolved is a {@code MATCH} with an absent rank — only an
 *       <em>observed</em> absence from the membership listing may yield a {@code MISMATCH}.</li>
 *   <li>A 429 {@link RateLimitedException} is transient and is <em>propagated</em> so the caller can
 *       surface a distinct "rate-limited, try again" rather than a generic unverifiable result.</li>
 *   <li>A non-{@code Animation} asset type never yields a {@code MATCH}: the id does not point at the
 *       animation we mean to verify, so the facts are recorded and the outcome stays
 *       {@code UNVERIFIABLE}.</li>
 * </ul>
 *
 * <p>This is the desktop orchestration seam; it never touches the manifest and only calls the
 * network through {@link OpenCloudClient}. The one live-call site is the bridge route (a later
 * task); export reads persisted rows and never constructs this class.
 */
public final class OwnershipVerifier {

    /** The exact Open Cloud {@code assetType} for an animation (Task 0 spike note). */
    static final String ANIMATION_ASSET_TYPE = "Animation";

    private final OpenCloudGateway gateway;

    /** Production entry point: verify through the real Open Cloud client. */
    public OwnershipVerifier(OpenCloudClient client) {
        this(new ClientGateway(client));
    }

    /** Test seam: drive the decision tree against an in-memory {@link OpenCloudGateway} fake. */
    OwnershipVerifier(OpenCloudGateway gateway) {
        this.gateway = gateway;
    }

    /**
     * Verify who created {@code robloxAssetId} against who owns the experience {@code universeId},
     * returning a fully-populated {@link OwnershipEvidence} stamped with {@code now}.
     *
     * @param robloxAssetId the animation asset id to check — always human-supplied (nothing in a
     *     scanned file identifies a Roblox asset), which is why the returned evidence records
     *     {@link OwnershipEvidence#ASSET_ID_DECLARED_BY_USER} as its linkage provenance
     * @param universeId the bound experience's universe id
     * @param now the point-in-time this verification is performed; stamped verbatim into
     *     {@link OwnershipEvidence#checkedAt()} (no wall clock is read here, keeping the caller in
     *     control of determinism)
     * @return the evidence — {@code MATCH}/{@code MISMATCH} when facts were obtained, otherwise
     *     {@code UNVERIFIABLE} with whatever partial facts were gathered
     * @throws RateLimitedException when Open Cloud returned 429 at any call; the caller reports it
     *     distinctly. No other failure escapes — all are folded into an {@code UNVERIFIABLE} result.
     */
    public OwnershipEvidence verify(long robloxAssetId, long universeId, Instant now)
            throws RateLimitedException {

        // ---- 1. the asset: creator identity, type, moderation ----
        OpenCloudClient.AssetInfo asset;
        try {
            asset = gateway.getAsset(robloxAssetId);
        } catch (RateLimitedException e) {
            throw e; // transient — let the caller prompt a retry
        } catch (IOException e) {
            // No facts obtained at all: an honest unknown, never a false verification.
            return unverifiable(robloxAssetId, null, null, null, null, null, null, now);
        }

        String creatorType = asset.creatorType();
        Long creatorId = asset.creatorId();
        String assetType = asset.assetType();
        String moderationState = asset.moderationState();

        // Only real animations are in scope. A wrong-typed id must never produce a MATCH — record the
        // facts we have and stop at UNVERIFIABLE without even looking up the experience owner.
        if (!isAnimation(assetType)) {
            return unverifiable(robloxAssetId, creatorType, creatorId, assetType, moderationState, null, null, now);
        }

        // ---- 2. the experience owner ----
        OpenCloudClient.UniverseOwner owner;
        try {
            owner = gateway.getUniverse(universeId);
        } catch (RateLimitedException e) {
            throw e;
        } catch (IOException e) {
            return unverifiable(robloxAssetId, creatorType, creatorId, assetType, moderationState, null, null, now);
        }

        String ownerType = owner.ownerType();
        Long ownerId = owner.ownerId();

        // ---- 3. group membership: ONLY when a user created an asset for a group-owned experience ----
        GroupMembership membership = null;
        if (OwnershipOutcome.TYPE_USER.equals(creatorType)
                && OwnershipOutcome.TYPE_GROUP.equals(ownerType)
                && creatorId != null && ownerId != null) {
            try {
                membership = gateway.groupMembership(ownerId, creatorId);
            } catch (RateLimitedException e) {
                throw e;
            } catch (IOException e) {
                // A failed membership lookup is NOT proof of non-membership. If we let evaluate() see
                // no membership fact it would stay UNVERIFIABLE anyway; short-circuiting here keeps
                // that explicit. Either way it must never read as MISMATCH.
                return unverifiable(robloxAssetId, creatorType, creatorId, assetType, moderationState, ownerType, ownerId, now);
            }
        }

        // The rank is a stored fact, not a gate: a member whose rank we could not resolve is still a
        // MATCH, recorded with an absent rank rather than a fabricated one.
        Integer memberRank = membership == null ? null : membership.rank();
        OwnershipOutcome outcome =
                OwnershipOutcome.evaluate(creatorType, creatorId, ownerType, ownerId, membership);
        // The facts above are CreatorFlow's own; the id they are about arrived from a person typing
        // it into the ownership panel, and that provenance is recorded next to them so no consumer
        // can read "who owns animation N" as "this file is animation N, and you own it".
        return new OwnershipEvidence(robloxAssetId, OwnershipEvidence.ASSET_ID_DECLARED_BY_USER,
                creatorType, creatorId, assetType, moderationState, ownerType, ownerId, memberRank,
                outcome, now);
    }

    private static boolean isAnimation(String assetType) {
        return ANIMATION_ASSET_TYPE.equalsIgnoreCase(assetType);
    }

    /**
     * Build an {@code UNVERIFIABLE} evidence carrying whatever facts were obtained. {@code memberRank}
     * is always {@code null} on this path — every failure short-circuits before (or during) the
     * membership lookup, so no rank was ever resolved.
     */
    private static OwnershipEvidence unverifiable(Long robloxAssetId, String creatorType, Long creatorId,
            String assetType, String moderationState, String ownerType, Long ownerId, Instant now) {
        return new OwnershipEvidence(robloxAssetId, creatorType, creatorId, assetType, moderationState,
                ownerType, ownerId, null, OwnershipOutcome.UNVERIFIABLE, now);
    }

    /** Adapts the concrete (and {@code final}) {@link OpenCloudClient} to the {@link OpenCloudGateway} seam. */
    private record ClientGateway(OpenCloudClient client) implements OpenCloudGateway {

        @Override
        public OpenCloudClient.AssetInfo getAsset(long assetId) throws IOException {
            return client.getAsset(assetId);
        }

        @Override
        public OpenCloudClient.UniverseOwner getUniverse(long universeId) throws IOException {
            return client.getUniverse(universeId);
        }

        @Override
        public GroupMembership groupMembership(long groupId, long userId) throws IOException {
            return client.groupMembership(groupId, userId);
        }
    }
}
