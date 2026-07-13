package creatorflow.workflow;

import java.util.List;

/** Path-level difference from the previous persisted project release plus current workflow counts. */
public record ReleaseComparison(
        String previousReleaseId,
        int added,
        int changed,
        int removed,
        List<String> addedPaths,
        List<String> changedPaths,
        List<String> removedPaths,
        int unresolved,
        int approved,
        int blocked,
        int excluded) {

    public ReleaseComparison {
        addedPaths = List.copyOf(addedPaths);
        changedPaths = List.copyOf(changedPaths);
        removedPaths = List.copyOf(removedPaths);
        if (added != addedPaths.size() || changed != changedPaths.size() || removed != removedPaths.size()) {
            throw new IllegalArgumentException("Release comparison counts must match path lists");
        }
    }
}
