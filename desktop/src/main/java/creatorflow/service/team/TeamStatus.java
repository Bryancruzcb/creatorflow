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
     * The request was refused, and the refusal has a message worth showing — either the store
     * understood it and said no (a validation failure or a conflict on the share/retract paths), or
     * this client refused to send it at all because the fingerprint it was handed is not 64-hex.
     *
     * <p>That second case is the only way a <em>read</em> reaches this status, and it is kept
     * distinct rather than folded into {@link #UNREACHABLE} for an honesty reason: the store is
     * fine and was never contacted, so "unreachable" would be a false statement about it. What is
     * true is that nothing was looked up — which is what the UI must say, and does.
     *
     * <p>An unexpected refusal *from the store* on a read still degrades to {@link #UNREACHABLE},
     * i.e. unknown, which is the direction that cannot mislead.
     */
    REJECTED,

    /** The store answered. The claim list is real — including when it is empty. */
    OK
}
