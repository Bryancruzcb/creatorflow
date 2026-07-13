package creatorflow.bridge;

import creatorflow.db.AuditRepository;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.ScanRepository;
import creatorflow.manifest.ProjectScanner;
import creatorflow.manifest.ScanCancellation;
import creatorflow.manifest.ScanEvent;
import creatorflow.manifest.ScanOptions;
import creatorflow.manifest.ScanResult;
import creatorflow.manifest.SourceEvidenceResolver;
import creatorflow.workflow.LocalProject;
import creatorflow.workflow.ScanAccounting;
import creatorflow.workflow.ScanRun;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/** Runs hardened core scans off the HTTP threads and publishes replayable progress events. */
public final class ScanCoordinator implements AutoCloseable {

    private final ScanRepository scans;
    private final LocalProjectRepository localProjects;
    private final AuditRepository audit;
    private final Supplier<ProjectScanner> scannerFactory;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String, ActiveRun> active = new ConcurrentHashMap<>();

    public ScanCoordinator(ScanRepository scans, LocalProjectRepository localProjects,
                           AuditRepository audit) {
        this(scans, localProjects, audit, ProjectScanner::new);
    }

    ScanCoordinator(ScanRepository scans, LocalProjectRepository localProjects,
                    AuditRepository audit, Supplier<ProjectScanner> scannerFactory) {
        this.scans = scans;
        this.localProjects = localProjects;
        this.audit = audit;
        this.scannerFactory = scannerFactory;
    }

    public ScanRun start(LocalProject project, String release, ScanOptions options) {
        ScanRun run = scans.create(project.projectId(), project.root(), release,
                List.copyOf(options.excludedDirectoryNames()), List.copyOf(options.supportedFileTypes()));
        localProjects.setActiveScanRun(project.projectId(), run.id());
        ActiveRun control = new ActiveRun();
        active.put(run.id(), control);
        executor.submit(() -> execute(run, project, options, control));
        return run;
    }

    public boolean cancel(String runId) {
        ActiveRun control = active.get(runId);
        boolean requested = scans.requestCancellation(runId);
        if (control != null) control.cancellation.cancel();
        return requested;
    }

    public List<ProgressEvent> eventsAfter(String runId, long sequence) {
        ActiveRun control = active.get(runId);
        return control == null ? List.of() : control.eventsAfter(sequence);
    }

    public List<ProgressEvent> awaitEvents(String runId, long sequence, long timeoutMillis)
            throws InterruptedException {
        ActiveRun control = active.get(runId);
        return control == null ? List.of() : control.awaitAfter(sequence, timeoutMillis);
    }

    private void execute(ScanRun run, LocalProject project, ScanOptions options, ActiveRun control) {
        List<String> warnings = new ArrayList<>();
        try {
            scans.markStarted(run.id());
            auditSafely(run.id(), "SCAN_STARTED", "{}");
            ScanResult result = scannerFactory.get().scanDetailed(project.root(), project.name(),
                    run.releaseName(), SourceEvidenceResolver.unresolved(), options,
                    event -> {
                        ProgressEvent mapped = control.add(run.id(), event);
                        if (mapped.warning() != null) warnings.add(mapped.warning());
                        if (control.shouldPersist(mapped)) {
                            scans.updateProgress(run.id(), boundedInt(mapped.discoveredFiles()),
                                    boundedInt(mapped.processedFiles()), mapped.bytesProcessed(), warnings);
                        }
                    }, control.cancellation);

            var statistics = result.statistics();
            ScanAccounting accounting = new ScanAccounting(statistics.supported(), statistics.ignored(),
                    statistics.excluded(), statistics.unreadable(), statistics.missingDependencies(),
                    statistics.failed(), statistics.bytesProcessed());
            result.problems().stream().map(problem -> problem.path() == null
                            ? problem.message() : problem.path() + ": " + problem.message())
                    .forEach(warnings::add);
            if (result.state() == ScanResult.State.CANCELLED) {
                scans.finishCancelled(run.id(), result.manifest(), accounting, warnings);
                auditSafely(run.id(), "SCAN_CANCELLED", "{}");
            } else {
                scans.complete(run.id(), result.manifest(), accounting, warnings);
                auditSafely(run.id(), "SCAN_COMPLETED", "{}");
            }
        } catch (Exception error) {
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            warnings.add(message);
            scans.markFailed(run.id(), message, warnings);
            control.addSystem(run.id(), ScanEvent.Type.ERROR, null, null, message);
            auditSafely(run.id(), "SCAN_FAILED", "{\"message\":" + jsonString(message) + "}");
        } finally {
            control.finish();
        }
    }

    @Override
    public void close() {
        active.values().forEach(run -> run.cancellation.cancel());
        executor.shutdownNow();
    }

    public record ProgressEvent(long sequence, String runId, Instant timestamp, ScanEvent.Type type,
                                long processedFiles, long discoveredFiles, long bytesProcessed,
                                String currentRelativePath, String warning, String error) {
    }

    private static final class ActiveRun {
        private static final int MAX_REPLAY_EVENTS = 4_000;
        private final ScanCancellation cancellation = new ScanCancellation();
        private final AtomicLong sequence = new AtomicLong();
        private final List<ProgressEvent> events = new ArrayList<>();
        private boolean finished;
        private long lastProgressPersistedAt;

        synchronized ProgressEvent add(String runId, ScanEvent event) {
            return append(new ProgressEvent(sequence.incrementAndGet(), runId, event.timestamp(), event.type(),
                    event.processedFiles(), event.discoveredFiles(), event.bytesProcessed(),
                    event.currentRelativePath(), event.warning(), event.error()));
        }

        synchronized ProgressEvent addSystem(String runId, ScanEvent.Type type, String path,
                                             String warning, String error) {
            return append(new ProgressEvent(sequence.incrementAndGet(), runId, Instant.now(), type,
                    0, 0, 0, path, warning, error));
        }

        private ProgressEvent append(ProgressEvent event) {
            events.add(event);
            if (events.size() > MAX_REPLAY_EVENTS) events.remove(0);
            notifyAll();
            return event;
        }

        synchronized List<ProgressEvent> eventsAfter(long lastSequence) {
            return events.stream().filter(event -> event.sequence() > lastSequence).toList();
        }

        synchronized boolean shouldPersist(ProgressEvent event) {
            long now = System.nanoTime();
            boolean important = event.type() == ScanEvent.Type.WARNING
                    || event.type() == ScanEvent.Type.ERROR
                    || event.type() == ScanEvent.Type.CANCELLED
                    || event.type() == ScanEvent.Type.COMPLETED;
            if (important || now - lastProgressPersistedAt >= 100_000_000L) {
                lastProgressPersistedAt = now;
                return true;
            }
            return false;
        }

        synchronized List<ProgressEvent> awaitAfter(long lastSequence, long timeoutMillis)
                throws InterruptedException {
            List<ProgressEvent> available = eventsAfter(lastSequence);
            if (available.isEmpty() && !finished) {
                wait(Math.max(1, timeoutMillis));
                available = eventsAfter(lastSequence);
            }
            return available;
        }

        synchronized void finish() {
            finished = true;
            notifyAll();
        }
    }

    private static String jsonString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static int boundedInt(long value) {
        return value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
    }

    private void auditSafely(String runId, String type, String payload) {
        try {
            audit.append(runId, type, payload);
        } catch (RuntimeException ignored) {
            // Scan persistence is authoritative; a secondary audit failure must not rewrite its outcome.
        }
    }
}
