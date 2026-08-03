package creatorflow.server.web;

import creatorflow.server.domain.UserAccount;
import creatorflow.server.service.TeamService;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The provenance log: share, look up, retract.
 *
 * <p>The lookup takes a <strong>fingerprint and nothing else</strong>. It answers exactly one
 * question — "who in this team recorded this exact 64-hex curve fingerprint" — which is why this
 * server is structurally incapable of returning a copied/not-copied verdict: there is no
 * similarity code on the default path and no score, distance or decision field in the schema to
 * put one in.
 *
 * <p>{@code algorithmVersion} is <strong>not</strong> a query parameter. Each row carries its own,
 * and the client classifies it: same version is a match, a recognized-but-different version reads
 * "recorded under a different fingerprint version — not comparable", an unrecognized one reads
 * "unknown fingerprint format". Filtering here instead would silently drop exactly the rows a
 * person most needs to be told about.
 */
@RestController
@RequestMapping("/api/v1/teams/{teamId}/provenance-claims")
public class ProvenanceClaimController {

    /**
     * A share. The four VERIFIED-ish fields ({@code fingerprint}, {@code algorithmVersion},
     * {@code clipName}, {@code durationSeconds}) come from the sharer's own local snapshot row;
     * the rest is DECLARED text a person typed.
     */
    public record ShareClaimRequest(String fingerprint, String algorithmVersion, String clipName,
                                    double durationSeconds, Long robloxAssetId, String ownershipContext,
                                    String declaredSource, String declaredLicense, String declaredNote,
                                    Instant observedAt) {
    }

    public record RetractRequest(String reason) {
    }

    /**
     * The share response.
     *
     * @param alreadyShared     true when an identical live claim already existed, so this call
     *                          created nothing (HTTP 200 rather than 201)
     * @param declarationsDiffer true when this request's declared fields differ from the stored
     *                          claim's. The UI must then say "already shared — retract to change"
     *                          rather than implying the new text was recorded: an append-only row
     *                          is never quietly overwritten
     */
    public record ShareClaimResponse(TeamService.ClaimView claim, boolean alreadyShared,
                                     boolean declarationsDiffer) {
    }

    private final TeamService teams;

    public ProvenanceClaimController(TeamService teams) {
        this.teams = teams;
    }

    @PostMapping
    public ResponseEntity<ShareClaimResponse> share(
            @PathVariable long teamId,
            @RequestBody ShareClaimRequest request,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        if (request == null) throw new ApiException(HttpStatus.BAD_REQUEST, "A claim body is required.");
        TeamService.ShareResult result = teams.share(teamId, user.getId(), new TeamService.ShareRequest(
                request.fingerprint(), request.algorithmVersion(), request.clipName(),
                request.durationSeconds(), request.robloxAssetId(), request.ownershipContext(),
                request.declaredSource(), request.declaredLicense(), request.declaredNote(),
                request.observedAt()));
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(new ShareClaimResponse(result.claim(), !result.created(), result.declarationsDiffer()));
    }

    /**
     * {@code ?fingerprint=<64hex>} for the team lookup, {@code ?mine=true} for "what have I
     * shared". Exactly one of the two; there is no unfiltered list of everything the team has
     * recorded, because browsing a provenance log is not a thing this product does.
     */
    @GetMapping
    public List<TeamService.ClaimView> list(
            @PathVariable long teamId,
            @RequestParam(required = false) String fingerprint,
            @RequestParam(required = false, defaultValue = "false") boolean mine,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        if (mine) return teams.mine(teamId, user.getId());
        if (fingerprint == null || fingerprint.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "Supply ?fingerprint=<64 hex> to look one up, or ?mine=true for your own claims.");
        }
        return teams.lookup(teamId, user.getId(), fingerprint);
    }

    /** The false-accusation kill switch: author or team owner, reason required. */
    @PostMapping("/{claimId}/retract")
    public TeamService.ClaimView retract(
            @PathVariable long teamId,
            @PathVariable long claimId,
            @RequestBody RetractRequest request,
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return teams.retract(teamId, user.getId(), claimId,
                request == null ? null : request.reason());
    }
}
