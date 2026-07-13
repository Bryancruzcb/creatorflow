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
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

/**
 * One creative work fingerprinted in the registry can exist on Roblox as a
 * different asset id per uploader — an animation re-uploaded under a group
 * gets a new id, and only the owner-matching id plays in a game. This maps a
 * registered asset to its Roblox id within one ownership context
 * (e.g. {@code group:12345}, {@code user:98765}); the fingerprint is the
 * stable identity Roblox itself doesn't keep.
 */
@Entity
@Table(name = "asset_id_mappings",
        uniqueConstraints = @UniqueConstraint(name = "uc_mapping_asset_context",
                columnNames = {"asset_id", "context"}))
public class AssetIdMapping {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "asset_id")
    private RegisteredAsset asset;

    /** Ownership context the id is valid in, normalized lowercase, e.g. {@code group:12345}. */
    @Column(nullable = false, length = 80)
    private String context;

    @Column(nullable = false)
    private long robloxAssetId;

    @Column(nullable = false)
    private Instant updatedAt;

    protected AssetIdMapping() {
        // JPA
    }

    public AssetIdMapping(RegisteredAsset asset, String context, long robloxAssetId) {
        this.asset = asset;
        this.context = context;
        this.robloxAssetId = robloxAssetId;
        this.updatedAt = Instant.now();
    }

    /** A re-upload in the same context supersedes the previous id. */
    public void replaceRobloxAssetId(long robloxAssetId) {
        this.robloxAssetId = robloxAssetId;
        this.updatedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public RegisteredAsset getAsset() {
        return asset;
    }

    public String getContext() {
        return context;
    }

    public long getRobloxAssetId() {
        return robloxAssetId;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
