package creatorflow.server.repo;

import creatorflow.server.domain.TeamMembership;
import creatorflow.server.domain.TeamRole;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TeamMembershipRepository extends JpaRepository<TeamMembership, Long> {

    Optional<TeamMembership> findByTeamIdAndAccountId(Long teamId, Long accountId);

    long countByTeamIdAndRole(Long teamId, TeamRole role);

    long countByTeamId(Long teamId);

    /**
     * Members ordered by username. Written as JPQL rather than a derived name so the join and the
     * ordering are visible: {@code displayName} has had no writer since PR-1 deleted the web signup
     * flow, so {@code username} — which is unique — is the only stable ordering key the API has.
     */
    @Query("""
            SELECT m FROM TeamMembership m JOIN FETCH m.account a
            WHERE m.team.id = :teamId
            ORDER BY LOWER(a.username) ASC
            """)
    List<TeamMembership> membersOf(@Param("teamId") Long teamId);

    @Query("""
            SELECT m FROM TeamMembership m JOIN FETCH m.team t
            WHERE m.account.id = :accountId
            ORDER BY LOWER(t.name) ASC
            """)
    List<TeamMembership> teamsOf(@Param("accountId") Long accountId);
}
