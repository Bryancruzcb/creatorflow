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

/**
 * Feedback on a published asset. A comment may carry a pin — normalized
 * coordinates (0..1) of a point on the artwork itself, frame.io-style.
 */
@Entity
@Table(name = "comments")
public class Comment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "asset_id")
    private RegisteredAsset asset;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "author_id")
    private UserAccount author;

    @Column(nullable = false, length = 1000)
    private String body;

    private Double pinX;
    private Double pinY;

    @Column(nullable = false)
    private Instant createdAt;

    protected Comment() {
        // JPA
    }

    public Comment(RegisteredAsset asset, UserAccount author, String body, Double pinX, Double pinY) {
        this.asset = asset;
        this.author = author;
        this.body = body;
        this.pinX = pinX;
        this.pinY = pinY;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public RegisteredAsset getAsset() {
        return asset;
    }

    public UserAccount getAuthor() {
        return author;
    }

    public String getBody() {
        return body;
    }

    public Double getPinX() {
        return pinX;
    }

    public Double getPinY() {
        return pinY;
    }

    public boolean isPinned() {
        return pinX != null && pinY != null;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedDisplay() {
        return Dates.display(createdAt);
    }
}
