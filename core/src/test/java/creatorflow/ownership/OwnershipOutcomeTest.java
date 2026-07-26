package creatorflow.ownership;

import static creatorflow.ownership.OwnershipOutcome.TYPE_GROUP;
import static creatorflow.ownership.OwnershipOutcome.TYPE_USER;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.manifest.OwnershipEvidence;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * Full truth table for the pure {@link OwnershipOutcome#evaluate} evaluator, the tri-state
 * {@link GroupMembership} it consumes, plus the {@link OwnershipEvidence} value type's
 * {@code verified()} rule and {@code unchecked()} factory.
 *
 * <p>The load-bearing row: a member whose rank could not be resolved is a {@code MATCH}, never the
 * {@code MISMATCH} that an observed absence produces.
 *
 * <p>No I/O anywhere in this test — the evaluator is a pure function of its inputs.
 */
class OwnershipOutcomeTest {

    // --- same-identity matches ---

    @Test
    void userCreatorEqualsUserOwnerIsMatch() {
        assertEquals(OwnershipOutcome.MATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 82914L, TYPE_USER, 82914L, null));
    }

    @Test
    void groupCreatorEqualsGroupOwnerIsMatch() {
        assertEquals(OwnershipOutcome.MATCH,
                OwnershipOutcome.evaluate(TYPE_GROUP, 295182L, TYPE_GROUP, 295182L, null));
    }

    // --- mismatched identities of the same type ---

    @Test
    void userCreatorDiffersFromUserOwnerIsMismatch() {
        assertEquals(OwnershipOutcome.MISMATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_USER, 2L, null));
    }

    @Test
    void groupCreatorDiffersFromGroupOwnerIsMismatch() {
        assertEquals(OwnershipOutcome.MISMATCH,
                OwnershipOutcome.evaluate(TYPE_GROUP, 100L, TYPE_GROUP, 200L, null));
    }

    // --- user creator, group owner: membership decides ---

    @Test
    void userCreatorInOwningGroupIsMatchRegardlessOfRank() {
        assertEquals(OwnershipOutcome.MATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_GROUP, 295182L, GroupMembership.rankKnown(255)));
        assertEquals(OwnershipOutcome.MATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_GROUP, 295182L, GroupMembership.rankKnown(1)));
    }

    @Test
    void userCreatorInOwningGroupWithRankZeroIsStillMatch() {
        // Rank 0 (e.g. the default "Guest" role) is a real membership fact, not an absent one.
        // Integer 0 must not be treated as falsy/absent.
        assertEquals(OwnershipOutcome.MATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_GROUP, 295182L, GroupMembership.rankKnown(0)));
    }

    @Test
    void userCreatorIsMemberWithUnresolvedRankIsMatchNeverMismatch() {
        // The membership entry was observed; only its RANK could not be resolved. Reporting that as
        // a MISMATCH would be a false, authoritative accusation against a real group member.
        assertEquals(OwnershipOutcome.MATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_GROUP, 295182L, GroupMembership.rankUnknown()));
    }

    @Test
    void userCreatorObservedAbsentFromOwningGroupIsMismatch() {
        // Only an OBSERVED absence (an empty memberships list) may lead to the MISMATCH review lead.
        assertEquals(OwnershipOutcome.MISMATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_GROUP, 295182L, GroupMembership.notAMember()));
    }

    @Test
    void noMembershipFactOnTheGroupPathIsUnverifiableNotMismatch() {
        // No lookup happened at all, so nothing is known. Absence of evidence must not become
        // evidence of absence.
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_GROUP, 295182L, null));
    }

    // --- group creator, user owner: a group cannot be "a member" of a user, so this is always a mismatch ---

    @Test
    void groupCreatorWithUserOwnerIsMismatch() {
        assertEquals(OwnershipOutcome.MISMATCH,
                OwnershipOutcome.evaluate(TYPE_GROUP, 295182L, TYPE_USER, 82914L, null));
    }

    // --- missing/unknown facts => UNVERIFIABLE, never a false MATCH/MISMATCH ---

    @Test
    void nullCreatorTypeIsUnverifiable() {
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(null, 1L, TYPE_USER, 1L, null));
    }

    @Test
    void nullCreatorIdIsUnverifiable() {
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(TYPE_USER, null, TYPE_USER, 1L, null));
    }

    @Test
    void nullOwnerTypeIsUnverifiable() {
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, null, 1L, null));
    }

    @Test
    void nullOwnerIdIsUnverifiable() {
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_USER, null, null));
    }

    @Test
    void allMissingFactsIsUnverifiable() {
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(null, null, null, null, null));
    }

    @Test
    void unrecognizedIdentityTypeIsUnverifiableNotAFalseMismatch() {
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate("ROBOT", 1L, TYPE_USER, 1L, null));
        assertEquals(OwnershipOutcome.UNVERIFIABLE,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, "ROBOT", 1L, null));
    }

    // --- memberRank is only consulted for the user-creator/group-owner path ---

    @Test
    void memberRankIsIgnoredWhenTypesAlreadyMatchDirectly() {
        // A stray membership fact must not flip a same-type mismatch into a match.
        assertEquals(OwnershipOutcome.MISMATCH,
                OwnershipOutcome.evaluate(TYPE_USER, 1L, TYPE_USER, 2L, GroupMembership.rankKnown(5)));
    }

    // --- GroupMembership: the tri-state itself ---

    @Test
    void groupMembershipDistinguishesAbsenceFromAnUnresolvedRank() {
        GroupMembership absent = GroupMembership.notAMember();
        GroupMembership unresolved = GroupMembership.rankUnknown();
        GroupMembership known = GroupMembership.rankKnown(150);

        assertFalse(absent.isMember(), "an observed absence is the only non-membership");
        assertTrue(unresolved.isMember(), "an unresolved rank is still an observed membership");
        assertTrue(known.isMember());

        assertNull(absent.rank());
        assertNull(unresolved.rank(), "no rank may be fabricated when it could not be resolved");
        assertEquals(150, known.rank());

        assertEquals(GroupMembership.Status.NOT_A_MEMBER, absent.status());
        assertEquals(GroupMembership.Status.MEMBER_RANK_UNKNOWN, unresolved.status());
        assertEquals(GroupMembership.Status.MEMBER_RANK_KNOWN, known.status());
    }

    @Test
    void groupMembershipRejectsIncoherentStatusAndRankCombinations() {
        assertThrows(IllegalArgumentException.class,
                () -> new GroupMembership(GroupMembership.Status.MEMBER_RANK_KNOWN, null));
        assertThrows(IllegalArgumentException.class,
                () -> new GroupMembership(GroupMembership.Status.MEMBER_RANK_UNKNOWN, 7));
        assertThrows(IllegalArgumentException.class,
                () -> new GroupMembership(GroupMembership.Status.NOT_A_MEMBER, 7));
        assertThrows(NullPointerException.class, () -> new GroupMembership(null, null));
    }

    // --- OwnershipEvidence.verified() ---

    @Test
    void verifiedIsTrueForMatchAndMismatchButFalseForUnverifiable() {
        assertTrue(evidenceWith(OwnershipOutcome.MATCH).verified());
        assertTrue(evidenceWith(OwnershipOutcome.MISMATCH).verified());
        assertFalse(evidenceWith(OwnershipOutcome.UNVERIFIABLE).verified());
    }

    @Test
    void uncheckedIsAllNullWithUnverifiableOutcomeAndNoTimestamp() {
        OwnershipEvidence unchecked = OwnershipEvidence.unchecked();

        assertNull(unchecked.robloxAssetId());
        assertNull(unchecked.creatorType());
        assertNull(unchecked.creatorId());
        assertNull(unchecked.assetType());
        assertNull(unchecked.moderationState());
        assertNull(unchecked.ownerType());
        assertNull(unchecked.ownerId());
        assertNull(unchecked.memberRank());
        assertNull(unchecked.checkedAt());
        assertEquals(OwnershipOutcome.UNVERIFIABLE, unchecked.outcome());
        assertFalse(unchecked.verified());
    }

    @Test
    void storesTheMemberRankFactOnTheEvidenceRecordForFutureTightening() {
        OwnershipEvidence evidence = new OwnershipEvidence(
                507766388L, TYPE_USER, 1L, "Animation", "Approved",
                TYPE_GROUP, 295182L, 42, OwnershipOutcome.MATCH, Instant.parse("2026-07-23T00:00:00Z"));

        assertEquals(42, evidence.memberRank());
        assertEquals(OwnershipOutcome.MATCH, evidence.outcome());
        assertTrue(evidence.verified());
    }

    private static OwnershipEvidence evidenceWith(OwnershipOutcome outcome) {
        return new OwnershipEvidence(1L, TYPE_USER, 1L, "Animation", "Approved",
                TYPE_USER, 1L, null, outcome, Instant.parse("2026-07-23T00:00:00Z"));
    }
}
