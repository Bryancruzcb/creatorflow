package creatorflow.service.opencloud;

import static creatorflow.ownership.OwnershipOutcome.MATCH;
import static creatorflow.ownership.OwnershipOutcome.MISMATCH;
import static creatorflow.ownership.OwnershipOutcome.UNVERIFIABLE;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.OwnershipEvidence;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * {@link OwnershipVerifier} orchestrates the raw Open Cloud calls into one {@link OwnershipEvidence}.
 * These tests inject an in-memory fake {@link OpenCloudGateway} (never a live API, never an HTTP
 * stub) and walk the full decision tree: user/user MATCH, group/group MATCH, user-in-owning-group
 * MATCH (with rank), user-not-in-group MISMATCH, cross-user MISMATCH, and every honesty guard —
 * a getAsset error, a getUniverse error, a membership error, a not-an-Animation asset, and a 429 —
 * must NEVER produce a false VERIFIED/MATCH. 429 propagates distinctly; every other failure folds
 * to UNVERIFIABLE while keeping whatever facts were obtained.
 */
class OwnershipVerifierTest {

    private static final long ASSET_ID = 507766388L;
    private static final long UNIVERSE_ID = 90110L;
    private static final long USER = 82914L;
    private static final long GROUP = 295182L;
    private static final Instant NOW = Instant.parse("2026-07-23T12:00:00Z");

    private final FakeGateway gateway = new FakeGateway();

    private OwnershipVerifier verifier() {
        return new OwnershipVerifier(gateway);
    }

    private static OpenCloudClient.AssetInfo animationBy(String creatorType, Long creatorId) {
        return new OpenCloudClient.AssetInfo(creatorType, creatorId, "Animation", "Approved", "Active");
    }

    // ---- MATCH paths ------------------------------------------------------------------------

    @Test
    void matchingUserCreatorAndOwnerYieldsMatchWithFactsAndNoMembershipCall() throws Exception {
        gateway.asset = animationBy("USER", USER);
        gateway.universe = new OpenCloudClient.UniverseOwner("USER", USER);

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(MATCH, e.outcome());
        assertTrue(e.verified());
        assertEquals(ASSET_ID, e.robloxAssetId());
        assertEquals("USER", e.creatorType());
        assertEquals(USER, e.creatorId());
        assertEquals("USER", e.ownerType());
        assertEquals(USER, e.ownerId());
        assertEquals("Animation", e.assetType());
        assertEquals("Approved", e.moderationState());
        assertNull(e.memberRank());
        assertEquals(NOW, e.checkedAt());
        assertEquals(1, gateway.assetCalls);
        assertEquals(1, gateway.universeCalls);
        assertEquals(0, gateway.membershipCalls, "identity match needs no membership lookup");
    }

    @Test
    void groupCreatorEqualsGroupOwnerMatchesWithoutMembershipCall() throws Exception {
        gateway.asset = animationBy("GROUP", GROUP);
        gateway.universe = new OpenCloudClient.UniverseOwner("GROUP", GROUP);

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(MATCH, e.outcome());
        assertEquals("GROUP", e.creatorType());
        assertEquals("GROUP", e.ownerType());
        assertNull(e.memberRank());
        assertEquals(0, gateway.membershipCalls, "a group cannot be a member of itself; no lookup");
    }

    @Test
    void userCreatorInsideOwningGroupMatchesAndPersistsRank() throws Exception {
        gateway.asset = animationBy("USER", USER);
        gateway.universe = new OpenCloudClient.UniverseOwner("GROUP", GROUP);
        gateway.membership = Optional.of(150);

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(MATCH, e.outcome());
        assertTrue(e.verified());
        assertEquals(150, e.memberRank(), "the member's rank is persisted for future policy tightening");
        assertEquals(1, gateway.membershipCalls);
        assertEquals(GROUP, gateway.membershipGroupId, "membership is checked against the owning group");
        assertEquals(USER, gateway.membershipUserId, "membership is checked for the creating user");
    }

    // ---- MISMATCH paths (facts obtained, they just don't line up) ---------------------------

    @Test
    void userCreatorNotInOwningGroupIsMismatchNotUnverifiable() throws Exception {
        gateway.asset = animationBy("USER", USER);
        gateway.universe = new OpenCloudClient.UniverseOwner("GROUP", GROUP);
        gateway.membership = Optional.empty(); // confirmed NOT a member (an empty list, not an error)

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(MISMATCH, e.outcome());
        assertTrue(e.verified(), "a confirmed non-membership is still an obtained fact");
        assertNull(e.memberRank());
        assertEquals(1, gateway.membershipCalls);
    }

    @Test
    void differentUsersAreMismatch() throws Exception {
        gateway.asset = animationBy("USER", 111L);
        gateway.universe = new OpenCloudClient.UniverseOwner("USER", 222L);

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(MISMATCH, e.outcome());
        assertEquals(0, gateway.membershipCalls);
    }

    // ---- UNVERIFIABLE guards (never a false VERIFIED) ---------------------------------------

    @Test
    void getAssetErrorYieldsUnverifiableWithNullFactsAndSkipsUniverse() throws Exception {
        gateway.assetError = new OpenCloudException(404, "AssetId 999 is not found");

        OwnershipEvidence e = verifier().verify(999L, UNIVERSE_ID, NOW);

        assertEquals(UNVERIFIABLE, e.outcome());
        assertFalse(e.verified());
        assertEquals(999L, e.robloxAssetId(), "we still record which asset we tried to check");
        assertNull(e.creatorType());
        assertNull(e.creatorId());
        assertNull(e.assetType());
        assertNull(e.moderationState());
        assertNull(e.ownerType());
        assertNull(e.ownerId());
        assertNull(e.memberRank());
        assertEquals(NOW, e.checkedAt());
        assertEquals(0, gateway.universeCalls, "no point looking up the owner if the asset failed");
    }

    @Test
    void getUniverseErrorKeepsAssetFactsButStaysUnverifiable() throws Exception {
        gateway.asset = animationBy("USER", USER);
        gateway.universeError = new OpenCloudException(403, "no scope");

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(UNVERIFIABLE, e.outcome());
        assertFalse(e.verified());
        assertEquals("USER", e.creatorType());
        assertEquals(USER, e.creatorId());
        assertEquals("Animation", e.assetType());
        assertEquals("Approved", e.moderationState());
        assertNull(e.ownerType());
        assertNull(e.ownerId());
        assertEquals(NOW, e.checkedAt());
    }

    @Test
    void membershipErrorIsUnverifiableNotMismatch() throws Exception {
        gateway.asset = animationBy("USER", USER);
        gateway.universe = new OpenCloudClient.UniverseOwner("GROUP", GROUP);
        gateway.membershipError = new OpenCloudException(500, "boom");

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(UNVERIFIABLE, e.outcome(),
                "a failed membership lookup is NOT proof of non-membership, so it must not read as MISMATCH");
        assertFalse(e.verified());
        assertEquals("GROUP", e.ownerType());
        assertEquals(GROUP, e.ownerId());
        assertNull(e.memberRank());
        assertEquals(1, gateway.membershipCalls);
    }

    @Test
    void notAnAnimationIsUnverifiableRecordsFactsAndSkipsUniverse() throws Exception {
        gateway.asset = new OpenCloudClient.AssetInfo("USER", USER, "Model", "Approved", "Active");
        gateway.universe = new OpenCloudClient.UniverseOwner("USER", USER); // would MATCH, but must never be consulted

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, NOW);

        assertEquals(UNVERIFIABLE, e.outcome(), "a mis-typed asset id must never yield a MATCH");
        assertFalse(e.verified());
        assertEquals("Model", e.assetType(), "the observed asset type is recorded as a fact");
        assertEquals("USER", e.creatorType());
        assertEquals(USER, e.creatorId());
        assertEquals("Approved", e.moderationState());
        assertNull(e.ownerType());
        assertNull(e.ownerId());
        assertEquals(NOW, e.checkedAt());
        assertEquals(0, gateway.universeCalls);
        assertEquals(0, gateway.membershipCalls);
    }

    // ---- 429: propagates distinctly at every call site --------------------------------------

    @Test
    void rateLimitOnGetAssetPropagatesWithStatusAndRetryAfter() {
        gateway.assetError = new RateLimitedException("slow down", Duration.ofSeconds(30));

        RateLimitedException ex = assertThrows(RateLimitedException.class,
                () -> verifier().verify(ASSET_ID, UNIVERSE_ID, NOW));

        assertEquals(429, ex.status());
        assertEquals(Duration.ofSeconds(30), ex.retryAfter());
    }

    @Test
    void rateLimitOnGetUniversePropagates() {
        gateway.asset = animationBy("USER", USER);
        gateway.universeError = new RateLimitedException("slow down", null);

        assertThrows(RateLimitedException.class, () -> verifier().verify(ASSET_ID, UNIVERSE_ID, NOW));
    }

    @Test
    void rateLimitOnMembershipPropagates() {
        gateway.asset = animationBy("USER", USER);
        gateway.universe = new OpenCloudClient.UniverseOwner("GROUP", GROUP);
        gateway.membershipError = new RateLimitedException("slow down", null);

        assertThrows(RateLimitedException.class, () -> verifier().verify(ASSET_ID, UNIVERSE_ID, NOW));
    }

    // ---- checkedAt stamping -----------------------------------------------------------------

    @Test
    void checkedAtIsExactlyTheProvidedInstant() throws Exception {
        gateway.asset = animationBy("USER", USER);
        gateway.universe = new OpenCloudClient.UniverseOwner("USER", USER);
        Instant custom = Instant.parse("2026-01-02T03:04:05Z");

        OwnershipEvidence e = verifier().verify(ASSET_ID, UNIVERSE_ID, custom);

        assertEquals(custom, e.checkedAt(), "the caller-supplied clock, not wall time, is stamped");
    }

    /**
     * In-memory {@link OpenCloudGateway}. Each method returns its configured value, or throws its
     * configured {@link IOException} (an {@link OpenCloudException}/{@link RateLimitedException} in
     * these tests) when set. Call counts and the membership arguments are recorded so tests can
     * assert the call order and that membership is looked up only when needed.
     */
    private static final class FakeGateway implements OpenCloudGateway {
        OpenCloudClient.AssetInfo asset;
        IOException assetError;
        OpenCloudClient.UniverseOwner universe;
        IOException universeError;
        Optional<Integer> membership = Optional.empty();
        IOException membershipError;

        int assetCalls;
        int universeCalls;
        int membershipCalls;
        long membershipGroupId;
        long membershipUserId;

        @Override
        public OpenCloudClient.AssetInfo getAsset(long assetId) throws IOException {
            assetCalls++;
            if (assetError != null) {
                throw assetError;
            }
            return asset;
        }

        @Override
        public OpenCloudClient.UniverseOwner getUniverse(long universeId) throws IOException {
            universeCalls++;
            if (universeError != null) {
                throw universeError;
            }
            return universe;
        }

        @Override
        public Optional<Integer> groupMemberRank(long groupId, long userId) throws IOException {
            membershipCalls++;
            membershipGroupId = groupId;
            membershipUserId = userId;
            if (membershipError != null) {
                throw membershipError;
            }
            return membership;
        }
    }
}
