package creatorflow.bridge;

import java.nio.file.Path;
import java.util.Optional;

/** Desktop-owned capability for selecting a directory; browser input can never supply a path. */
@FunctionalInterface
public interface ProjectPicker {
    Optional<Path> chooseProject();
}
