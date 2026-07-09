package creatorflow.ui.dialogs;

import creatorflow.db.ProjectRepository;
import creatorflow.model.Project;
import java.util.Optional;
import javafx.event.ActionEvent;
import javafx.scene.control.Button;
import javafx.scene.control.ButtonType;
import javafx.scene.control.Dialog;
import javafx.scene.control.Label;
import javafx.scene.control.TextArea;
import javafx.scene.control.TextField;
import javafx.scene.layout.VBox;
import javafx.stage.Window;

public final class NewProjectDialog {

    private NewProjectDialog() {
    }

    public static Optional<Project> show(Window owner, ProjectRepository projects) {
        Dialog<Project> dialog = new Dialog<>();
        dialog.setTitle("New project");
        dialog.initOwner(owner);
        Dialogs.applyStyles(dialog, owner);

        TextField name = new TextField();
        name.setPromptText("e.g. Fantasy RPG");

        TextArea description = new TextArea();
        description.setPromptText("What is this project for? (optional)");
        description.setPrefRowCount(3);
        description.setWrapText(true);

        Label error = new Label();
        error.getStyleClass().add("field-error");
        error.setVisible(false);
        error.setManaged(false);

        VBox content = new VBox(10,
                Dialogs.fieldLabel("Name"), name,
                Dialogs.fieldLabel("Description"), description,
                error);
        content.getStyleClass().add("dialog-content");
        content.setPrefWidth(420);

        ButtonType createType = new ButtonType("Create project", ButtonType.OK.getButtonData());
        dialog.getDialogPane().setContent(content);
        dialog.getDialogPane().getButtonTypes().addAll(ButtonType.CANCEL, createType);

        Button createButton = (Button) dialog.getDialogPane().lookupButton(createType);
        createButton.getStyleClass().add("primary-button");
        createButton.disableProperty().bind(name.textProperty().map(t -> t == null || t.isBlank()));
        createButton.addEventFilter(ActionEvent.ACTION, event -> {
            if (projects.existsByName(name.getText().strip())) {
                error.setText("A project named “" + name.getText().strip() + "” already exists.");
                error.setVisible(true);
                error.setManaged(true);
                event.consume();
            }
        });

        dialog.setResultConverter(button -> button == createType
                ? projects.insert(name.getText().strip(), description.getText().strip())
                : null);

        return dialog.showAndWait();
    }
}
