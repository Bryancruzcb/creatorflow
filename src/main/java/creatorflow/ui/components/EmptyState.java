package creatorflow.ui.components;

import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.VBox;

/** Friendly placeholder for pages and panels with nothing to show yet. */
public final class EmptyState {

    private EmptyState() {
    }

    public static VBox of(String title, String message, String actionLabel, Runnable action) {
        Label titleLabel = new Label(title);
        titleLabel.getStyleClass().add("empty-title");

        Label messageLabel = new Label(message);
        messageLabel.getStyleClass().add("empty-message");
        messageLabel.setWrapText(true);

        VBox box = new VBox(6, titleLabel, messageLabel);
        box.getStyleClass().add("empty-state");
        box.setAlignment(Pos.CENTER);

        if (actionLabel != null) {
            Button button = new Button(actionLabel);
            button.getStyleClass().add("primary-button");
            button.setOnAction(e -> action.run());
            VBox.setMargin(button, new javafx.geometry.Insets(8, 0, 0, 0));
            box.getChildren().add(button);
        }
        return box;
    }
}
