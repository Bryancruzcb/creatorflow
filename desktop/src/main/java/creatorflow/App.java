package creatorflow;

import creatorflow.ui.AppView;
import creatorflow.ui.util.Screenshots;
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.stage.Stage;

public final class App extends Application {

    private AppContext context;

    @Override
    public void start(Stage stage) {
        context = AppContext.create();
        context.seedDemoIfRequested();

        AppView view = new AppView(context);
        Scene scene = new Scene(view.getRoot(), 1280, 800);
        scene.getStylesheets().add(getClass().getResource("/creatorflow/style.css").toExternalForm());

        stage.setTitle("CreatorFlow");
        stage.setScene(scene);
        stage.setMinWidth(1080);
        stage.setMinHeight(700);
        stage.show();

        boolean bridgeEnabled = Boolean.parseBoolean(
                System.getProperty("creatorflow.bridge.enabled", "true"));
        boolean screenshotMode = System.getProperty("creatorflow.screenshot.dir") != null;
        if (bridgeEnabled && !screenshotMode) {
            try {
                var bridge = context.startLocalBridge(() -> stage);
                if (Boolean.getBoolean("creatorflow.web.open")) {
                    getHostServices().showDocument(bridge.launchUri().toString());
                }
            } catch (RuntimeException error) {
                System.err.println("CreatorFlow local bridge could not start: " + error.getMessage());
            }
        }

        Screenshots.maybeRun(stage, view, context);
    }

    @Override
    public void stop() {
        if (context != null) {
            context.close();
        }
    }
}
