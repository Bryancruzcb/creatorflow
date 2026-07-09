package creatorflow.ui.dialogs;

import javafx.scene.control.Dialog;
import javafx.scene.control.Label;
import javafx.stage.Window;

/** Shared dialog plumbing: JavaFX dialogs do not inherit the scene's stylesheets. */
final class Dialogs {

    private Dialogs() {
    }

    static void applyStyles(Dialog<?> dialog, Window owner) {
        if (owner != null && owner.getScene() != null) {
            dialog.getDialogPane().getStylesheets().addAll(owner.getScene().getStylesheets());
        }
        dialog.getDialogPane().getStyleClass().add("cf-dialog");
    }

    static Label fieldLabel(String text) {
        Label label = new Label(text.toUpperCase(java.util.Locale.ROOT));
        label.getStyleClass().add("field-label");
        return label;
    }
}
