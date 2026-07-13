package creatorflow.bridge;

import java.io.File;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.function.Supplier;
import javafx.application.Platform;
import javafx.stage.DirectoryChooser;
import javafx.stage.Window;

/** Marshals the native directory chooser onto the JavaFX application thread. */
public final class JavaFxProjectPicker implements ProjectPicker {

    private final Supplier<Window> owner;

    public JavaFxProjectPicker(Supplier<Window> owner) {
        this.owner = owner;
    }

    @Override
    public Optional<Path> chooseProject() {
        if (Platform.isFxApplicationThread()) return show();
        CompletableFuture<Optional<Path>> result = new CompletableFuture<>();
        Platform.runLater(() -> {
            try {
                result.complete(show());
            } catch (RuntimeException error) {
                result.completeExceptionally(error);
            }
        });
        try {
            return result.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (ExecutionException e) {
            throw new IllegalStateException("Native project picker failed", e.getCause());
        }
    }

    private Optional<Path> show() {
        DirectoryChooser chooser = new DirectoryChooser();
        chooser.setTitle("Choose a CreatorFlow project folder");
        File selected = chooser.showDialog(owner.get());
        return selected == null ? Optional.empty() : Optional.of(selected.toPath());
    }
}
