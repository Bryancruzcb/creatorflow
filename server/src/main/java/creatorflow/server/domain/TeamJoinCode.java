package creatorflow.server.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A single-use, 24-hour invitation to one team.
 *
 * <p>Modelled on the desktop's proven {@code PluginPairingService} token pattern: 128 bits of
 * {@code SecureRandom}, base64url-encoded, and <strong>only the SHA-256 hash is persisted</strong>.
 * The raw code is returned exactly once, at issuance, and exists nowhere else — not in this table,
 * not in a log, not in any response after the first.
 *
 * <p>One asymmetry worth recording rather than hiding: {@code UserAccount.apiKey} sits in
 * plaintext in this same H2 file, so hashing codes at rest protects them against a database dump
 * more than it protects the keys beside them. That is inherited from the existing account model,
 * not made worse here, and closing it is a separate piece of work.
 */
@Entity
@Table(name = "team_join_codes")
public class TeamJoinCode {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "team_id", nullable = false)
    private Team team;

    /** SHA-256 of the raw code, lowercase hex. The raw code itself is never stored. */
    @Column(name = "code_hash", nullable = false, unique = true, length = 64)
    private String codeHash;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by_account_id", nullable = false)
    private UserAccount createdBy;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant expiresAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "used_by_account_id")
    private UserAccount usedBy;

    private Instant usedAt;

    protected TeamJoinCode() {
        // JPA
    }

    public TeamJoinCode(Team team, String codeHash, UserAccount createdBy, Instant expiresAt) {
        this.team = team;
        this.codeHash = codeHash;
        this.createdBy = createdBy;
        this.createdAt = Instant.now();
        this.expiresAt = expiresAt;
    }

    public Long getId() {
        return id;
    }

    public Team getTeam() {
        return team;
    }

    public String getCodeHash() {
        return codeHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public UserAccount getUsedBy() {
        return usedBy;
    }

    public Instant getUsedAt() {
        return usedAt;
    }

    /** Redeemable exactly once, and only before {@link #getExpiresAt()}. */
    public boolean isRedeemableAt(Instant now) {
        return usedAt == null && now.isBefore(expiresAt);
    }

    public void redeem(UserAccount account, Instant now) {
        this.usedBy = account;
        this.usedAt = now;
    }

    @Override
    public String toString() {
        // Deliberately omits the hash: it is not the code, but it is still a credential artifact
        // and has no business in a log line.
        return "TeamJoinCode{id=" + id + ", expiresAt=" + expiresAt + ", used=" + (usedAt != null) + '}';
    }
}
