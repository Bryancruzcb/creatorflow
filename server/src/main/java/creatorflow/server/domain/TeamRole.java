package creatorflow.server.domain;

/**
 * A member's authority inside one team. Deliberately two values and no more.
 *
 * <p>This is the <em>only</em> enum the team layer stores, and it is about people, not about
 * work: it says who may mint a join code, remove a member, and retract someone else's claim. It
 * is never a judgement about an animation. Phase E stores no APPROVED/BLOCKED/verdict enum
 * anywhere — see {@link ProvenanceClaim}.
 */
public enum TeamRole {

    /** Can mint join codes, remove members, and retract any claim in the team. */
    OWNER,

    /** Can look up fingerprints, share claims, and retract their own. */
    MEMBER
}
