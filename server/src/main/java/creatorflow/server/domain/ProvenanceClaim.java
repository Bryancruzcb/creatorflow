package creatorflow.server.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * One member's recorded observation that they have a motion curve with this fingerprint.
 *
 * <p><strong>An observation, never a judgement.</strong> Read the field list and notice what is
 * absent: no score, no distance, no verdict, no decision enum, no perceptual hash, no file bytes.
 * There is nothing here a "copied / not copied" answer could be derived from, and that is the
 * point — any member can claim any fingerprint, which is exactly why a claim can only ever mean
 * "this person ran CreatorFlow on a curve with this fingerprint and chose to say so."
 *
 * <p><strong>Tripwire.</strong> If a later phase adds a "first" or "original" badge derived from
 * {@link #getRecordedAt()}, that property is gone and this becomes an accusation machine. The
 * ordering key exists so the log has a trustworthy clock, not so anyone can win a race.
 *
 * <p>VERIFIED vs DECLARED, kept apart on purpose:
 * <ul>
 *   <li>VERIFIED (CreatorFlow computed it): {@code fingerprint}, {@code algorithmVersion},
 *       {@code recordedAt} (this server's own clock).</li>
 *   <li>DECLARED (a person typed it, or their machine reported it): {@code clipName},
 *       {@code durationSeconds}, {@code robloxAssetId}, {@code ownershipContext},
 *       {@code declaredSource}, {@code declaredLicense}, {@code declaredNote}, and
 *       {@code observedAt} — a client clock, display-only, so a backdated machine cannot
 *       manufacture "first".</li>
 * </ul>
 *
 * <p><strong>No {@code UNIQUE} constraint, deliberately.</strong> H2 has no partial unique
 * indexes, so a {@code UNIQUE(team, account, fingerprint, context)} would let a retracted
 * tombstone occupy the key forever — making retract-then-reshare, the only append-only-consistent
 * way to correct a wrong declaration, impossible. Uniqueness is therefore application-level and
 * scoped to non-retracted rows (see {@code TeamService.share}). The cost is accepted and stated: a
 * concurrent double-submit can leave two rows, which render as two harmless independent
 * observations rather than as corruption.
 */
@Entity
@Table(name = "provenance_claims",
        indexes = @Index(name = "idx_claim_team_fingerprint", columnList = "team_id,fingerprint"))
public class ProvenanceClaim {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "team_id", nullable = false)
    private Team team;

    /** The member who recorded this observation. Kept even after they leave the team. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private UserAccount account;

    /** Lowercased 64-hex {@code MotionComparisonEngine.fingerprint}. The only queryable key. */
    @Column(nullable = false, length = 64)
    private String fingerprint;

    /**
     * Which fingerprint algorithm produced {@link #fingerprint}, e.g.
     * {@code creatorflow.motion-fingerprint/v1}.
     *
     * <p>Load-bearing: the client classifies every returned row against its own version, so a v2
     * row can never silently render as a v1 match. The server never filters on it — filtering
     * server-side would hide rows the client should have been told about and classified.
     */
    @Column(name = "algorithm_version", nullable = false, length = 120)
    private String algorithmVersion;

    @Column(name = "clip_name", nullable = false, length = 200)
    private String clipName;

    @Column(name = "duration_seconds", nullable = false)
    private double durationSeconds;

    @Column(name = "roblox_asset_id")
    private Long robloxAssetId;

    /**
     * Normalized like {@code MappingController.normalizeContext} (stripped, lowercased), and
     * stored as {@code ''} rather than NULL when absent, so the application-level idempotency
     * check can compare it with plain equality instead of NULL-aware SQL.
     */
    @Column(name = "ownership_context", nullable = false, length = 80)
    private String ownershipContext;

    @Column(name = "declared_source", length = 400)
    private String declaredSource;

    @Column(name = "declared_license", length = 200)
    private String declaredLicense;

    @Column(name = "declared_note", length = 1000)
    private String declaredNote;

    /** The member's own clock. DECLARED, display-only, never the ordering key. */
    @Column(name = "observed_at")
    private Instant observedAt;

    /** This server's clock. The only clock the store trusts, and the ordering key. */
    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    @Column(name = "retracted_at")
    private Instant retractedAt;

    @Column(name = "retracted_reason", length = 500)
    private String retractedReason;

    protected ProvenanceClaim() {
        // JPA
    }

    public ProvenanceClaim(Team team, UserAccount account, String fingerprint, String algorithmVersion,
                           String clipName, double durationSeconds, Long robloxAssetId,
                           String ownershipContext, String declaredSource, String declaredLicense,
                           String declaredNote, Instant observedAt) {
        this.team = team;
        this.account = account;
        this.fingerprint = fingerprint;
        this.algorithmVersion = algorithmVersion;
        this.clipName = clipName;
        this.durationSeconds = durationSeconds;
        this.robloxAssetId = robloxAssetId;
        this.ownershipContext = ownershipContext;
        this.declaredSource = declaredSource;
        this.declaredLicense = declaredLicense;
        this.declaredNote = declaredNote;
        this.observedAt = observedAt;
        this.recordedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public Team getTeam() {
        return team;
    }

    public UserAccount getAccount() {
        return account;
    }

    public String getFingerprint() {
        return fingerprint;
    }

    public String getAlgorithmVersion() {
        return algorithmVersion;
    }

    public String getClipName() {
        return clipName;
    }

    public double getDurationSeconds() {
        return durationSeconds;
    }

    public Long getRobloxAssetId() {
        return robloxAssetId;
    }

    public String getOwnershipContext() {
        return ownershipContext;
    }

    public String getDeclaredSource() {
        return declaredSource;
    }

    public String getDeclaredLicense() {
        return declaredLicense;
    }

    public String getDeclaredNote() {
        return declaredNote;
    }

    public Instant getObservedAt() {
        return observedAt;
    }

    public Instant getRecordedAt() {
        return recordedAt;
    }

    public Instant getRetractedAt() {
        return retractedAt;
    }

    public String getRetractedReason() {
        return retractedReason;
    }

    public boolean isRetracted() {
        return retractedAt != null;
    }

    /**
     * The kill switch. Removes the row from every future lookup; it does not and cannot recall a
     * copy someone already read. Copy must say "removes it from future lookups", never "unshares".
     *
     * <p>Retracting an already-retracted claim leaves the original tombstone alone: the first
     * retraction is the record.
     */
    public void retract(String reason, Instant now) {
        if (retractedAt != null) return;
        this.retractedAt = now;
        this.retractedReason = reason;
    }

    /**
     * Whether {@code other}'s declared fields differ from what is already stored.
     *
     * <p>Used by the idempotent share path: a re-share whose declarations changed gets a 200 that
     * <em>says so</em>, because a silent 200 that drops the changed declaration is exactly the
     * stale-declaration hazard this phase exists to avoid. The answer is "retract to change",
     * never a quiet overwrite of an append-only row.
     */
    public boolean declarationsDifferFrom(String otherClipName, Long otherRobloxAssetId,
                                          String otherSource, String otherLicense, String otherNote) {
        return !java.util.Objects.equals(clipName, otherClipName)
                || !java.util.Objects.equals(robloxAssetId, otherRobloxAssetId)
                || !java.util.Objects.equals(declaredSource, otherSource)
                || !java.util.Objects.equals(declaredLicense, otherLicense)
                || !java.util.Objects.equals(declaredNote, otherNote);
    }
}
