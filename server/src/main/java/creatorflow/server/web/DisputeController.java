package creatorflow.server.web;

import creatorflow.server.domain.Dispute;
import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.DisputeRepository;
import creatorflow.server.repo.RegisteredAssetRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class DisputeController {

    public record FileDisputeRequest(long assetId, String reason) {
    }

    public record DisputeResponse(long id, long assetId, String assetFileName, String assetOwner,
                                  String claimant, String reason, String status, Instant createdAt) {
    }

    private final DisputeRepository disputes;
    private final RegisteredAssetRepository assets;

    public DisputeController(DisputeRepository disputes, RegisteredAssetRepository assets) {
        this.disputes = disputes;
        this.assets = assets;
    }

    /** File an ownership claim against someone else's registered asset. */
    @PostMapping("/disputes")
    public ResponseEntity<DisputeResponse> file(@RequestBody FileDisputeRequest request,
                                                @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        if (request.reason() == null || request.reason().strip().length() < 10) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "A dispute needs a reason of at least 10 characters.");
        }
        RegisteredAsset asset = assets.findById(request.assetId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND,
                        "No registered asset with id " + request.assetId() + "."));
        if (asset.getOwner().getId().equals(user.getId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "You cannot dispute your own asset.");
        }
        Dispute saved = disputes.save(new Dispute(asset, user, request.reason().strip()));
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(saved));
    }

    /** Disputes I filed, and disputes filed against my assets. */
    @GetMapping("/disputes/mine")
    public Map<String, List<DisputeResponse>> mine(
            @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return Map.of(
                "filed", disputes.findByClaimantIdOrderByCreatedAtDesc(user.getId()).stream()
                        .map(DisputeController::toResponse).toList(),
                "received", disputes.findByAsset_Owner_IdOrderByCreatedAtDesc(user.getId()).stream()
                        .map(DisputeController::toResponse).toList());
    }

    private static DisputeResponse toResponse(Dispute dispute) {
        return new DisputeResponse(
                dispute.getId(),
                dispute.getAsset().getId(),
                dispute.getAsset().getFileName(),
                dispute.getAsset().getOwner().getUsername(),
                dispute.getClaimant().getUsername(),
                dispute.getReason(),
                dispute.getStatus(),
                dispute.getCreatedAt());
    }
}
