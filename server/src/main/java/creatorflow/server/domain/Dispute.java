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

/** An ownership claim against a registered asset (the DMCA-style process layer). */
@Entity
@Table(name = "disputes")
public class Dispute {

    public static final String STATUS_OPEN = "OPEN";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "asset_id")
    private RegisteredAsset asset;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "claimant_id")
    private UserAccount claimant;

    @Column(nullable = false, length = 2000)
    private String reason;

    @Column(nullable = false)
    private String status;

    @Column(nullable = false)
    private Instant createdAt;

    protected Dispute() {
        // JPA
    }

    public Dispute(RegisteredAsset asset, UserAccount claimant, String reason) {
        this.asset = asset;
        this.claimant = claimant;
        this.reason = reason;
        this.status = STATUS_OPEN;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public RegisteredAsset getAsset() {
        return asset;
    }

    public UserAccount getClaimant() {
        return claimant;
    }

    public String getReason() {
        return reason;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedDisplay() {
        return Dates.display(createdAt);
    }
}
