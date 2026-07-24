package creatorflow.ownership;

/**
 * The pure result of comparing an asset's creator identity against a target experience's owner
 * identity (and, when relevant, group-membership).
 *
 * <ul>
 *   <li>{@code MATCH} — the creator identity equals the experience owner identity, OR the
 *       creator is a {@code USER} and is a member of the owning {@code GROUP} (any rank).</li>
 *   <li>{@code MISMATCH} — facts were obtained for both sides, but the creator is neither the
 *       owner nor a member of the owning group. This is a <strong>review lead</strong>, never a
 *       verdict — the team may legitimately license the asset.</li>
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
     * @param memberRank the creator-user's rank in the owning group, when known; {@code null} when
     *     not applicable or when the creator is not a member. Only consulted on the
     *     {@code USER} creator / {@code GROUP} owner path — irrelevant on every other path,
     *     including when the creator and owner already match directly.
     * @return the computed outcome
     */
    public static OwnershipOutcome evaluate(String creatorType, Long creatorId,
                                            String ownerType, Long ownerId, Integer memberRank) {
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
            return memberRank != null ? MATCH : MISMATCH;
        }

        return MISMATCH;
    }

    private static boolean isKnownType(String type) {
        return TYPE_USER.equals(type) || TYPE_GROUP.equals(type);
    }
}
