package creatorflow.manifest;

import java.io.IOException;
import java.nio.file.Path;

/** Supplies source/license evidence for a project-relative asset path. */
@FunctionalInterface
public interface SourceEvidenceResolver {
    CreativeManifest.SourceEvidence resolve(Path relativePath) throws IOException;

    static SourceEvidenceResolver unresolved() {
        return ignored -> CreativeManifest.SourceEvidence.unresolved();
    }
}
