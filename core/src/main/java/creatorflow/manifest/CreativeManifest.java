package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import creatorflow.model.VerificationStatus;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/** Portable, versioned evidence inventory for one creative-project release. */
@JsonPropertyOrder({"$schema", "project", "experience", "generatedAt", "summary", "gate", "assets"})
public record CreativeManifest(
        @JsonProperty("$schema") String schema,
        Project project,
        Instant generatedAt,
        Summary summary,
        List<AssetEntry> assets,
        @JsonInclude(JsonInclude.Include.NON_NULL) IntendedExperience experience,
        @JsonInclude(JsonInclude.Include.NON_NULL) Gate gate) {

    /** The prior manifest schema. Still readable/validatable; carries no {@code gate}. */
    public static final String SCHEMA_V1 = "creatorflow.manifest/v0.1";

    /** The current manifest schema: a release manifest is now self-contained with its gate result. */
    public static final String SCHEMA_V2 = "creatorflow.manifest/v0.2";

    /** Schema used by newly produced manifests. */
    public static final String SCHEMA = SCHEMA_V2;

    private static final Set<String> SUPPORTED_SCHEMAS = Set.of(SCHEMA_V1, SCHEMA_V2);

    /** Convenience constructor for the common case of a manifest with no declared experience or gate. */
    public CreativeManifest(String schema, Project project, Instant generatedAt, Summary summary,
                            List<AssetEntry> assets) {
        this(schema, project, generatedAt, summary, assets, null, null);
    }

    /** Convenience constructor for a manifest with a declared experience but no embedded gate. */
    public CreativeManifest(String schema, Project project, Instant generatedAt, Summary summary,
                            List<AssetEntry> assets, IntendedExperience experience) {
        this(schema, project, generatedAt, summary, assets, experience, null);
    }

    public CreativeManifest {
        if (!SUPPORTED_SCHEMAS.contains(schema)) {
            throw new IllegalArgumentException("Unsupported manifest schema: " + schema);
        }
        if (SCHEMA_V2.equals(schema) && gate == null) {
            throw new IllegalArgumentException("A " + SCHEMA_V2 + " manifest must carry a gate block");
        }
        if (SCHEMA_V1.equals(schema) && gate != null) {
            throw new IllegalArgumentException("A " + SCHEMA_V1 + " manifest must not carry a gate block");
        }
        project = Objects.requireNonNull(project, "project");
        generatedAt = Objects.requireNonNull(generatedAt, "generatedAt");
        summary = Objects.requireNonNull(summary, "summary");
        assets = List.copyOf(Objects.requireNonNull(assets, "assets"));

        Set<String> paths = new HashSet<>();
        for (AssetEntry asset : assets) {
            if (!paths.add(asset.path())) {
                throw new IllegalArgumentException("Manifest asset paths must be unique: " + asset.path());
            }
            for (Match match : asset.matches()) {
                if (match.matchedAssetId() > assets.size()) {
                    throw new IllegalArgumentException("Match asset ID is outside the manifest range: "
                            + match.matchedAssetId());
                }
            }
        }

        Summary actual = summarize(assets);
        if (!summary.equals(actual)) {
            throw new IllegalArgumentException("Manifest summary does not match its assets; expected " + actual);
        }
    }

    public record Project(String name, String release) {
        public Project {
            name = requireText(name, "project name");
            release = requireText(release, "release");
        }
    }

    /**
     * The release gate's outcome, embedded directly in a v0.2 manifest so it is self-contained.
     *
     * <p><strong>Honesty constraint:</strong> {@code result} reflects process/evidence completeness
     * (decisions resolved, sources present, flags approved) — it is not a copyright or originality
     * verdict. A {@code PASS} must never be presented as "original", "clean", or "cleared for
     * copyright"; it means the release checklist is complete, nothing more.
     */
    @JsonPropertyOrder({"result", "reasons"})
    public record Gate(String result, List<Reason> reasons) {
        private static final Set<String> RESULTS = Set.of("PASS", "BLOCKED");

        public Gate {
            if (!RESULTS.contains(result)) {
                throw new IllegalArgumentException("Gate result must be PASS or BLOCKED: " + result);
            }
            reasons = List.copyOf(Objects.requireNonNull(reasons, "reasons"));
        }

        /** One asset-level blocking reason, mirroring {@link ReleaseGate.Violation}'s evidence pointer. */
        @JsonPropertyOrder({"code", "assetPath", "verification", "decision", "message"})
        public record Reason(String code, String assetPath, String verification, String decision, String message) {
            public Reason {
                code = requireText(code, "gate reason code");
                assetPath = requireText(assetPath, "gate reason asset path");
                verification = requireText(verification, "gate reason verification");
                decision = requireText(decision, "gate reason decision");
                message = requireText(message, "gate reason message");
            }
        }
    }

    /**
     * A user-declared intended Roblox experience binding for this release. This is a human
     * declaration only — CreatorFlow does not verify ownership of or access to the experience.
     */
    public record IntendedExperience(long universeId, long placeId, String experienceName) {
        public IntendedExperience {
            if (universeId < 1) throw new IllegalArgumentException("universeId must be positive");
            if (placeId < 1) throw new IllegalArgumentException("placeId must be positive");
            experienceName = requireText(experienceName, "experience name");
        }
    }

    public record Summary(int total, int clear, int similar, int duplicate,
                          int unresolvedSources, int pendingDecisions) {
        public Summary {
            if (total < 0 || clear < 0 || similar < 0 || duplicate < 0
                    || unresolvedSources < 0 || pendingDecisions < 0) {
                throw new IllegalArgumentException("Manifest summary counts cannot be negative");
            }
            if (clear + similar + duplicate != total) {
                throw new IllegalArgumentException("Verification counts must add up to total assets");
            }
        }
    }

    public record Fingerprints(String dHash, String pHash, String audio) {
        public static Fingerprints of(Long dHash, Long pHash, Long audio) {
            return new Fingerprints(hex(dHash), hex(pHash), hex(audio));
        }

        private static String hex(Long value) {
            return value == null ? null : "%016x".formatted(value);
        }
    }

    public record SourceEvidence(String source, String license, String evidenceUrl) {
        public SourceEvidence {
            source = cleanOptional(source);
            license = cleanOptional(license);
            evidenceUrl = cleanOptional(evidenceUrl);
            if (evidenceUrl != null && !isSafeEvidenceUrl(evidenceUrl)) {
                throw new IllegalArgumentException("Evidence URL must use http or https: " + evidenceUrl);
            }
        }

        public static SourceEvidence unresolved() {
            return new SourceEvidence(null, null, null);
        }

        @JsonIgnore
        public boolean resolved() {
            return source != null && !source.isBlank() && license != null && !license.isBlank();
        }
    }

    public enum ReleaseDecision {
        PENDING,
        APPROVED,
        NEEDS_REVIEW,
        BLOCKED,
        EXCLUDED
    }

    public record Match(long matchedAssetId, String matchedFileName, String layer,
                        int distance, String note) {
        public Match {
            if (matchedAssetId < 1) throw new IllegalArgumentException("Matched asset ID must be positive");
            matchedFileName = requireText(matchedFileName, "matched file name");
            layer = requireText(layer, "match layer");
            note = requireText(note, "match note");
            if (distance < 0) throw new IllegalArgumentException("Match distance cannot be negative");
        }
    }

    @JsonPropertyOrder({"path", "fileName", "fileType", "sizeBytes", "sha256", "width", "height",
            "fingerprints", "verification", "source", "decision", "matches", "findings"})
    public record AssetEntry(
            String path,
            String fileName,
            String fileType,
            long sizeBytes,
            String sha256,
            int width,
            int height,
            Fingerprints fingerprints,
            VerificationStatus verification,
            SourceEvidence source,
            ReleaseDecision decision,
            List<Match> matches,
            List<String> findings) {

        public AssetEntry {
            path = requirePortablePath(path);
            fileName = requireText(fileName, "file name");
            fileType = Objects.requireNonNull(fileType, "fileType");
            if (sizeBytes < 0) throw new IllegalArgumentException("Asset size cannot be negative");
            if (sha256 == null || !sha256.matches("[0-9a-f]{64}")) {
                throw new IllegalArgumentException("SHA-256 must be lowercase 64-hex");
            }
            if (width < 0 || height < 0) {
                throw new IllegalArgumentException("Asset dimensions cannot be negative");
            }
            fingerprints = Objects.requireNonNull(fingerprints, "fingerprints");
            verification = Objects.requireNonNull(verification, "verification");
            source = Objects.requireNonNull(source, "source");
            decision = Objects.requireNonNull(decision, "decision");
            matches = List.copyOf(matches);
            findings = List.copyOf(findings);
        }
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }

    private static String requirePortablePath(String value) {
        String path = requireText(value, "asset path").replace('\\', '/');
        if (path.startsWith("/") || path.matches("^[A-Za-z]:/.*")) {
            throw new IllegalArgumentException("Manifest paths must be project-relative: " + path);
        }
        for (String segment : path.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                throw new IllegalArgumentException("Manifest paths must be normalized and project-relative: " + path);
            }
        }
        return path;
    }

    private static Summary summarize(List<AssetEntry> assets) {
        int clear = 0;
        int similar = 0;
        int duplicate = 0;
        int unresolved = 0;
        int pending = 0;
        for (AssetEntry asset : assets) {
            switch (asset.verification()) {
                case CLEAR -> clear++;
                case SIMILAR -> similar++;
                case DUPLICATE -> duplicate++;
            }
            if (!asset.source().resolved()) unresolved++;
            if (asset.decision() == ReleaseDecision.PENDING) pending++;
        }
        return new Summary(assets.size(), clear, similar, duplicate, unresolved, pending);
    }

    private static String cleanOptional(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static boolean isSafeEvidenceUrl(String value) {
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    && uri.getHost() != null;
        } catch (URISyntaxException invalid) {
            return false;
        }
    }
}
