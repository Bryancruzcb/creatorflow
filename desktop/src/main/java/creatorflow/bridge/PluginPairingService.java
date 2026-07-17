package creatorflow.bridge;

import creatorflow.db.PluginPairingRepository;
import creatorflow.verification.Sha256;
import creatorflow.workflow.PluginPairingRecord;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Issues short-lived, project-scoped credentials for trusted local Studio plugins. Fully
 * DB-backed via {@link PluginPairingRepository} — the database is the single source of truth, so
 * a valid pairing survives a desktop restart. Only the pairing's SHA-256 token hash is ever
 * persisted; the raw token is returned exactly once, at {@link #issue}.
 */
public final class PluginPairingService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration DEFAULT_LIFETIME = Duration.ofHours(8);

    private final PluginPairingRepository repository;
    private final Duration lifetime;

    public PluginPairingService(PluginPairingRepository repository) {
        this(repository, DEFAULT_LIFETIME);
    }

    PluginPairingService(PluginPairingRepository repository, Duration lifetime) {
        this.repository = Objects.requireNonNull(repository, "repository");
        if (lifetime == null || lifetime.isZero() || lifetime.isNegative()) {
            throw new IllegalArgumentException("Pairing lifetime must be positive");
        }
        this.lifetime = lifetime;
    }

    public IssuedPairing issue(long projectId) {
        if (projectId <= 0) throw new IllegalArgumentException("Project ID must be positive");
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String tokenHash = Sha256.hash(token.getBytes(StandardCharsets.UTF_8));
        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(lifetime);
        String id = UUID.randomUUID().toString();
        repository.insert(id, projectId, tokenHash, issuedAt, expiresAt);
        // The raw token is returned here and nowhere else — it is never persisted or logged.
        return new IssuedPairing(id, token, projectId, expiresAt);
    }

    public Optional<Pairing> authenticate(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        String presentedHash = Sha256.hash(token.strip().getBytes(StandardCharsets.UTF_8));
        // The lookup itself already enforces "not revoked" and "not expired"; the constant-time
        // compare below is defense-in-depth so the final accept/reject decision never rests on a
        // plain string/hash equality check, mirroring LocalBridgeServer's session/CSRF pattern.
        return repository.findActiveByTokenHash(presentedHash)
                .filter(record -> MessageDigest.isEqual(
                        presentedHash.getBytes(StandardCharsets.UTF_8),
                        record.tokenHash().getBytes(StandardCharsets.UTF_8)))
                .map(record -> new Pairing(record.projectId(), record.expiresAt()));
    }

    /**
     * Soft-deletes the pairing by its id, scoped to the given project. Returns whether an active
     * pairing was actually revoked — a pairing that belongs to a different project is left
     * untouched.
     */
    public boolean revoke(String pairingId, long projectId) {
        if (pairingId == null || pairingId.isBlank()) return false;
        return repository.revoke(pairingId.strip(), projectId, Instant.now());
    }

    /** Pairings for a project, newest first — never the token or its hash. */
    public List<PairingView> list(long projectId) {
        Instant now = Instant.now();
        return repository.listForProject(projectId).stream()
                .map(record -> new PairingView(record.id(), record.issuedAt(), record.expiresAt(),
                        status(record, now)))
                .toList();
    }

    private static PairingStatus status(PluginPairingRecord record, Instant now) {
        if (record.revokedAt() != null) return PairingStatus.REVOKED;
        if (!now.isBefore(record.expiresAt())) return PairingStatus.EXPIRED;
        return PairingStatus.ACTIVE;
    }

    public record IssuedPairing(String id, String token, long projectId, Instant expiresAt) {
    }

    public record Pairing(long projectId, Instant expiresAt) {
    }

    public record PairingView(String id, Instant issuedAt, Instant expiresAt, PairingStatus status) {
    }

    public enum PairingStatus {
        ACTIVE, EXPIRED, REVOKED
    }
}
