package creatorflow.server.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "accounts")
public class UserAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String username;

    @Column(nullable = false, unique = true)
    private String apiKey;

    /** BCrypt hash for web login; accounts created through the API alone have none. */
    private String passwordHash;

    /** Shown in the gallery; falls back to the username. */
    private String displayName;

    @Column(nullable = false)
    private Instant createdAt;

    protected UserAccount() {
        // JPA
    }

    public UserAccount(String username, String apiKey) {
        this.username = username;
        this.apiKey = apiKey;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getApiKey() {
        return apiKey;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    /** Gallery-facing name: the display name when set, the username otherwise. */
    public String getPublicName() {
        return displayName == null || displayName.isBlank() ? username : displayName;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedDisplay() {
        return Dates.display(createdAt);
    }
}
