package creatorflow.ui.components;

import creatorflow.model.VerificationStatus;
import java.util.Locale;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.shape.Circle;

/** Status is always shown as dot + word, never color alone. */
public final class StatusBadge {

    private StatusBadge() {
    }

    public static HBox of(VerificationStatus status) {
        Circle dot = new Circle(3.5);
        dot.getStyleClass().add("status-dot");

        Label label = new Label(status.label());
        label.getStyleClass().add("status-text");

        HBox badge = new HBox(6, dot, label);
        badge.setAlignment(Pos.CENTER_LEFT);
        badge.getStyleClass().addAll("status-badge",
                "status-" + status.name().toLowerCase(Locale.ROOT));
        badge.setMaxWidth(HBox.USE_PREF_SIZE);
        return badge;
    }
}
