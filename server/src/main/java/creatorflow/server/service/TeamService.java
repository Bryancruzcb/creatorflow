package creatorflow.server.service;

import creatorflow.server.domain.ProvenanceClaim;
import creatorflow.server.domain.Team;
import creatorflow.server.domain.TeamJoinCode;
import creatorflow.server.domain.TeamMembership;
import creatorflow.server.domain.TeamRole;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.ProvenanceClaimRepository;
import creatorflow.server.repo.TeamJoinCodeRepository;
import creatorflow.server.repo.TeamMembershipRepository;
import creatorflow.server.repo.TeamRepository;
import creatorflow.server.repo.UserAccountRepository;
import creatorflow.server.web.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Teams, memberships, join codes, and the append-only provenance log.
 *
 * <p>Everything here returns fully-materialized view records rather than entities. That is not
 * ceremony: {@code spring.jpa.open-in-view=false}, so a lazy association that escapes a
 * transaction throws at serialization time instead of at test time.
 *
 * <p>Two policies are enforced in exactly one place, here, so no route can forget them:
 * <ol>
 *   <li><strong>Non-membership answers 404, never 403</strong> ({@code MappingController.ownedAsset}'s
 *       policy). A 403 would confirm that a team id exists, turning the id space into an oracle.</li>
 *   <li><strong>The last OWNER cannot leave</strong> — the team never orphans, so OWNER-retract,
 *       the kill switch's second operator, always has someone who can pull it.</li>
 * </ol>
 */
@Service
public class TeamService {

    /** Members, as the team list renders them. Username only — {@code displayName} has had no writer since PR-1. */
    public record MemberView(long accountId, String username, TeamRole role, Instant joinedAt) {
    }

    public record TeamView(long id, String name, TeamRole role, long memberCount, Instant createdAt) {
    }

    /** The raw code exists in this record and nowhere else, ever. */
    public record IssuedJoinCode(String code, Instant expiresAt) {
    }

    /**
     * One claim as the API serves it.
     *
     * <p>Read the field list as a contract: there is no verdict, no score, no distance and no
     * rank. A judgement is not merely absent from this view — it is underivable from it.
     */
    public record ClaimView(long id, String memberUsername, boolean isYours, String algorithmVersion,
                            String clipName, double durationSeconds, Long robloxAssetId,
                            String ownershipContext, String declaredSource, String declaredLicense,
                            String declaredNote, Instant observedAt, Instant recordedAt) {
    }

    /**
     * The outcome of a share.
     *
     * @param created            true when a row was inserted (201), false when an identical live
     *                           claim already existed (200)
     * @param declarationsDiffer true when the request's declared fields differ from what is
     *                           stored. A silent 200 that dropped the change would be a
     *                           stale-declaration hazard, so the caller is told, and the answer is
     *                           "retract to change" — never a quiet overwrite of an append-only row
     */
    public record ShareResult(ClaimView claim, boolean created, boolean declarationsDiffer) {
    }

    private final TeamRepository teams;
    private final TeamMembershipRepository memberships;
    private final TeamJoinCodeRepository joinCodes;
    private final ProvenanceClaimRepository claims;
    private final UserAccountRepository accounts;

    public TeamService(TeamRepository teams, TeamMembershipRepository memberships,
                       TeamJoinCodeRepository joinCodes, ProvenanceClaimRepository claims,
                       UserAccountRepository accounts) {
        this.teams = teams;
        this.memberships = memberships;
        this.joinCodes = joinCodes;
        this.claims = claims;
        this.accounts = accounts;
    }

    // ---------------------------------------------------------------- teams

    @Transactional
    public TeamView createTeam(Long accountId, String rawName) {
        String name = requireText(rawName, "name", 80);
        UserAccount account = account(accountId);
        Team team = teams.save(new Team(name, account));
        memberships.save(new TeamMembership(team, account, TeamRole.OWNER));
        return new TeamView(team.getId(), team.getName(), TeamRole.OWNER, 1, team.getCreatedAt());
    }

    @Transactional(readOnly = true)
    public List<TeamView> teamsFor(Long accountId) {
        return memberships.teamsOf(accountId).stream()
                .map(membership -> new TeamView(
                        membership.getTeam().getId(), membership.getTeam().getName(),
                        membership.getRole(), memberships.countByTeamId(membership.getTeam().getId()),
                        membership.getTeam().getCreatedAt()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<MemberView> membersOf(Long teamId, Long accountId) {
        requireMembership(teamId, accountId);
        return memberships.membersOf(teamId).stream()
                .map(membership -> new MemberView(membership.getAccount().getId(),
                        membership.getAccount().getUsername(), membership.getRole(),
                        membership.getJoinedAt()))
                .toList();
    }

    // ------------------------------------------------------------ join codes

    /**
     * Mints a single-use, 24-hour code and returns the raw value once. Only its SHA-256 is stored,
     * so this response is the only chance anyone has to read it.
     */
    @Transactional
    public IssuedJoinCode issueJoinCode(Long teamId, Long accountId) {
        TeamMembership membership = requireMembership(teamId, accountId);
        if (!membership.isOwner()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Only a team owner can create join codes.");
        }
        String code = JoinCodes.newCode();
        Instant expiresAt = Instant.now().plus(JoinCodes.TTL);
        joinCodes.save(new TeamJoinCode(membership.getTeam(), JoinCodes.hash(code),
                membership.getAccount(), expiresAt));
        return new IssuedJoinCode(code, expiresAt);
    }

    /**
     * Redeems a code. Unknown, expired and already-used codes are all a flat 404 with one message:
     * telling them apart would say whether a code ever existed.
     */
    @Transactional
    public TeamView redeemJoinCode(Long accountId, String rawCode) {
        String code = requireText(rawCode, "code", 200);
        Instant now = Instant.now();
        TeamJoinCode joinCode = joinCodes.findByCodeHash(JoinCodes.hash(code))
                .filter(candidate -> candidate.isRedeemableAt(now))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                        "That join code is not valid. Codes are single-use and expire after 24 hours."));

        UserAccount account = account(accountId);
        Team team = joinCode.getTeam();
        Optional<TeamMembership> existing = memberships.findByTeamIdAndAccountId(team.getId(), accountId);
        if (existing.isPresent()) {
            // Already a member: leave the code unspent rather than burning it on a no-op, and
            // answer with the team they are already in.
            return new TeamView(team.getId(), team.getName(), existing.get().getRole(),
                    memberships.countByTeamId(team.getId()), team.getCreatedAt());
        }
        joinCode.redeem(account, now);
        memberships.save(new TeamMembership(team, account, TeamRole.MEMBER));
        return new TeamView(team.getId(), team.getName(), TeamRole.MEMBER,
                memberships.countByTeamId(team.getId()), team.getCreatedAt());
    }

    /**
     * Removes a member — an OWNER removing anyone, or anyone removing themselves.
     *
     * <p>The last OWNER cannot leave (409). A team with no OWNER could never mint another join
     * code and, more importantly, would lose the second operator of the retract kill switch.
     *
     * <p>The departing member's claims stay. They are historical observations; deleting them on
     * departure would rewrite the record of what was actually observed.
     */
    @Transactional
    public void removeMember(Long teamId, Long callerAccountId, Long targetAccountId) {
        TeamMembership caller = requireMembership(teamId, callerAccountId);
        boolean self = callerAccountId.equals(targetAccountId);
        if (!self && !caller.isOwner()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Only a team owner can remove another member.");
        }
        TeamMembership target = memberships.findByTeamIdAndAccountId(teamId, targetAccountId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Team member not found."));
        if (target.isOwner() && memberships.countByTeamIdAndRole(teamId, TeamRole.OWNER) <= 1) {
            throw new ApiException(HttpStatus.CONFLICT,
                    "This is the team's last owner. Make someone else an owner first — a team with "
                            + "no owner can never issue a join code or retract a claim again.");
        }
        memberships.delete(target);
    }

    // ---------------------------------------------------------------- claims

    /**
     * The lookup: every non-retracted claim in this team for this exact fingerprint.
     *
     * <p>Fingerprint only. The caller's {@code algorithmVersion} is deliberately not a parameter —
     * each row carries its own and the <em>client</em> classifies it, so a row recorded under a
     * different fingerprint version renders as "not comparable" instead of vanishing.
     */
    @Transactional(readOnly = true)
    public List<ClaimView> lookup(Long teamId, Long accountId, String rawFingerprint) {
        requireMembership(teamId, accountId);
        String fingerprint = requireFingerprint(rawFingerprint);
        return claims.lookup(teamId, fingerprint).stream()
                .map(claim -> view(claim, accountId))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ClaimView> mine(Long teamId, Long accountId) {
        requireMembership(teamId, accountId);
        return claims.mine(teamId, accountId).stream()
                .map(claim -> view(claim, accountId))
                .toList();
    }

    /**
     * Records an observation, idempotently.
     *
     * <p>The duplicate probe runs inside this transaction and is scoped to non-retracted rows, so
     * a retry after a timeout is safe and retract-then-reshare still creates a new row. There is
     * no DB UNIQUE constraint doing this work — see {@link ProvenanceClaim} for why one would be
     * actively harmful.
     */
    @Transactional
    public ShareResult share(Long teamId, Long accountId, ShareRequest request) {
        TeamMembership membership = requireMembership(teamId, accountId);
        String fingerprint = requireFingerprint(request.fingerprint());
        String algorithmVersion = requireText(request.algorithmVersion(), "algorithmVersion", 120);
        String clipName = requireText(request.clipName(), "clipName", 200);
        String context = normalizeContext(request.ownershipContext());
        Long robloxAssetId = positiveOrNull(request.robloxAssetId());
        String source = optionalText(request.declaredSource(), "declaredSource", 400);
        String license = optionalText(request.declaredLicense(), "declaredLicense", 200);
        String note = optionalText(request.declaredNote(), "declaredNote", 1000);
        double duration = request.durationSeconds();
        if (!Double.isFinite(duration) || duration < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "durationSeconds must be a non-negative number.");
        }

        List<ProvenanceClaim> live = claims.findLiveDuplicates(teamId, accountId, fingerprint, context);
        if (!live.isEmpty()) {
            ProvenanceClaim stored = live.get(0);
            // The STORED claim is returned, never the request's version of it. Answering with the
            // request would let a changed declaration look accepted while the log still holds the
            // old one.
            return new ShareResult(view(stored, accountId), false,
                    stored.declarationsDifferFrom(clipName, robloxAssetId, source, license, note));
        }

        ProvenanceClaim saved = claims.save(new ProvenanceClaim(membership.getTeam(),
                membership.getAccount(), fingerprint, algorithmVersion, clipName, duration,
                robloxAssetId, context, source, license, note, request.observedAt()));
        return new ShareResult(view(saved, accountId), true, false);
    }

    /**
     * The kill switch: author or team OWNER, reason required.
     *
     * <p>It removes the claim from every future lookup. It does not recall a copy someone already
     * read — no server can — which is why the copy for this must never say "unshares".
     */
    @Transactional
    public ClaimView retract(Long teamId, Long accountId, Long claimId, String rawReason) {
        TeamMembership membership = requireMembership(teamId, accountId);
        String reason = requireText(rawReason, "reason", 500);
        ProvenanceClaim claim = claims.findInTeam(claimId, teamId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Claim not found."));
        boolean author = claim.getAccount().getId().equals(accountId);
        if (!author && !membership.isOwner()) {
            throw new ApiException(HttpStatus.FORBIDDEN,
                    "Only the member who shared this claim, or a team owner, can retract it.");
        }
        // Retracting twice is a no-op that returns the existing tombstone: the first retraction is
        // the record, and a retry after a dropped response must not rewrite it.
        claim.retract(reason, Instant.now());
        return view(claim, accountId);
    }

    /**
     * What a share carries.
     *
     * <p>{@code fingerprint}, {@code algorithmVersion}, {@code clipName} and
     * {@code durationSeconds} are read by the desktop from its own {@code motion_snapshots} row —
     * never accepted from a browser — so nothing can publish a fingerprint the desktop did not
     * compute. The rest is DECLARED input a person typed, passed through verbatim.
     */
    public record ShareRequest(String fingerprint, String algorithmVersion, String clipName,
                               double durationSeconds, Long robloxAssetId, String ownershipContext,
                               String declaredSource, String declaredLicense, String declaredNote,
                               Instant observedAt) {
    }

    // --------------------------------------------------------------- helpers

    private ClaimView view(ProvenanceClaim claim, Long viewerAccountId) {
        return new ClaimView(claim.getId(), claim.getAccount().getUsername(),
                claim.getAccount().getId().equals(viewerAccountId), claim.getAlgorithmVersion(),
                claim.getClipName(), claim.getDurationSeconds(), claim.getRobloxAssetId(),
                claim.getOwnershipContext(), claim.getDeclaredSource(), claim.getDeclaredLicense(),
                claim.getDeclaredNote(), claim.getObservedAt(), claim.getRecordedAt());
    }

    /** 404, never 403 — a 403 here would confirm the team id exists to someone outside it. */
    private TeamMembership requireMembership(Long teamId, Long accountId) {
        return memberships.findByTeamIdAndAccountId(teamId, accountId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Team not found."));
    }

    private UserAccount account(Long accountId) {
        return accounts.findById(accountId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Account no longer exists."));
    }

    /**
     * Normalize then validate, the same shape as {@code RegistryController.requireSha}: either
     * case is accepted and lowercased, so a client that upper-cases hex still matches rows a
     * client that lower-cases it wrote.
     */
    private static String requireFingerprint(String fingerprint) {
        String normalized = fingerprint == null ? "" : fingerprint.strip().toLowerCase(Locale.ROOT);
        if (!normalized.matches("[0-9a-f]{64}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "fingerprint must be a 64-hex-character curve fingerprint.");
        }
        return normalized;
    }

    /** Stored as {@code ''} rather than NULL when absent, so the duplicate probe can use equality. */
    private static String normalizeContext(String context) {
        String normalized = context == null ? "" : context.strip().toLowerCase(Locale.ROOT);
        if (normalized.length() > 80) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "ownershipContext must be 80 characters or fewer.");
        }
        return normalized;
    }

    private static String requireText(String value, String field, int max) {
        String trimmed = value == null ? "" : value.strip();
        if (trimmed.isEmpty() || trimmed.length() > max) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    field + " is required and must be 1-" + max + " characters.");
        }
        return trimmed;
    }

    private static String optionalText(String value, String field, int max) {
        String trimmed = value == null ? "" : value.strip();
        if (trimmed.isEmpty()) return null;
        if (trimmed.length() > max) {
            throw new ApiException(HttpStatus.BAD_REQUEST, field + " must be " + max + " characters or fewer.");
        }
        return trimmed;
    }

    private static Long positiveOrNull(Long value) {
        if (value == null) return null;
        if (value <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "robloxAssetId must be a positive id or null.");
        }
        return value;
    }
}
