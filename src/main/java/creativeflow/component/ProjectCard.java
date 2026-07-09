package creativeflow.component;

import javafx.geometry.Insets;
import javafx.scene.control.Label;
import javafx.scene.layout.*;
import javafx.scene.paint.Color;
import javafx.scene.shape.Rectangle;

/**
 * A reusable UI component representing a single project card.
 *
 * Encapsulates all layout and styling for one project entry.
 * Consumers call getRoot() to retrieve the node for insertion into a layout.
 */
public class ProjectCard {

    private final String name;
    private final String thumbColor;
    private final String meta;
    private final String[] tags;

    private final VBox root;

    private static final String BG_CARD   = "#FFFFFF";
    private static final String BG_STAT   = "#F7F6F2";
    private static final String TEXT_PRI  = "#2C2C2A";
    private static final String TEXT_SEC  = "#888780";
    private static final String BORDER    = "#E0DED7";
    private static final String BORDER_HOVER = "#AAAAAA";

    private static final String STYLE_NORMAL =
        "-fx-background-color: " + BG_CARD + ";" +
        "-fx-border-color: " + BORDER + ";" +
        "-fx-border-radius: 10;" +
        "-fx-background-radius: 10;" +
        "-fx-cursor: hand;";

    private static final String STYLE_HOVER =
        "-fx-background-color: " + BG_CARD + ";" +
        "-fx-border-color: " + BORDER_HOVER + ";" +
        "-fx-border-radius: 10;" +
        "-fx-background-radius: 10;" +
        "-fx-cursor: hand;";

    public ProjectCard(String name, String thumbColor, String meta, String tagsCsv) {
        this.name = name;
        this.thumbColor = thumbColor;
        this.meta = meta;
        this.tags = tagsCsv.split(",\\s*");
        this.root = buildCard();
    }

    public VBox getRoot() {
        return root;
    }

    private VBox buildCard() {
        VBox card = new VBox(8);
        card.setPadding(new Insets(14));
        card.setStyle(STYLE_NORMAL);

        card.getChildren().addAll(
            buildThumbnail(),
            buildNameLabel(),
            buildMetaLabel(),
            buildTagRow()
        );

        attachHoverEffect(card);
        return card;
    }

    private StackPane buildThumbnail() {
        Rectangle rect = new Rectangle(200, 64);
        rect.setFill(Color.web(thumbColor));
        rect.setArcWidth(8);
        rect.setArcHeight(8);

        StackPane pane = new StackPane(rect);
        rect.widthProperty().bind(pane.widthProperty());

        return pane;
    }

    private Label buildNameLabel() {
        Label lbl = new Label(name);
        lbl.setStyle(
            "-fx-font-size: 13px;" +
            "-fx-font-weight: bold;" +
            "-fx-text-fill: " + TEXT_PRI + ";"
        );

        return lbl;
    }

    private Label buildMetaLabel() {
        Label lbl = new Label(meta);
        lbl.setStyle(
            "-fx-font-size: 11px;" +
            "-fx-text-fill: " + TEXT_SEC + ";"
        );

        return lbl;
    }

    private HBox buildTagRow() {
        HBox row = new HBox(4);

        for (String tag : tags) {
            Label tagLabel = new Label(tag.trim());
            tagLabel.setStyle(
                "-fx-font-size: 10px;" +
                "-fx-text-fill: " + TEXT_SEC + ";" +
                "-fx-background-color: " + BG_STAT + ";" +
                "-fx-background-radius: 99;" +
                "-fx-border-color: " + BORDER + ";" +
                "-fx-border-radius: 99;" +
                "-fx-padding: 2 8 2 8;"
            );

            row.getChildren().add(tagLabel);
        }

        return row;
    }

    private void attachHoverEffect(VBox card) {
        card.setOnMouseEntered(e -> card.setStyle(STYLE_HOVER));
        card.setOnMouseExited(e -> card.setStyle(STYLE_NORMAL));
    }
}