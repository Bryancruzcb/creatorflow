package creativeflow.component;

import javafx.scene.control.Label;
import javafx.scene.layout.VBox;

/** Reusable stat card for dashboard metrics. */
public class StatCard {

    private final VBox root;

    public StatCard(String number, String label) {
        root = new VBox(3);
        root.getStyleClass().add("stat-card");

        Label numberLabel = new Label(number);
        numberLabel.getStyleClass().add("stat-number");

        Label textLabel = new Label(label);
        textLabel.getStyleClass().add("stat-label");

        root.getChildren().addAll(numberLabel, textLabel);
    }

    public VBox getRoot() {
        return root;
    }
}
