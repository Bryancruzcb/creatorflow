package creatorflow.service.opencloud;

import java.time.Duration;

/**
 * Roblox Open Cloud returned HTTP 429 (too many requests). Surfaced as a distinct type — rather
 * than a generic {@link OpenCloudException} — so the caller can say "rate-limited, try again"
 * instead of a generic failure, per the plan's rate-limit requirement.
 *
 * <p>A rate limit is a <em>transient</em> failure: it is not a false verification and not a
 * mismatch. The orchestrating verifier lets this propagate (rather than folding it into an
 * {@code UNVERIFIABLE} result) so the UI can prompt a retry.
 */
public final class RateLimitedException extends OpenCloudException {

    private final Duration retryAfter;

    /**
     * @param message a human-readable reason
     * @param retryAfter the server-suggested wait from a {@code Retry-After} header, or {@code null}
     *     when the server did not send one
     */
    public RateLimitedException(String message, Duration retryAfter) {
        super(429, message);
        this.retryAfter = retryAfter;
    }

    /** The suggested wait before retrying if the server sent a {@code Retry-After} header; else {@code null}. */
    public Duration retryAfter() {
        return retryAfter;
    }
}
