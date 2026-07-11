package creatorflow.server.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;

/** Fingerprints and declaration for one uploaded asset. The file itself never reaches the server. */
@Entity
@Table(name = "registered_assets", indexes = @Index(name = "idx_asset_sha", columnList = "sha256"))
public class RegisteredAsset {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "owner_id")
    private UserAccount owner;

    @Column(nullable = false)
    private String fileName;

    @Column(nullable = false)
    private String fileType;

    private long sizeBytes;

    @Column(nullable = false, length = 64)
    private String sha256;

    private Long dHash;
    private Long pHash;
    private Long audioFp;

    @Column(nullable = false)
    private String license;

    private boolean ownershipDeclared;

    @Column(nullable = false)
    private Instant createdAt;

    /*
     * Gallery fields — set only when the asset was uploaded with its file through
     * the web platform. Fingerprint-only registrations from the desktop app leave
     * them null, so schema updates stay compatible with existing databases.
     */

    /** True when the file itself is stored and the asset appears in the public gallery. */
    private Boolean hasFile;

    private String title;

    @Column(length = 2000)
    private String description;

    private String mimeType;

    /** Verdict recorded at upload time: CLEAR, SIMILAR or DUPLICATE. */
    private String verdict;

    /** Full originality report (matches, findings, layers) as JSON. */
    @Lob
    private String reportJson;

    private Integer width;
    private Integer height;

    protected RegisteredAsset() {
        // JPA
    }

    public RegisteredAsset(UserAccount owner, String fileName, String fileType, long sizeBytes,
                           String sha256, Long dHash, Long pHash, Long audioFp,
                           String license, boolean ownershipDeclared) {
        this.owner = owner;
        this.fileName = fileName;
        this.fileType = fileType;
        this.sizeBytes = sizeBytes;
        this.sha256 = sha256;
        this.dHash = dHash;
        this.pHash = pHash;
        this.audioFp = audioFp;
        this.license = license;
        this.ownershipDeclared = ownershipDeclared;
        this.createdAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public UserAccount getOwner() {
        return owner;
    }

    public String getFileName() {
        return fileName;
    }

    public String getFileType() {
        return fileType;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public String getSha256() {
        return sha256;
    }

    public Long getDHash() {
        return dHash;
    }

    public Long getPHash() {
        return pHash;
    }

    public Long getAudioFp() {
        return audioFp;
    }

    public String getLicense() {
        return license;
    }

    public boolean isOwnershipDeclared() {
        return ownershipDeclared;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedDisplay() {
        return Dates.display(createdAt);
    }

    /** Attach the stored file and upload-time report, making the asset public in the gallery. */
    public void publishToGallery(String title, String description, String mimeType,
                                 String verdict, String reportJson, Integer width, Integer height) {
        this.hasFile = true;
        this.title = title;
        this.description = description;
        this.mimeType = mimeType;
        this.verdict = verdict;
        this.reportJson = reportJson;
        this.width = width;
        this.height = height;
    }

    public boolean isGalleryAsset() {
        return Boolean.TRUE.equals(hasFile);
    }

    public String getTitle() {
        return title;
    }

    /** Gallery card heading: the title when present, the file name otherwise. */
    public String getDisplayTitle() {
        return title == null || title.isBlank() ? fileName : title;
    }

    public String getDescription() {
        return description;
    }

    public String getMimeType() {
        return mimeType;
    }

    public boolean isImage() {
        return mimeType != null && mimeType.startsWith("image/");
    }

    public boolean isAudio() {
        return mimeType != null && mimeType.startsWith("audio/");
    }

    public String getVerdict() {
        return verdict;
    }

    public boolean isFlaggedSimilar() {
        return "SIMILAR".equals(verdict);
    }

    public String getReportJson() {
        return reportJson;
    }

    public Integer getWidth() {
        return width;
    }

    public Integer getHeight() {
        return height;
    }
}
