package creatorflow.workflow;

import creatorflow.manifest.CreativeManifest;
import creatorflow.manifest.ReleaseGate;

/** In-memory view of the same immutable artifacts persisted for a release. */
public record ReleaseBundle(ReleaseRecord release, CreativeManifest manifest,
                            ReleaseGate.Report report, ReleaseComparison comparison) {
}
