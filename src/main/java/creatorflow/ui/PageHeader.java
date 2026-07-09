package creatorflow.ui;

import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;

/** Page title, one-line context, and the page's actions on the right. */
public final class PageHeader {

    private PageHeader() {
    }

    public static HBox build(String title, String subtitle, Node... actions) {
        Label titleLabel = new Label(title);
        titleLabel.getStyleClass().add("page-title");

        Label subtitleLabel = new Label(subtitle);
        subtitleLabel.getStyleClass().add("page-subtitle");

        VBox text = new VBox(2, titleLabel, subtitleLabel);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);

        HBox header = new HBox(12, text, spacer);
        header.setAlignment(Pos.CENTER_LEFT);
        header.getStyleClass().add("page-header");
        header.getChildren().addAll(actions);
        return header;
    }
}
