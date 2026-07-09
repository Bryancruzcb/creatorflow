package creativeflow.view;

import javafx.scene.layout.BorderPane;

/**
 * Main dashboard screen.
 * This class only assembles the larger screen pieces.
 */
public class DashboardView {

    private final BorderPane root;

    public DashboardView() {
        root = new BorderPane();
        root.getStyleClass().add("app-root");
        root.setLeft(new SidebarView().getRoot());
        root.setCenter(buildMainPanel());
    }

    public BorderPane getRoot() {
        return root;
    }

    private javafx.scene.layout.VBox buildMainPanel() {
        javafx.scene.layout.VBox mainPanel = new javafx.scene.layout.VBox();
        mainPanel.getStyleClass().add("main-panel");

        javafx.scene.layout.VBox content = new javafx.scene.layout.VBox(20);
        content.getStyleClass().add("content-area");
        content.getChildren().addAll(
            new StatsRowView().getRoot(),
            SectionLabel.create("Recent projects"),
            new ProjectGridView().getRoot(),
            SectionLabel.create("Recently added files"),
            new RecentFilesView().getRoot()
        );

        mainPanel.getChildren().addAll(new TopBarView().getRoot(), content);
        javafx.scene.layout.VBox.setVgrow(content, javafx.scene.layout.Priority.ALWAYS);

        return mainPanel;
    }
}
