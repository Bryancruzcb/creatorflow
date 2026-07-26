package creatorflow.service.opencloud;

import java.io.IOException;

/**
 * A non-success response (HTTP status {@code >= 400}) from Roblox Open Cloud. It carries the HTTP
 * {@link #status()} so callers can distinguish, e.g., a 404 (unknown/deleted asset) from a 401/403
 * (auth/scope) — both of which mean "no authoritative fact obtained", never a false verification.
 *
 * <p>Extends {@link IOException} so it flows through the same {@code throws IOException} contract as
 * a raw network failure; both should be treated as {@code UNVERIFIABLE} by the orchestrating
 * verifier. The rate-limit case is the {@link RateLimitedException} subtype so it can be surfaced
 * distinctly.
 */
public class OpenCloudException extends IOException {

    private final int status;

    public OpenCloudException(int status, String message) {
        super(message);
        this.status = status;
    }

    /** The HTTP status code Roblox returned (e.g. 401, 403, 404, 429, 5xx). */
    public int status() {
        return status;
    }
}
