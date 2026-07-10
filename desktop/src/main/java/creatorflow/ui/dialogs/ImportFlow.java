package creatorflow.ui.dialogs;

import creatorflow.AppContext;
import creatorflow.model.Project;
import creatorflow.service.AssetImporter.ImportRequest;
import creatorflow.service.AssetImporter.ImportResult;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.ButtonType;
import javafx.scene.control.CheckBox;
import javafx.scene.control.ComboBox;
import javafx.scene.control.Dialog;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.stage.FileChooser;
import javafx.stage.Window;
import javafx.util.StringConverter;

/**
 * The import pipeline's front door: pick files, declare ownership and license,
 * run verification, then show what the engine found.
 */
public final class ImportFlow {

    public static final List<String> LICENSES = List.of(
            "All rights reserved",
            "CC0 (public domain)",
            "CC-BY 4.0",
            "CC-BY-SA 4.0",
            "Licensed (commercial)",
            "Unknown");

    private ImportFlow() {
    }

    /** Entry point via the file chooser. */
    public static void start(Window owner, AppContext context, Long presetProjectId, Runnable onDone) {
        FileChooser chooser = new FileChooser();
        chooser.setTitle("Import assets");
        chooser.getExtensionFilters().addAll(
                new FileChooser.ExtensionFilter("All files", "*.*"),
                new FileChooser.ExtensionFilter("Images", "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp"),
                new FileChooser.ExtensionFilter("Audio", "*.wav", "*.aif", "*.aiff", "*.au"));
        List<File> files = chooser.showOpenMultipleDialog(owner);
        if (files != null && !files.isEmpty()) {
            withFiles(owner, context, presetProjectId, files, onDone);
        }
    }

    /** Entry point via drag-and-drop. */
    public static void withFiles(Window owner, AppContext context, Long presetProjectId,
                                 List<File> files, Runnable onDone) {
        List<Project> projects = context.projects().findAll();
        if (projects.isEmpty()) {
            Optional<Project> created = NewProjectDialog.show(owner, context.projects());
            if (created.isEmpty()) {
                return;
            }
            projects = context.projects().findAll();
        }

        Dialog<ButtonType> dialog = new Dialog<>();
        dialog.setTitle("Import assets");
        dialog.initOwner(owner);
        Dialogs.applyStyles(dialog, owner);

        Label fileSummary = new Label(files.size() == 1
                ? files.get(0).getName()
                : files.size() + " files, e.g. " + files.get(0).getName());
        fileSummary.getStyleClass().add("dialog-lede");

        ComboBox<Project> projectBox = new ComboBox<>();
        projectBox.getItems().addAll(projects);
        projectBox.setMaxWidth(Double.MAX_VALUE);
        projectBox.setConverter(new StringConverter<>() {
            @Override
            public String toString(Project project) {
                return project == null ? "" : project.name();
            }

            @Override
            public Project fromString(String s) {
                return null;
            }
        });
        projectBox.getSelectionModel().select(projects.stream()
                .filter(p -> presetProjectId != null && p.id() == presetProjectId)
                .findFirst()
                .orElse(projects.get(0)));

        ComboBox<String> licenseBox = new ComboBox<>();
        licenseBox.getItems().addAll(LICENSES);
        licenseBox.getSelectionModel().select(0);
        licenseBox.setMaxWidth(Double.MAX_VALUE);

        CheckBox declaration = new CheckBox("I created this work or hold the rights to it");
        Label declarationNote = new Label("Your answer is recorded with the asset. "
                + "Every import is also checked against the library's fingerprint index.");
        declarationNote.getStyleClass().add("field-note");
        declarationNote.setWrapText(true);

        VBox content = new VBox(10,
                fileSummary,
                Dialogs.fieldLabel("Project"), projectBox,
                Dialogs.fieldLabel("License"), licenseBox,
                Dialogs.fieldLabel("Ownership"), declaration, declarationNote);
        content.getStyleClass().add("dialog-content");
        content.setPrefWidth(440);

        ButtonType importType = new ButtonType(
                files.size() == 1 ? "Verify & import" : "Verify & import " + files.size() + " files",
                ButtonType.OK.getButtonData());
        dialog.getDialogPane().setContent(content);
        dialog.getDialogPane().getButtonTypes().addAll(ButtonType.CANCEL, importType);
        ((Button) dialog.getDialogPane().lookupButton(importType)).getStyleClass().add("primary-button");

        if (dialog.showAndWait().filter(importType::equals).isEmpty()) {
            return;
        }

        Project target = projectBox.getValue();
        List<ImportResult> results = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        for (File file : files) {
            try {
                results.add(context.importer().importFile(new ImportRequest(
                        file.toPath(), target.id(), licenseBox.getValue(), declaration.isSelected())));
            } catch (Exception e) {
                failures.add(file.getName() + " — " + e.getMessage());
            }
        }
        onDone.run();

        if (results.size() == 1 && failures.isEmpty()) {
            ReportDialog.show(owner, context, results.get(0).asset());
        } else {
            showSummary(owner, context, results, failures);
        }
    }

    private static void showSummary(Window owner, AppContext context,
                                    List<ImportResult> results, List<String> failures) {
        Dialog<ButtonType> dialog = new Dialog<>();
        dialog.setTitle("Import results");
        dialog.initOwner(owner);
        Dialogs.applyStyles(dialog, owner);

        VBox rows = new VBox(6);
        for (ImportResult result : results) {
            Label name = new Label(result.asset().fileName());
            name.getStyleClass().add("row-title");

            Region spacer = new Region();
            HBox.setHgrow(spacer, Priority.ALWAYS);

            Button view = new Button("View report");
            view.getStyleClass().add("ghost-button");
            view.setOnAction(e -> ReportDialog.show(owner, context, result.asset()));

            HBox row = new HBox(10,
                    creatorflow.ui.components.TypeChip.of(result.asset().fileType()),
                    name, spacer,
                    creatorflow.ui.components.StatusBadge.of(result.asset().status()),
                    view);
            row.setAlignment(Pos.CENTER_LEFT);
            row.getStyleClass().add("list-row");
            rows.getChildren().add(row);
        }
        for (String failure : failures) {
            Label label = new Label("Could not import " + failure);
            label.getStyleClass().add("field-error");
            label.setWrapText(true);
            rows.getChildren().add(label);
        }

        VBox content = new VBox(10, new Label(results.size() + " imported, "
                + failures.size() + " failed"), rows);
        content.getStyleClass().add("dialog-content");
        content.setPrefWidth(520);

        dialog.getDialogPane().setContent(content);
        dialog.getDialogPane().getButtonTypes().add(ButtonType.CLOSE);
        dialog.showAndWait();
    }
}
