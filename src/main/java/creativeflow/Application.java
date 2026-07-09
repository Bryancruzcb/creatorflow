package creativeflow;

import creativeflow.view.DashboardView;
import javafx.scene.Scene;
import javafx.stage.Stage;

/**
 * CreatorFlow JavaFX Application.
 * Responsible for creating the primary Stage and launching the app.
 */
public class Application extends javafx.application.Application {

    private static final int WINDOW_WIDTH = 960;
    private static final int WINDOW_HEIGHT = 620;
    private static final String WINDOW_TITLE = "CreatorFlow";

    @Override
    public void start(Stage stage) {
        DashboardView dashboard = new DashboardView();

        Scene scene = new Scene(dashboard.getRoot(), WINDOW_WIDTH, WINDOW_HEIGHT);

        String css = getClass().getResource("/creativeflow/style.css") != null
            ? getClass().getResource("/creativeflow/style.css").toExternalForm()
            : null;

        if (css != null) {
            scene.getStylesheets().add(css);
        }

        stage.setTitle(WINDOW_TITLE);
        stage.setScene(scene);
        stage.setMinWidth(800);
        stage.setMinHeight(520);
        stage.show();
    }

    public static void launch(String[] args) {
        javafx.application.Application.launch(Application.class, args);
    }
}
