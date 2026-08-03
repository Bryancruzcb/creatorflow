package creatorflow.server.service;

import creatorflow.verification.Sha256;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/**
 * Mints and hashes team join codes, following the desktop's proven
 * {@code PluginPairingService} token pattern rather than inventing a second one: 128 bits of
 * {@link SecureRandom}, base64url without padding, hashed with SHA-256 for storage.
 *
 * <p>The raw code is returned to the caller exactly once and never persisted. Redemption hashes
 * the presented code and looks that hash up, so a database dump yields no usable invitations.
 * Online guessing is throttled by the kept {@code RateLimitFilter} on {@code /api/**}; 128 bits
 * makes offline guessing irrelevant.
 */
public final class JoinCodes {

    /** Short enough to read aloud over whatever channel the team already trusts, long enough to be unguessable. */
    private static final int CODE_BYTES = 16;

    /** Long enough to hand over in a working day, short enough that a leaked code expires on its own. */
    public static final Duration TTL = Duration.ofHours(24);

    private static final SecureRandom RANDOM = new SecureRandom();

    private JoinCodes() {
    }

    /** A fresh 128-bit base64url code. Show it once; it cannot be recovered afterwards. */
    public static String newCode() {
        byte[] bytes = new byte[CODE_BYTES];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** The at-rest form of a code: lowercase hex SHA-256. */
    public static String hash(String code) {
        return Sha256.hash(code.strip().getBytes(StandardCharsets.UTF_8));
    }
}
