package creatorflow.workflow;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import creatorflow.db.AuditRepository;
import creatorflow.db.Database;
import creatorflow.db.DecisionRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.ReleaseRepository;
import creatorflow.db.ScanRepository;
import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Fingerprints;
import creatorflow.manifest.CreativeManifest.Match;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.manifest.ManifestJson;
import creatorflow.manifest.ReleaseGate;
import creatorflow.model.VerificationStatus;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Reconstructs and persists releases exclusively from one immutable SQLite scan snapshot. */
public final class ReleaseExportService {

    private final Database database;
    private final LocalProjectRepository projects;
    private final ScanRepository scans;
    private final DecisionRepository decisions;
    private final ReleaseRepository releases;
    private final AuditRepository audit;
    private final ManifestJson manifests = new ManifestJson();
    private final ObjectMapper json = JsonMapper.builder()
            .addModule(new JavaTimeModule())
            .serializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .enable(SerializationFeature.INDENT_OUTPUT)
            .build();

    public ReleaseExportService(Database database, LocalProjectRepository projects,
                                ScanRepository scans, DecisionRepository decisions,
                                ReleaseRepository releases, AuditRepository audit) {
        this.database = Objects.requireNonNull(database, "database");
        this.projects = Objects.requireNonNull(projects, "projects");
        this.scans = Objects.requireNonNull(scans, "scans");
        this.decisions = Objects.requireNonNull(decisions, "decisions");
        this.releases = Objects.requireNonNull(releases, "releases");
        this.audit = Objects.requireNonNull(audit, "audit");
    }

    public ReleaseBundle create(long projectId, String scanRunId, String releaseName) {
        String cleanRunId = requireText(scanRunId, "scan run");
        String cleanRelease = requireText(releaseName, "release name");
        return database.transaction(() -> createInTransaction(projectId, cleanRunId, cleanRelease));
    }

    private ReleaseBundle createInTransaction(long projectId, String scanRunId, String releaseName) {
        LocalProject project = projects.findByProjectId(projectId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown local project " + projectId));
        ScanRun run = scans.findById(scanRunId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown scan run " + scanRunId));
        if (run.projectId() != projectId) throw new IllegalArgumentException("Scan does not belong to project");
        if (run.state() != ScanState.COMPLETED) {
            throw new IllegalStateException("Only a completed immutable scan can become a release");
        }

        List<ScanAsset> persistedAssets = scans.listAllAssets(scanRunId);
        Map<Integer, ScanAsset> byOrdinal = persistedAssets.stream().collect(Collectors.toMap(
                ScanAsset::ordinal, Function.identity(), (left, right) -> left, HashMap::new));
        Map<Long, List<ScanFinding>> findings = scans.findingsForRun(scanRunId);
        Map<Long, SourceEvidenceRecord> evidence = scans.latestEvidenceForRun(scanRunId);
        Map<Long, DecisionRecord> latestDecisions = decisions.latestForRun(scanRunId);

        List<AssetEntry> entries = new ArrayList<>(persistedAssets.size());
        for (ScanAsset asset : persistedAssets) {
            SourceEvidenceRecord evidenceRecord = evidence.get(asset.id());
            SourceEvidence source = evidenceRecord == null ? SourceEvidence.unresolved()
                    : new SourceEvidence(evidenceRecord.source(), evidenceRecord.license(),
                            evidenceRecord.evidenceUrl());
            DecisionRecord decision = latestDecisions.get(asset.id());
            ReleaseDecision releaseDecision = decision == null ? ReleaseDecision.PENDING
                    : ReleaseDecision.valueOf(decision.type().name());
            List<Match> matches = findings.getOrDefault(asset.id(), List.of()).stream()
                    .filter(finding -> finding.matchedAssetOrdinal() != null)
                    .map(finding -> toMatch(finding, byOrdinal))
                    .sorted(Comparator.comparingLong(Match::matchedAssetId)
                            .thenComparing(Match::layer))
                    .toList();
            entries.add(new AssetEntry(asset.relativePath(), asset.fileName(), asset.fileType(),
                    asset.sizeBytes(), asset.sha256(), asset.width(), asset.height(),
                    new Fingerprints(asset.dHash(), asset.pHash(), asset.audioFingerprint()),
                    asset.verification(), source, releaseDecision, matches, asset.findings()));
        }

        CreativeManifest manifest = new CreativeManifest(CreativeManifest.SCHEMA,
                new CreativeManifest.Project(project.name(), releaseName), Instant.now(),
                summarize(entries), entries, intendedExperienceOf(project));
        ReleaseGate.Report report = new ReleaseGate().evaluate(manifest);
        ReleaseRecord previous = releases.latestForProject(projectId).orElse(null);
        ReleaseComparison comparison = compare(previous, manifest);
        String manifestJson = writeManifest(manifest);
        String reportJson = write(report);
        String comparisonJson = write(comparison);
        ReleaseRecord release = releases.insert(scanRunId, releaseName, manifestJson,
                report.passed() ? "PASS" : "BLOCKED", reportJson, comparisonJson,
                project.universeId(), project.placeId(), project.experienceName());
        audit.append(scanRunId, "RELEASE_CREATED", write(Map.of(
                "releaseId", release.id(), "passed", report.passed(),
                "violations", report.violations().size())));
        return new ReleaseBundle(release, manifest, report, comparison);
    }

    /**
     * The project's declared intended experience, if fully bound; null when the project
     * has no (or only a partial, which should never happen via the bridge) declaration.
     */
    private static CreativeManifest.IntendedExperience intendedExperienceOf(LocalProject project) {
        if (project.universeId() == null || project.placeId() == null || project.experienceName() == null) {
            return null;
        }
        return new CreativeManifest.IntendedExperience(
                project.universeId(), project.placeId(), project.experienceName());
    }

    private static Match toMatch(ScanFinding finding, Map<Integer, ScanAsset> byOrdinal) {
        int ordinal = finding.matchedAssetOrdinal();
        ScanAsset target = byOrdinal.get(ordinal);
        if (target == null) {
            throw new IllegalStateException("Persisted match references missing ordinal " + ordinal);
        }
        String layer = finding.matchLayer();
        Integer distance = finding.matchDistance();
        if (layer == null || distance == null) {
            throw new IllegalStateException("Persisted match is incomplete for asset " + finding.scanAssetId());
        }
        return new Match(ordinal, target.fileName(), layer, distance, finding.message());
    }

    private ReleaseComparison compare(ReleaseRecord previous, CreativeManifest current) {
        CreativeManifest prior = previous == null ? emptyPrevious(current) : read(previous.manifestJson());
        Map<String, AssetEntry> before = prior.assets().stream()
                .collect(Collectors.toMap(AssetEntry::path, Function.identity()));
        Map<String, AssetEntry> after = current.assets().stream()
                .collect(Collectors.toMap(AssetEntry::path, Function.identity()));
        TreeSet<String> added = new TreeSet<>(after.keySet());
        added.removeAll(before.keySet());
        TreeSet<String> removed = new TreeSet<>(before.keySet());
        removed.removeAll(after.keySet());
        TreeSet<String> changed = new TreeSet<>();
        for (String path : after.keySet()) {
            if (before.containsKey(path) && !after.get(path).equals(before.get(path))) changed.add(path);
        }
        int unresolved = (int) current.assets().stream().filter(asset -> !asset.source().resolved()).count();
        int approved = count(current, ReleaseDecision.APPROVED);
        int blocked = count(current, ReleaseDecision.BLOCKED);
        int excluded = count(current, ReleaseDecision.EXCLUDED);
        return new ReleaseComparison(previous == null ? null : previous.id(), added.size(), changed.size(),
                removed.size(), List.copyOf(added), List.copyOf(changed), List.copyOf(removed),
                unresolved, approved, blocked, excluded);
    }

    private static CreativeManifest emptyPrevious(CreativeManifest current) {
        return new CreativeManifest(CreativeManifest.SCHEMA, current.project(), current.generatedAt(),
                new CreativeManifest.Summary(0, 0, 0, 0, 0, 0), List.of());
    }

    private static int count(CreativeManifest manifest, ReleaseDecision decision) {
        return (int) manifest.assets().stream().filter(asset -> asset.decision() == decision).count();
    }

    private static CreativeManifest.Summary summarize(List<AssetEntry> assets) {
        int clear = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.CLEAR).count();
        int similar = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.SIMILAR).count();
        int duplicate = (int) assets.stream().filter(a -> a.verification() == VerificationStatus.DUPLICATE).count();
        int unresolved = (int) assets.stream().filter(a -> !a.source().resolved()).count();
        int pending = (int) assets.stream().filter(a -> a.decision() == ReleaseDecision.PENDING).count();
        return new CreativeManifest.Summary(assets.size(), clear, similar, duplicate, unresolved, pending);
    }

    private CreativeManifest read(String manifestJson) {
        try {
            return manifests.read(manifestJson);
        } catch (IOException e) {
            throw new IllegalStateException("A persisted release manifest is invalid", e);
        }
    }

    private String writeManifest(CreativeManifest manifest) {
        try {
            return manifests.write(manifest);
        } catch (IOException e) {
            throw new IllegalStateException("Could not serialize release manifest", e);
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value) + "\n";
        } catch (IOException e) {
            throw new IllegalStateException("Could not serialize release artifact", e);
        }
    }

    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.strip();
    }
}
