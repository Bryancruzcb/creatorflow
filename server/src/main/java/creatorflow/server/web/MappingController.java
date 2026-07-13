package creatorflow.server.web;

import creatorflow.server.domain.AssetIdMapping;
import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.AssetIdMappingRepository;
import creatorflow.server.repo.RegisteredAssetRepository;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Roblox asset-id mappings: the same fingerprinted work carries a different
 * Roblox id per ownership context (see {@link AssetIdMapping}). Owner-only —
 * mappings are workflow data for the account that registered the asset.
 */
@RestController
@RequestMapping("/api/v1")
public class MappingController {

    public record MappingRequest(String context, Long robloxAssetId) {
    }

    public record MappingResponse(long id, long assetId, String context, long robloxAssetId,
                                  Instant updatedAt) {
    }

    private final RegisteredAssetRepository assets;
    private final AssetIdMappingRepository mappings;

    public MappingController(RegisteredAssetRepository assets, AssetIdMappingRepository mappings) {
        this.assets = assets;
        this.mappings = mappings;
    }

    /** Upsert: a re-upload in the same context replaces that context's id. */
    @PostMapping("/assets/{assetId}/mappings")
    public ResponseEntity<MappingResponse> put(@PathVariable long assetId,
                                               @RequestBody MappingRequest request,
                                               @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        RegisteredAsset asset = ownedAsset(assetId, user);
        String context = normalizeContext(request.context());
        if (request.robloxAssetId() == null || request.robloxAssetId() <= 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "robloxAssetId must be a positive id.");
        }

        AssetIdMapping existing = mappings.findByAssetIdAndContext(asset.getId(), context).orElse(null);
        if (existing != null) {
            existing.replaceRobloxAssetId(request.robloxAssetId());
            return ResponseEntity.ok(toResponse(mappings.save(existing)));
        }
        AssetIdMapping saved = mappings.save(new AssetIdMapping(asset, context, request.robloxAssetId()));
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(saved));
    }

    @GetMapping("/assets/{assetId}/mappings")
    public List<MappingResponse> list(@PathVariable long assetId,
                                      @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        RegisteredAsset asset = ownedAsset(assetId, user);
        return mappings.findByAssetIdOrderByContextAsc(asset.getId()).stream()
                .map(MappingController::toResponse)
                .toList();
    }

    /** 404 for both missing and foreign assets, so ids can't be probed. */
    private RegisteredAsset ownedAsset(long assetId, UserAccount user) {
        return assets.findById(assetId)
                .filter(asset -> asset.getOwner().getId().equals(user.getId()))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Asset not found."));
    }

    private static String normalizeContext(String context) {
        String normalized = context == null ? "" : context.strip().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty() || normalized.length() > 80) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "context is required (1-80 chars), e.g. \"group:12345\" or \"user:98765\".");
        }
        return normalized;
    }

    private static MappingResponse toResponse(AssetIdMapping mapping) {
        return new MappingResponse(mapping.getId(), mapping.getAsset().getId(),
                mapping.getContext(), mapping.getRobloxAssetId(), mapping.getUpdatedAt());
    }
}
