package creativeflow.view;

import creativeflow.component.NavButton;
import javafx.scene.control.Label;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;

/** Builds the left navigation sidebar. */
public class SidebarView {

    private final VBox root;

    public SidebarView() {
        root = buildSidebar();
    }

    public VBox getRoot() {
        return root;
    }

    private VBox buildSidebar() {
        VBox sidebar = new VBox();
        sidebar.getStyleClass().add("sidebar");
        sidebar.setPrefWidth(200);

        Region spacer = new Region();
        VBox.setVgrow(spacer, Priority.ALWAYS);

        sidebar.getChildren().addAll(
            buildLogoArea(),
            buildNavItems(),
            spacer,
            new NavButton("Settings", false).getRoot()
        );

        return sidebar;
    }

    private VBox buildLogoArea() {
        VBox logo = new VBox(2);
        logo.getStyleClass().add("logo-area");

        Label title = new Label("CreatorFlow");
        title.getStyleClass().add("logo-title");

        Label subtitle = new Label("Asset Manager");
        subtitle.getStyleClass().add("logo-subtitle");

        logo.getChildren().addAll(title, subtitle);
        return logo;
    }

    private VBox buildNavItems() {
        VBox nav = new VBox(2);
        nav.getStyleClass().add("nav-list");
        nav.getChildren().addAll(
            new NavButton("Dashboard", true).getRoot(),
            new NavButton("Projects", false).getRoot(),
            new NavButton("Assets", false).getRoot(),
            new NavButton("Export", false).getRoot()
        );
        return nav;
    }
}
