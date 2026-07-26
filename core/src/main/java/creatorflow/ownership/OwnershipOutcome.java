package creatorflow.ownership;

/**
 * The pure result of comparing an asset's creator identity against a target experience's owner
 * identity (and, when relevant, group-membership).
 *
 * <ul>
 *   <li>{@code MATCH} — the creator identity equals the experience owner identity, OR the
 *       creator is a {@code USER} and is a member of the owning {@code GROUP} — <em>any</em> rank,
 *       including a rank that could not be resolved (see {@link GroupMembership}).</li>
 *   <li>{@code MISMATCH} — facts were obtained for both sides, but the creator is neither the
 *       owner nor a member of the owning group — and non-membership must have been
 *       <em>observed</em>, never inferred from an unresolved lookup. This is a
 *       <strong>review lead</strong>, never a verdict — the team may legitimately license the
 *       asset.</li>
 *   <li>{@code UNVERIFIABLE} — a required fact could not be obtained (missing id, unrecognized
 *       identity kind, API error upstream). The ownership evidence basis stays
 *       {@code NOT_VERIFIED}; this is an honest "unknown", never a false {@code MATCH} or
 *       {@code MISMATCH}.</li>
 * </ul>
 */
public enum OwnershipOutcome {
    MATCH,
    MISMATCH,
    UNVERIFIABLE;

    /** Identity kind: an individual Roblox user. */
    public static final String TYPE_USER = "USER";

    /** Identity kind: a Roblox group. */
    public static final String TYPE_GROUP = "GROUP";

    /**
     * Pure evaluation of the ownership match — no I/O, no clock, no randomness.
     *
     * <p>Callers are responsible for normalizing raw Roblox identity representations (a bare
     * creator id string such as {@code "1"} vs. an owner resource path such as
     * {@code "users/123"}/{@code "groups/123"} — see the Task 0 spike note) into a
     * {@code (type, id)} pair <em>before</em> calling this method; by the time facts reach this
     * evaluator, both sides are already typed ids in the same form.
     *
     * @param creatorType {@link #TYPE_USER} or {@link #TYPE_GROUP}; {@code null} if unknown
     * @param creatorId the creator's id; {@code null} if unknown
     * @param ownerType {@link #TYPE_USER} or {@link #TYPE_GROUP}; {@code null} if unknown
     * @param ownerId the experience owner's id; {@code null} if unknown
     * @param membership the tri-state group-membership fact, when one was obtained; {@code null}
     *     when no membership lookup was performed. Only consulted on the {@code USER} creator /
     *     {@code GROUP} owner path — irrelevant on every other path, including when the creator and
     *     owner already match directly. A member with an unresolved rank
     *     ({@link GroupMembership.Status#MEMBER_RANK_UNKNOWN}) is still a member and still a
     *     {@code MATCH}; only an observed absence may contribute to a {@code MISMATCH}.
     * @return the computed outcome
     */
    public static OwnershipOutcome evaluate(String creatorType, Long creatorId,
                                            String ownerType, Long ownerId,
                                            GroupMembership membership) {
        if (!isKnownType(creatorType) || creatorId == null || !isKnownType(ownerType) || ownerId == null) {
            return UNVERIFIABLE;
        }

        if (creatorType.equals(ownerType)) {
            return creatorId.equals(ownerId) ? MATCH : MISMATCH;
        }

        // Only the USER-creator / GROUP-owner path has a membership fallback: a group cannot be
        // "a member" of a user, so a GROUP-creator / USER-owner cross-type pair is always a
        // mismatch (facts were obtained; they just don't line up).
        if (TYPE_USER.equals(creatorType) && TYPE_GROUP.equals(ownerType)) {
            if (membership == null) {
                // No membership fact at all. Absence of evidence is not evidence of absence: a
                // missing lookup must never be read as "provably not a member".
                return UNVERIFIABLE;
            }
            // Any observed membership matches (locked decision) — including one whose rank we could
            // not resolve. Only an observed absence justifies the MISMATCH review lead.
            return membership.isMember() ? MATCH : MISMATCH;
        }

        return MISMATCH;
    }

    private static boolean isKnownType(String type) {
        return TYPE_USER.equals(type) || TYPE_GROUP.equals(type);
    }
}
