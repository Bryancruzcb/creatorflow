package creatorflow.ui;

import creatorflow.ui.AppView.Page;
import java.util.EnumMap;
import java.util.Map;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;

/** Left navigation rail with live project/asset counts. */
public final class Sidebar {

    private final VBox root;
    private final Map<Page, HBox> items = new EnumMap<>(Page.class);
    private final Label projectCount = countChip();
    private final Label assetCount = countChip();

    public Sidebar(AppView appView) {
        root = new VBox();
        root.getStyleClass().add("sidebar");
        root.setPrefWidth(224);
        root.setMinWidth(224);

        VBox logo = new VBox(2);
        logo.getStyleClass().add("logo-area");
        Label title = new Label("CreatorFlow");
        title.getStyleClass().add("logo-title");
        Label subtitle = new Label("Asset manager");
        subtitle.getStyleClass().add("logo-subtitle");
        logo.getChildren().addAll(title, subtitle);

        Label section = new Label("WORKSPACE");
        section.getStyleClass().add("nav-section");

        VBox nav = new VBox(2);
        nav.getChildren().addAll(
                item(appView, Page.DASHBOARD, null),
                item(appView, Page.PROJECTS, projectCount),
                item(appView, Page.ASSETS, assetCount));

        Region spacer = new Region();
        VBox.setVgrow(spacer, Priority.ALWAYS);

        root.getChildren().addAll(logo, section, nav, spacer, item(appView, Page.SETTINGS, null));
    }

    public VBox getRoot() {
        return root;
    }

    public void update(Page active, int projects, int assets) {
        items.forEach((page, node) -> {
            node.getStyleClass().remove("nav-item-active");
            if (page == active) {
                node.getStyleClass().add("nav-item-active");
            }
        });
        projectCount.setText(String.valueOf(projects));
        assetCount.setText(String.valueOf(assets));
    }

    private HBox item(AppView appView, Page page, Label chip) {
        Label label = new Label(page.label());
        label.getStyleClass().add("nav-label");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        HBox item = new HBox(8, label, spacer);
        if (chip != null) {
            item.getChildren().add(chip);
        }
        item.getStyleClass().add("nav-item");
        item.setAlignment(Pos.CENTER_LEFT);
        item.setOnMouseClicked(e -> appView.navigate(page));
        items.put(page, item);
        return item;
    }

    private static Label countChip() {
        Label chip = new Label("0");
        chip.getStyleClass().add("nav-count");
        return chip;
    }
}
