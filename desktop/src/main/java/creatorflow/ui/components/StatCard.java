package creatorflow.ui.components;

import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;

/** Dashboard stat tile: big number, small uppercase label, muted context line. */
public final class StatCard {

    private StatCard() {
    }

    public static VBox of(String value, String name, String detail) {
        return of(value, name, detail, null);
    }

    public static VBox of(String value, String name, String detail, String extraStyleClass) {
        Label valueLabel = new Label(value);
        valueLabel.getStyleClass().add("stat-value");

        Label nameLabel = new Label(name.toUpperCase(java.util.Locale.ROOT));
        nameLabel.getStyleClass().add("stat-name");

        Label detailLabel = new Label(detail);
        detailLabel.getStyleClass().add("stat-detail");

        VBox card = new VBox(2, nameLabel, valueLabel, detailLabel);
        card.getStyleClass().add("stat-card");
        if (extraStyleClass != null) {
            card.getStyleClass().add(extraStyleClass);
        }
        HBox.setHgrow(card, Priority.ALWAYS);
        return card;
    }
}
