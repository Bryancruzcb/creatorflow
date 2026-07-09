package creatorflow.ui.util;

import creatorflow.AppContext;
import creatorflow.model.Asset;
import creatorflow.model.VerificationStatus;
import creatorflow.ui.AppView;
import creatorflow.ui.dialogs.ReportDialog;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import javafx.animation.PauseTransition;
import javafx.application.Platform;
import javafx.embed.swing.SwingFXUtils;
import javafx.scene.Node;
import javafx.scene.Scene;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.StackPane;
import javafx.stage.Stage;
import javafx.util.Duration;
import javax.imageio.ImageIO;

/**
 * Headful screenshot mode for README images: run with
 * {@code -Dcreatorflow.screenshot.dir=docs/screenshots} (plus a throwaway
 * {@code -Dcreatorflow.data.dir}), and the app walks its pages, writes PNGs,
 * and exits.
 */
public final class Screenshots {

    public static final String DIR_PROPERTY = "creatorflow.screenshot.dir";

    private static final List<Map.Entry<AppView.Page, String>> PAGES = List.of(
            Map.entry(AppView.Page.DASHBOARD, "dashboard.png"),
            Map.entry(AppView.Page.PROJECTS, "projects.png"),
            Map.entry(AppView.Page.ASSETS, "assets.png"));

    private Screenshots() {
    }

    public static void maybeRun(Stage stage, AppView view, AppContext context) {
        String property = System.getProperty(DIR_PROPERTY);
        if (property == null) {
            return;
        }
        Path dir = Path.of(property);
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            fail(e);
            return;
        }
        capturePage(stage, view, context, dir, 0);
    }

    private static void capturePage(Stage stage, AppView view, AppContext context, Path dir, int index) {
        if (index >= PAGES.size()) {
            captureReport(stage, context, dir);
            return;
        }
        view.navigate(PAGES.get(index).getKey());
        PauseTransition settle = new PauseTransition(Duration.millis(500));
        settle.setOnFinished(e -> {
            try {
                save(stage.getScene().snapshot(null), dir.resolve(PAGES.get(index).getValue()));
                capturePage(stage, view, context, dir, index + 1);
            } catch (IOException ex) {
                fail(ex);
            }
        });
        settle.play();
    }

    /** Renders the report for a flagged asset offscreen, sized to its content. */
    private static void captureReport(Stage stage, AppContext context, Path dir) {
        try {
            Asset flagged = context.assets().findFlagged().stream()
                    .filter(a -> a.status() == VerificationStatus.SIMILAR)
                    .findFirst()
                    .orElseGet(() -> context.assets().findRecent(1).get(0));

            Node content = ReportDialog.buildContent(context, flagged);
            StackPane wrap = new StackPane(content);
            wrap.getStyleClass().add("report-shot");

            Scene scene = new Scene(wrap);
            scene.getStylesheets().addAll(stage.getScene().getStylesheets());
            save(scene.snapshot(null), dir.resolve("report.png"));
        } catch (Exception e) {
            fail(e);
            return;
        }
        Platform.exit();
    }

    private static void save(WritableImage image, Path file) throws IOException {
        ImageIO.write(SwingFXUtils.fromFXImage(image, null), "png", file.toFile());
        System.out.println("screenshot written: " + file);
    }

    private static void fail(Exception e) {
        e.printStackTrace();
        Platform.exit();
    }
}
