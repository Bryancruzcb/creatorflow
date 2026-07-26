package creatorflow.ownership;

import java.util.Objects;

/**
 * Whether a user is a member of a group — a <strong>tri-state</strong> fact, because "we did not
 * learn their rank" and "they are not a member" are opposite claims and must never collapse into
 * one value.
 *
 * <ul>
 *   <li>{@link Status#NOT_A_MEMBER} — the group's membership listing was read and the user was
 *       <em>observed absent</em> (Open Cloud returns a 200 with an empty {@code groupMemberships}
 *       list, per the Task 0 spike note). This is a positive fact, safe to act on.</li>
 *   <li>{@link Status#MEMBER_RANK_KNOWN} — a membership entry was observed and its role resolved to
 *       a numeric {@link #rank()} (0–255).</li>
 *   <li>{@link Status#MEMBER_RANK_UNKNOWN} — a membership entry <em>was</em> observed, so the user
 *       <strong>is</strong> a member, but the rank could not be resolved (the entry's {@code role}
 *       reference was missing, blank, or an unexpected shape; the role id was absent from the roles
 *       listing; or the paging cap was hit). The spike note records that the membership-entry shape
 *       was never observed live, so this branch is a live risk, not a theoretical one — and a role
 *       deleted between the two calls reproduces it even under the documented shape.</li>
 * </ul>
 *
 * <p><strong>Honesty constraint (load-bearing).</strong> Only {@code NOT_A_MEMBER} may contribute to
 * an {@link OwnershipOutcome#MISMATCH}. {@code MEMBER_RANK_UNKNOWN} is a member — per the locked
 * owner decision that <em>any</em> membership is a match and the rank is merely stored, it yields
 * {@link OwnershipOutcome#MATCH} with an absent rank. Reporting an unresolved rank as
 * non-membership would be a false, authoritative accusation against a real group member.
 *
 * <p>A pure value type: no I/O, no clock. The desktop module populates it from Open Cloud.
 *
 * @param status which of the three membership facts was established
 * @param rank the member's numeric group rank; non-{@code null} exactly when {@code status} is
 *     {@link Status#MEMBER_RANK_KNOWN}
 */
public record GroupMembership(Status status, Integer rank) {

    /** The three distinguishable membership facts. See {@link GroupMembership}. */
    public enum Status {
        /** The membership listing was read and the user was observed absent from it. */
        NOT_A_MEMBER,
        /** A membership entry was observed and its role resolved to a numeric rank. */
        MEMBER_RANK_KNOWN,
        /** A membership entry was observed; the rank could not be resolved. Still a member. */
        MEMBER_RANK_UNKNOWN
    }

    private static final GroupMembership ABSENT = new GroupMembership(Status.NOT_A_MEMBER, null);
    private static final GroupMembership UNRESOLVED_RANK =
            new GroupMembership(Status.MEMBER_RANK_UNKNOWN, null);

    /** Enforces the one invariant: a rank is present exactly when the status says it is. */
    public GroupMembership {
        Objects.requireNonNull(status, "status");
        if (status == Status.MEMBER_RANK_KNOWN && rank == null) {
            throw new IllegalArgumentException("MEMBER_RANK_KNOWN requires a rank");
        }
        if (status != Status.MEMBER_RANK_KNOWN && rank != null) {
            throw new IllegalArgumentException(status + " must not carry a rank");
        }
    }

    /** The user was observed absent from the group's membership listing. */
    public static GroupMembership notAMember() {
        return ABSENT;
    }

    /** A membership entry was observed and resolved to {@code rank}. */
    public static GroupMembership rankKnown(int rank) {
        return new GroupMembership(Status.MEMBER_RANK_KNOWN, rank);
    }

    /** A membership entry was observed but its rank could not be resolved — still a member. */
    public static GroupMembership rankUnknown() {
        return UNRESOLVED_RANK;
    }

    /**
     * {@code true} when a membership entry was actually observed — for both
     * {@link Status#MEMBER_RANK_KNOWN} and {@link Status#MEMBER_RANK_UNKNOWN}. Rank resolution
     * never decides membership.
     */
    public boolean isMember() {
        return status != Status.NOT_A_MEMBER;
    }
}
