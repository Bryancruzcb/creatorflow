package creativeflow.view;

import javafx.scene.control.Label;
import javafx.scene.layout.VBox;

final class SectionLabel {
    private SectionLabel() {
    }

    static VBox create(String text) {
        Label label = new Label(text.toUpperCase());
        label.getStyleClass().add("section-label");
        return new VBox(label);
    }
}
