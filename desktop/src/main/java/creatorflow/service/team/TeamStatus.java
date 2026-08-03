package creatorflow.service.team;

/**
 * What happened when this machine tried to talk to the team provenance store.
 *
 * <p>Offline is a state, not an error — but the state has to be <em>told apart</em> from an empty
 * answer, and that is the single most important property in Phase E. "The store said nobody else
 * has this fingerprint" and "we could not ask" look identical if they collapse into one empty
 * list, and the second silently rendered as the first is how a tool starts telling people their
 * work is unique when it has no idea.
 */
public enum TeamStatus {

    /** No base URL, no key, or no selected team. CreatorFlow works fully without any of them. */
    NOT_CONFIGURED,

    /** The store could not be reached, or answered with something unusable. Renders as unknown. */
    UNREACHABLE,

    /**
     * The store answered, but this machine's credential does not give access to the configured
     * team — 401, 403, or the 404 that non-membership deliberately returns instead of a 403.
     *
     * <p>Renders exactly like {@link #UNREACHABLE}: unknown. It must never render as "no one else
     * has this", because nothing was actually looked up.
     */
    UNAUTHORIZED,

    /**
     * The store understood the request and refused it — a validation failure or a conflict, with a
     * message worth showing.
     *
     * <p>Only reachable from the share and retract paths, which are things a person just did and
     * needs a real answer about. A lookup never returns this: on the read path an unexpected
     * refusal degrades to {@link #UNREACHABLE}, i.e. unknown, which is the safe direction.
     */
    REJECTED,

    /** The store answered. The claim list is real — including when it is empty. */
    OK
}
