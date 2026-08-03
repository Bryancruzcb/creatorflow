package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.service.TeamService;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Teams, memberships and join codes — the visibility boundary the provenance log sits inside.
 *
 * <p>Not flag-gated: unlike the legacy registry routes, this <em>is</em> the Phase E server. It
 * authenticates on the existing {@code X-Api-Key} interceptor; there is no new auth mechanism.
 *
 * <p>The join ceremony is deliberately manual: an owner mints a code, hands it to a teammate over
 * whatever channel the team already trusts, and the teammate redeems it once. No email, no
 * directory, no discovery — a teammate needs the base URL, the signup token if the operator set
 * one, and a code.
 */
@RestController
@RequestMapping("/api/v1/teams")
public class TeamController {

    public record CreateTeamRequest(String name) {
    }

    public record JoinRequest(String code) {
    }

    /** The raw code is in this response and nowhere else — only its SHA-256 was stored. */
    public record JoinCodeResponse(String code, java.time.Instant expiresAt) {
    }

    private final TeamService teams;

    public TeamController(TeamService teams) {
        this.teams = teams;
    }

    @PostMapping
    public ResponseEntity<TeamService.TeamView> create(
            @RequestBody CreateTeamRequest request,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(teams.createTeam(user.getId(), request == null ? null : request.name()));
    }

    @GetMapping
    public List<TeamService.TeamView> mine(
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return teams.teamsFor(user.getId());
    }

    @GetMapping("/{teamId}/members")
    public List<TeamService.MemberView> members(
            @PathVariable long teamId,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return teams.membersOf(teamId, user.getId());
    }

    @PostMapping("/{teamId}/join-codes")
    public ResponseEntity<JoinCodeResponse> issueJoinCode(
            @PathVariable long teamId,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        TeamService.IssuedJoinCode issued = teams.issueJoinCode(teamId, user.getId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new JoinCodeResponse(issued.code(), issued.expiresAt()));
    }

    @PostMapping("/join")
    public TeamService.TeamView join(
            @RequestBody JoinRequest request,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return teams.redeemJoinCode(user.getId(), request == null ? null : request.code());
    }

    /**
     * Owner-removes-anyone, or anyone-removes-themselves. The last owner gets a 409 — a team with
     * no owner can never issue a code or retract a claim again.
     *
     * <p>The departed member's claims stay in every future lookup. They are observations that were
     * genuinely made; deleting them on departure would rewrite the record.
     */
    @DeleteMapping("/{teamId}/members/{accountId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable long teamId,
            @PathVariable long accountId,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        teams.removeMember(teamId, user.getId(), accountId);
        return ResponseEntity.noContent().build();
    }
}
