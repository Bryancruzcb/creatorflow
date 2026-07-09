package creativeflow.view;

import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;

/** Builds the top bar for the dashboard. */
public class TopBarView {

    private final HBox root;

    public TopBarView() {
        root = buildTopBar();
    }

    public HBox getRoot() {
        return root;
    }

    private HBox buildTopBar() {
        HBox bar = new HBox();
        bar.getStyleClass().add("top-bar");
        bar.setAlignment(Pos.CENTER_LEFT);

        Label title = new Label("Dashboard");
        title.getStyleClass().add("page-title");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        Button newProjectButton = new Button("+ New Project");
        newProjectButton.getStyleClass().add("primary-button");
        newProjectButton.setOnAction(event -> System.out.println("TODO: open new project dialog"));

        bar.getChildren().addAll(title, spacer, newProjectButton);
        return bar;
    }
}
