package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonIgnore;
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
@JsonPropertyOrder({"$schema", "project", "generatedAt", "summary", "assets"})
public record CreativeManifest(
        @JsonProperty("$schema") String schema,
        Project project,
        Instant generatedAt,
        Summary summary,
        List<AssetEntry> assets) {

    public static final String SCHEMA = "creatorflow.manifest/v0.1";

    public CreativeManifest {
        if (!SCHEMA.equals(schema)) {
            throw new IllegalArgumentException("Unsupported manifest schema: " + schema);
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
