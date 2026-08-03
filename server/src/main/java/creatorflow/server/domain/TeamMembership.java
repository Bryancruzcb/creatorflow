package creatorflow.server.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

/**
 * One person's place in one team. {@code UNIQUE(team_id, account_id)} is real here — a person is
 * in a team once or not at all, and unlike {@link ProvenanceClaim} there is no append-only log to
 * protect: a membership is current state, not a historical observation.
 *
 * <p>Removing a membership does <strong>not</strong> remove that person's claims. A departed
 * member's observations stay in every future lookup, attributed to them, because deleting them
 * would rewrite the record of what was actually observed.
 */
@Entity
@Table(name = "team_memberships",
        uniqueConstraints = @UniqueConstraint(name = "uq_team_member",
                columnNames = {"team_id", "account_id"}))
public class TeamMembership {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "team_id", nullable = false)
    private Team team;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "account_id", nullable = false)
    private UserAccount account;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TeamRole role;

    @Column(nullable = false)
    private Instant joinedAt;

    protected TeamMembership() {
        // JPA
    }

    public TeamMembership(Team team, UserAccount account, TeamRole role) {
        this.team = team;
        this.account = account;
        this.role = role;
        this.joinedAt = Instant.now();
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

    public TeamRole getRole() {
        return role;
    }

    public boolean isOwner() {
        return role == TeamRole.OWNER;
    }

    public Instant getJoinedAt() {
        return joinedAt;
    }
}
