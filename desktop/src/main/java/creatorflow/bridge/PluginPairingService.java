package creatorflow.bridge;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Issues short-lived, project-scoped credentials for trusted local Studio plugins. */
public final class PluginPairingService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration DEFAULT_LIFETIME = Duration.ofHours(8);

    private final ConcurrentHashMap<String, Pairing> pairings = new ConcurrentHashMap<>();
    private final Duration lifetime;

    public PluginPairingService() {
        this(DEFAULT_LIFETIME);
    }

    PluginPairingService(Duration lifetime) {
        if (lifetime == null || lifetime.isZero() || lifetime.isNegative()) {
            throw new IllegalArgumentException("Pairing lifetime must be positive");
        }
        this.lifetime = lifetime;
    }

    public IssuedPairing issue(long projectId) {
        if (projectId <= 0) throw new IllegalArgumentException("Project ID must be positive");
        pruneExpired();
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(lifetime);
        pairings.put(token, new Pairing(projectId, expiresAt));
        return new IssuedPairing(token, projectId, expiresAt);
    }

    public Optional<Pairing> authenticate(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        Pairing pairing = pairings.get(token.strip());
        if (pairing == null) return Optional.empty();
        if (!Instant.now().isBefore(pairing.expiresAt())) {
            pairings.remove(token.strip(), pairing);
            return Optional.empty();
        }
        return Optional.of(pairing);
    }

    public void revoke(String token) {
        if (token != null) pairings.remove(token.strip());
    }

    private void pruneExpired() {
        Instant now = Instant.now();
        pairings.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expiresAt()));
    }

    public record IssuedPairing(String token, long projectId, Instant expiresAt) {
    }

    public record Pairing(long projectId, Instant expiresAt) {
    }
}
