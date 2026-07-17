package creatorflow.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.Match;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.manifest.CreativeManifest.SourceEvidence;
import creatorflow.model.Asset;
import creatorflow.model.VerificationStatus;
import creatorflow.verification.OriginalityEngine;
import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.FileSystemLoopException;
import java.nio.file.FileVisitOption;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/** Recursively inventories supported creative files and runs the real verification engine. */
public final class ProjectScanner {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final OriginalityEngine engine;
    private final Clock clock;

    public ProjectScanner() {
        this(new OriginalityEngine(), Clock.systemUTC());
    }

    ProjectScanner(OriginalityEngine engine, Clock clock) {
        this.engine = Objects.requireNonNull(engine, "engine");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    /** Existing convenience API; behavior remains a complete scan with unresolved source evidence. */
    public CreativeManifest scan(Path root, String projectName, String release) throws IOException {
        return scan(root, projectName, release, SourceEvidenceResolver.unresolved());
    }

    /** Existing convenience API; behavior remains a complete scan using the supplied evidence resolver. */
    public CreativeManifest scan(Path root, String projectName, String release,
                                 SourceEvidenceResolver sourceResolver) throws IOException {
        return scanDetailed(root, projectName, release, sourceResolver, ScanOptions.defaults(),
                ScanObserver.noop(), new ScanCancellation()).manifest();
    }

    public ScanResult scanDetailed(Path root, String projectName, String release,
                                   SourceEvidenceResolver sourceResolver,
                                   ScanOptions options,
                                   ScanObserver observer,
                                   ScanCancellation cancellation) throws IOException {
        Objects.requireNonNull(root, "root");
        Objects.requireNonNull(sourceResolver, "sourceResolver");
        Objects.requireNonNull(options, "options");
        Objects.requireNonNull(observer, "observer");
        Objects.requireNonNull(cancellation, "cancellation");

        Path normalizedRoot = root.toAbsolutePath().normalize();
        if (!Files.isDirectory(normalizedRoot)) {
            throw new IllegalArgumentException("Project root is not a directory: " + root);
        }
        Path realRoot = normalizedRoot.toRealPath();
        String runId = UUID.randomUUID().toString();
        MutableStatistics statistics = new MutableStatistics();
        List<ScanProblem> problems = new ArrayList<>();
        EventEmitter events = new EventEmitter(runId, observer, clock, statistics);
        events.emit(ScanEvent.Type.STARTED, null, null, null);

        List<Path> files = inventory(realRoot, options, cancellation, statistics, problems, events);
        files.sort(Comparator.comparing(path -> portable(realRoot.relativize(path))));
        for (Path file : files) {
            statistics.supported++;
            events.emit(ScanEvent.Type.DISCOVERED, portable(realRoot.relativize(file)), null, null);
        }

        List<Asset> indexed = new ArrayList<>();
        List<AssetEntry> entries = new ArrayList<>();
        long id = 1;

        for (Path file : files) {
            if (cancellation.isCancelled()) break;
            Path relative = realRoot.relativize(file);
            String portablePath = portable(relative);
            events.emit(ScanEvent.Type.FILE_STARTED, portablePath, null, null);

            long size = 0;
            try {
                Path realFile = file.toRealPath();
                if (!realFile.startsWith(realRoot)) {
                    statistics.excluded++;
                    String message = "Resolved path escapes the selected project root";
                    problems.add(new ScanProblem(portablePath, ScanProblem.Code.EXCLUDED, message));
                    events.emit(ScanEvent.Type.FILE_SKIPPED, portablePath, message, null);
                    continue;
                }
                if (!Files.isReadable(realFile)) throw new AccessDeniedException(portablePath);
                size = Files.size(realFile);

                OriginalityEngine.Result result = engine.verify(realFile, indexed);
                List<String> findings = new ArrayList<>(result.report().findings());
                try {
                    for (String missing : missingDependencies(realFile,
                            OriginalityEngine.fileType(realFile))) {
                        statistics.missingDependencies++;
                        String message = "Missing dependency: " + missing;
                        findings.add(message);
                        problems.add(new ScanProblem(portablePath,
                                ScanProblem.Code.MISSING_DEPENDENCY, message));
                        events.emit(ScanEvent.Type.WARNING, portablePath, message, null);
                    }
                } catch (IOException | RuntimeException dependencyError) {
                    String message = "Could not inspect external dependencies: "
                            + safeMessage(dependencyError);
                    events.emit(ScanEvent.Type.WARNING, portablePath, message, null);
                }

                SourceEvidence source;
                try {
                    source = sourceResolver.resolve(relative);
                    if (source == null) source = SourceEvidence.unresolved();
                } catch (RuntimeException sourceError) {
                    source = SourceEvidence.unresolved();
                    String message = "Source evidence resolver failed: " + safeMessage(sourceError);
                    problems.add(new ScanProblem(portablePath,
                            ScanProblem.Code.SOURCE_RESOLUTION, message));
                    events.emit(ScanEvent.Type.WARNING, portablePath, message, null);
                }

                List<Match> matches = result.report().matches().stream()
                        .map(match -> new Match(match.matchedAssetId(), match.matchedFileName(),
                                match.layer(), match.distance(), match.note()))
                        .toList();

                AssetEntry entry = new AssetEntry(
                        portablePath,
                        file.getFileName().toString(),
                        OriginalityEngine.fileType(realFile),
                        size,
                        result.sha256(),
                        result.width(),
                        result.height(),
                        CreativeManifest.Fingerprints.of(result.dHash(), result.pHash(), result.audioFp()),
                        result.report().status(),
                        source,
                        ReleaseDecision.PENDING,
                        matches,
                        findings);
                entries.add(entry);

                indexed.add(new Asset(id++, 0, entry.fileName(), entry.path(), entry.fileType(), entry.sizeBytes(),
                        entry.width(), entry.height(), entry.sha256(), result.dHash(), result.pHash(), result.audioFp(),
                        source.license() == null ? "Unresolved" : source.license(), false,
                        entry.verification(), String.join("\n", entry.findings()), Instant.now(clock)));
                statistics.bytesProcessed += size;
            } catch (AccessDeniedException | NoSuchFileException unreadable) {
                statistics.unreadable++;
                String message = "File became unreadable during scan: " + safeMessage(unreadable);
                problems.add(new ScanProblem(portablePath, ScanProblem.Code.UNREADABLE, message));
                events.emit(ScanEvent.Type.ERROR, portablePath, null, message);
            } catch (IOException | RuntimeException failure) {
                statistics.failed++;
                String message = "File verification failed: " + safeMessage(failure);
                problems.add(new ScanProblem(portablePath, ScanProblem.Code.FAILED, message));
                events.emit(ScanEvent.Type.ERROR, portablePath, null, message);
            } finally {
                statistics.processed++;
                events.emit(ScanEvent.Type.FILE_COMPLETED, portablePath, null, null);
            }
        }

        ScanResult.State state = cancellation.isCancelled()
                ? ScanResult.State.CANCELLED : ScanResult.State.COMPLETED;
        CreativeManifest manifest = manifest(projectName, release, entries, Instant.now(clock));
        if (state == ScanResult.State.CANCELLED) {
            events.emit(ScanEvent.Type.CANCELLED, null, "Scan cancelled; partial manifest is available", null);
        } else {
            events.emit(ScanEvent.Type.COMPLETED, null, null, null);
        }
        return new ScanResult(runId, state, manifest, statistics.snapshot(), problems);
    }

    private List<Path> inventory(Path realRoot,
                                 ScanOptions options,
                                 ScanCancellation cancellation,
                                 MutableStatistics statistics,
                                 List<ScanProblem> problems,
                                 EventEmitter events) throws IOException {
        List<Path> files = new ArrayList<>();
        EnumSet<FileVisitOption> visitOptions = options.followSymbolicLinks()
                ? EnumSet.of(FileVisitOption.FOLLOW_LINKS) : EnumSet.noneOf(FileVisitOption.class);

        Files.walkFileTree(realRoot, visitOptions, Integer.MAX_VALUE, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path directory, BasicFileAttributes attributes) {
                if (cancellation.isCancelled()) return FileVisitResult.TERMINATE;
                if (directory.equals(realRoot)) return FileVisitResult.CONTINUE;
                Path relative = realRoot.relativize(directory);
                String path = portable(relative);
                String name = directory.getFileName().toString();
                if (options.excludesDirectory(name) || (!options.includeHidden() && isHiddenName(name))) {
                    exclude(path, "Directory excluded by scan policy");
                    return FileVisitResult.SKIP_SUBTREE;
                }
                try {
                    if (!directory.toRealPath().startsWith(realRoot)) {
                        exclude(path, "Directory symlink escapes the selected project root");
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                } catch (IOException error) {
                    unreadable(path, error);
                    return FileVisitResult.SKIP_SUBTREE;
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) {
                if (cancellation.isCancelled()) return FileVisitResult.TERMINATE;
                Path relative = realRoot.relativize(file);
                String path = portable(relative);
                String name = file.getFileName().toString();
                if (!options.includeHidden() && isHiddenName(name)) {
                    exclude(path, "Hidden file excluded by scan policy");
                    return FileVisitResult.CONTINUE;
                }
                if (Files.isSymbolicLink(file) && !options.followSymbolicLinks()) {
                    exclude(path, "Symbolic link excluded by scan policy");
                    return FileVisitResult.CONTINUE;
                }
                try {
                    Path realFile = file.toRealPath();
                    if (!realFile.startsWith(realRoot)) {
                        exclude(path, "File symlink escapes the selected project root");
                    } else if (!Files.isRegularFile(realFile)) {
                        statistics.ignored++;
                        events.emit(ScanEvent.Type.FILE_SKIPPED, path, "Non-regular file ignored", null);
                    } else if (!options.supports(OriginalityEngine.fileType(file))) {
                        statistics.ignored++;
                        events.emit(ScanEvent.Type.FILE_SKIPPED, path, "Unsupported file type ignored", null);
                    } else if (!Files.isReadable(realFile)) {
                        unreadable(path, new AccessDeniedException(path));
                    } else {
                        files.add(file);
                    }
                } catch (IOException error) {
                    unreadable(path, error);
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException error) {
                String path = safeRelative(realRoot, file);
                if (error instanceof FileSystemLoopException) {
                    exclude(path, "Symbolic-link loop excluded");
                } else {
                    unreadable(path, error);
                }
                return cancellation.isCancelled() ? FileVisitResult.TERMINATE : FileVisitResult.CONTINUE;
            }

            private void exclude(String path, String message) {
                statistics.excluded++;
                problems.add(new ScanProblem(path, ScanProblem.Code.EXCLUDED, message));
                events.emit(ScanEvent.Type.FILE_SKIPPED, path, message, null);
            }

            private void unreadable(String path, IOException error) {
                statistics.unreadable++;
                String message = "Unreadable path: " + safeMessage(error);
                problems.add(new ScanProblem(path, ScanProblem.Code.UNREADABLE, message));
                events.emit(ScanEvent.Type.ERROR, path, null, message);
            }
        });
        return files;
    }

    private static CreativeManifest manifest(String projectName, String release,
                                             List<AssetEntry> entries, Instant generatedAt) {
        int clear = count(entries, VerificationStatus.CLEAR);
        int similar = count(entries, VerificationStatus.SIMILAR);
        int duplicate = count(entries, VerificationStatus.DUPLICATE);
        int unresolved = (int) entries.stream().filter(entry -> !entry.source().resolved()).count();
        int pending = (int) entries.stream().filter(entry -> entry.decision() == ReleaseDecision.PENDING).count();
        // A bare scan never evaluates the release gate (that's ReleaseGate/ReleaseGateCli's job), so it
        // cannot self-certify a v0.2 gate block; it stays on the still-supported v0.1 schema.
        return new CreativeManifest(
                CreativeManifest.SCHEMA_V1,
                new CreativeManifest.Project(projectName, release),
                generatedAt,
                new CreativeManifest.Summary(entries.size(), clear, similar, duplicate, unresolved, pending),
                entries);
    }

    private static int count(List<AssetEntry> entries, VerificationStatus status) {
        return (int) entries.stream().filter(entry -> entry.verification() == status).count();
    }

    private static List<String> missingDependencies(Path file, String fileType) throws IOException {
        if ("gltf".equals(fileType)) return missingGltfDependencies(file);
        if ("obj".equals(fileType)) return missingObjDependencies(file);
        return List.of();
    }

    private static List<String> missingGltfDependencies(Path file) throws IOException {
        JsonNode root = JSON.readTree(file.toFile());
        List<String> missing = new ArrayList<>();
        collectMissingUris(file, root.path("buffers"), missing);
        collectMissingUris(file, root.path("images"), missing);
        return missing.stream().distinct().sorted().toList();
    }

    private static void collectMissingUris(Path file, JsonNode nodes, List<String> missing) {
        if (!nodes.isArray()) return;
        for (JsonNode node : nodes) {
            JsonNode uriNode = node.get("uri");
            if (uriNode == null || !uriNode.isTextual()) continue;
            String raw = uriNode.textValue();
            if (raw.startsWith("data:")) continue;
            try {
                URI uri = URI.create(raw);
                if (uri.isAbsolute()) continue;
                String decoded = URLDecoder.decode(uri.getPath(), StandardCharsets.UTF_8);
                Path dependency = file.getParent().resolve(decoded).normalize();
                if (!Files.isRegularFile(dependency)) missing.add(raw);
            } catch (IllegalArgumentException invalidUri) {
                missing.add(raw);
            }
        }
    }

    private static List<String> missingObjDependencies(Path file) throws IOException {
        List<String> missing = new ArrayList<>();
        for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
            String stripped = line.strip();
            if (!stripped.toLowerCase(Locale.ROOT).startsWith("mtllib ")) continue;
            String reference = stripped.substring(7).strip();
            if (!reference.isEmpty() && !Files.isRegularFile(file.getParent().resolve(reference).normalize())) {
                missing.add(reference);
            }
        }
        return missing.stream().distinct().sorted().toList();
    }

    private static boolean isHiddenName(String name) {
        return name.startsWith(".");
    }

    private static String safeRelative(Path root, Path path) {
        try {
            Path normalized = path.toAbsolutePath().normalize();
            return normalized.startsWith(root) ? portable(root.relativize(normalized)) : path.getFileName().toString();
        } catch (RuntimeException ignored) {
            return path.getFileName() == null ? "unknown" : path.getFileName().toString();
        }
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
    }

    private static String portable(Path path) {
        return path.toString().replace('\\', '/');
    }

    private static final class MutableStatistics {
        private int supported;
        private int ignored;
        private int excluded;
        private int unreadable;
        private int missingDependencies;
        private int failed;
        private long processed;
        private long bytesProcessed;

        private ScanStatistics snapshot() {
            return new ScanStatistics(supported, ignored, excluded, unreadable,
                    missingDependencies, failed, bytesProcessed);
        }
    }

    private static final class EventEmitter {
        private final String runId;
        private final ScanObserver observer;
        private final Clock clock;
        private final MutableStatistics statistics;
        private long sequence;

        private EventEmitter(String runId, ScanObserver observer, Clock clock, MutableStatistics statistics) {
            this.runId = runId;
            this.observer = observer;
            this.clock = clock;
            this.statistics = statistics;
        }

        private void emit(ScanEvent.Type type, String path, String warning, String error) {
            ScanEvent event = new ScanEvent(++sequence, runId, Instant.now(clock), type,
                    statistics.processed, statistics.supported, statistics.bytesProcessed,
                    path, warning, error);
            try {
                observer.onEvent(event);
            } catch (RuntimeException ignored) {
                // A disconnected progress consumer must not corrupt or abort the scan.
            }
        }
    }
}
