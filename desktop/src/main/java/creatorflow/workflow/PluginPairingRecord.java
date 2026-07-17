package creatorflow.workflow;

import java.time.Instant;

/**
 * Persisted row for a plugin pairing. Carries the token's SHA-256 hash, never the raw token —
 * the raw token exists only transiently in {@code PluginPairingService.issue} and the one-shot
 * HTTP response. Callers outside {@code creatorflow.bridge.PluginPairingService} must not surface
 * {@link #tokenHash()} to the network or logs.
 */
public record PluginPairingRecord(
        String id,
        long projectId,
        String tokenHash,
        Instant issuedAt,
        Instant expiresAt,
        Instant revokedAt) {
}
