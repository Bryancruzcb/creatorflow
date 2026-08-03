package creatorflow.workflow;

import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.ReleaseGate;

/**
 * The same artifacts a release would carry, evaluated without persisting any of them.
 *
 * <p>Sibling of {@link ReleaseBundle}, minus the two fields that only exist because something was
 * written: there is no {@link ReleaseRecord} and no {@link ReleaseComparison}. That is the whole
 * distinction — a preview is a read, so it has no row and no diff against a previous release.
 *
 * <p>The {@code manifest} and {@code report} here are produced by the identical code path
 * {@link ReleaseExportService#create} runs ({@code evaluateInTransaction}), so a preview is not a
 * lookalike evaluation: it is the same {@link ReleaseGate#evaluate} call on the same asset entries
 * the persisted release would have built.
 */
public record GatePreview(String scanRunId, String releaseName, CreativeManifest manifest,
                          ReleaseGate.Report report) {
}
