package creatorflow.server.web;

import creatorflow.server.domain.RegisteredAsset;
import creatorflow.server.domain.UserAccount;
import creatorflow.server.repo.RegisteredAssetRepository;
import creatorflow.server.service.RegistryService;
import java.time.Instant;
import java.util.List;
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
public class RegistryController {

    public record VerifyRequest(String fileName, String sha256, Long dHash, Long pHash, Long audioFp) {
    }

    public record RegisterRequest(String fileName, String fileType, long sizeBytes, String sha256,
                                  Long dHash, Long pHash, Long audioFp,
                                  String license, boolean ownershipDeclared) {
    }

    public record AssetResponse(long id, String fileName, String fileType, long sizeBytes,
                                String sha256, String license, boolean ownershipDeclared,
                                Instant createdAt) {
    }

    private final RegistryService registry;
    private final RegisteredAssetRepository assets;

    public RegistryController(RegistryService registry, RegisteredAssetRepository assets) {
        this.registry = registry;
        this.assets = assets;
    }

    /** Check fingerprints against every account's registered assets. The file itself never travels. */
    @PostMapping("/verify")
    public RegistryService.Verdict verify(@RequestBody VerifyRequest request,
                                          @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        requireSha(request.sha256());
        return registry.verify(new RegistryService.Fingerprints(
                request.fileName(), request.sha256(), request.dHash(), request.pHash(),
                request.audioFp()), user);
    }

    @PostMapping("/assets")
    public ResponseEntity<AssetResponse> register(@RequestBody RegisterRequest request,
                                                  @RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        requireSha(request.sha256());
        if (request.fileName() == null || request.fileName().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "fileName is required.");
        }
        RegisteredAsset saved = assets.save(new RegisteredAsset(
                user,
                request.fileName().strip(),
                request.fileType() == null ? "" : request.fileType(),
                request.sizeBytes(),
                request.sha256().toLowerCase(),
                request.dHash(), request.pHash(), request.audioFp(),
                request.license() == null || request.license().isBlank() ? "Unknown" : request.license(),
                request.ownershipDeclared()));
        return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(saved));
    }

    @GetMapping("/assets/mine")
    public List<AssetResponse> mine(@RequestAttribute(ApiKeyInterceptor.ACCOUNT_ATTRIBUTE) UserAccount user) {
        return assets.findByOwnerIdOrderByCreatedAtDesc(user.getId()).stream()
                .map(RegistryController::toResponse)
                .toList();
    }

    private static void requireSha(String sha256) {
        if (sha256 == null || !sha256.matches("[0-9a-fA-F]{64}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "sha256 must be a 64-hex-character hash.");
        }
    }

    private static AssetResponse toResponse(RegisteredAsset asset) {
        return new AssetResponse(asset.getId(), asset.getFileName(), asset.getFileType(),
                asset.getSizeBytes(), asset.getSha256(), asset.getLicense(),
                asset.isOwnershipDeclared(), asset.getCreatedAt());
    }
}
