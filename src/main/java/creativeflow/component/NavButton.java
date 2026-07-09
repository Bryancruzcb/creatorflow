package creativeflow.component;

import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;

/** Reusable sidebar navigation button. */
public class NavButton {

    private final Button root;

    public NavButton(String text, boolean active) {
        root = new Button(text);
        root.getStyleClass().add("nav-button");
        root.setMaxWidth(Double.MAX_VALUE);
        root.setAlignment(Pos.CENTER_LEFT);
        root.setPadding(new Insets(9, 16, 9, active ? 14 : 16));

        if (active) {
            root.getStyleClass().add("nav-button-active");
        }
    }

    public Button getRoot() {
        return root;
    }
}
