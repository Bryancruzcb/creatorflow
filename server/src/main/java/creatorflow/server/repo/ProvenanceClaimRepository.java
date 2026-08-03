package creatorflow.server.repo;

import creatorflow.server.domain.ProvenanceClaim;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * The whole read surface of the provenance store: indexed 64-hex equality inside one team.
 *
 * <p>There is no similarity query here, and there cannot be one — no perceptual hash, distance or
 * score exists in {@link ProvenanceClaim} to write it against. That is the structural reason this
 * server is incapable of emitting a copied/not-copied verdict.
 *
 * <p>Every query excludes retracted rows. Retract is the kill switch, so a tombstone must never
 * reach a lookup.
 */
public interface ProvenanceClaimRepository extends JpaRepository<ProvenanceClaim, Long> {

    /**
     * The lookup. By fingerprint only — never filtered by {@code algorithmVersion}, because
     * classifying a version the caller does not recognize is the client's job and silently
     * dropping such rows server-side would hide exactly what the client must be told.
     *
     * <p>Ordered by username: unique, so the order is stable, and it must not imply priority the
     * way a recency order would.
     */
    @Query("""
            SELECT c FROM ProvenanceClaim c JOIN FETCH c.account a
            WHERE c.team.id = :teamId AND c.fingerprint = :fingerprint AND c.retractedAt IS NULL
            ORDER BY LOWER(a.username) ASC, c.id ASC
            """)
    List<ProvenanceClaim> lookup(@Param("teamId") Long teamId, @Param("fingerprint") String fingerprint);

    /** "What have I shared with this team" — same shape, scoped to one account. */
    @Query("""
            SELECT c FROM ProvenanceClaim c JOIN FETCH c.account a
            WHERE c.team.id = :teamId AND a.id = :accountId AND c.retractedAt IS NULL
            ORDER BY c.recordedAt DESC, c.id DESC
            """)
    List<ProvenanceClaim> mine(@Param("teamId") Long teamId, @Param("accountId") Long accountId);

    /**
     * The application-level idempotency probe, scoped to <strong>non-retracted</strong> rows.
     *
     * <p>Scoping matters more than it looks: if this matched retracted rows too, a tombstone would
     * permanently occupy the key and re-share after a retract — the only append-only-consistent
     * way to correct a wrong declaration — would be impossible. That is also why there is no DB
     * UNIQUE constraint backing it.
     */
    @Query("""
            SELECT c FROM ProvenanceClaim c JOIN FETCH c.account
            WHERE c.team.id = :teamId AND c.account.id = :accountId
              AND c.fingerprint = :fingerprint AND c.ownershipContext = :ownershipContext
              AND c.retractedAt IS NULL
            ORDER BY c.id ASC
            """)
    List<ProvenanceClaim> findLiveDuplicates(@Param("teamId") Long teamId,
                                             @Param("accountId") Long accountId,
                                             @Param("fingerprint") String fingerprint,
                                             @Param("ownershipContext") String ownershipContext);

    @Query("SELECT c FROM ProvenanceClaim c JOIN FETCH c.account WHERE c.id = :id AND c.team.id = :teamId")
    Optional<ProvenanceClaim> findInTeam(@Param("id") Long id, @Param("teamId") Long teamId);
}
