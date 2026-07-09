package creatorflow.ui.pages;

import creatorflow.AppContext;
import creatorflow.model.Asset;
import creatorflow.model.VerificationStatus;
import creatorflow.ui.AppView;
import creatorflow.ui.PageHeader;
import creatorflow.ui.components.EmptyState;
import creatorflow.ui.components.StatusBadge;
import creatorflow.ui.components.TypeChip;
import creatorflow.ui.dialogs.ImportFlow;
import creatorflow.ui.dialogs.ReportDialog;
import creatorflow.ui.util.Formats;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javafx.beans.property.ReadOnlyObjectWrapper;
import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.collections.transformation.FilteredList;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.Label;
import javafx.scene.control.TableCell;
import javafx.scene.control.TableColumn;
import javafx.scene.control.TableView;
import javafx.scene.control.TextField;
import javafx.scene.input.TransferMode;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;

public final class AssetsPage {

    /** One table row: the asset plus its denormalized project name. */
    public record Row(Asset asset, String projectName) {
    }

    private record ProjectFilter(Long id, String label) {
        @Override
        public String toString() {
            return label;
        }
    }

    private final AppContext context;
    private final AppView appView;
    private final VBox root;

    private final TextField search = new TextField();
    private final ComboBox<ProjectFilter> projectFilter = new ComboBox<>();
    private final ComboBox<String> statusFilter = new ComboBox<>();
    private FilteredList<Row> filtered;

    public AssetsPage(AppContext context, AppView appView, Long presetProjectId) {
        this.context = context;
        this.appView = appView;

        root = new VBox(16);
        root.getStyleClass().add("page");

        Button importButton = new Button("Import assets");
        importButton.getStyleClass().add("primary-button");
        importButton.setOnAction(e -> ImportFlow.start(window(), context,
                selectedProjectId(), appView::refresh));

        int total = context.assets().count();
        root.getChildren().add(PageHeader.build("Assets",
                total == 1 ? "1 file, verified on import" : total + " files, verified on import",
                importButton));

        Map<Long, String> projectNames = context.projects().namesById();
        ObservableList<Row> rows = FXCollections.observableArrayList(
                context.assets().findAll().stream()
                        .map(a -> new Row(a, projectNames.getOrDefault(a.projectId(), "—")))
                        .toList());
        filtered = new FilteredList<>(rows);

        root.getChildren().add(buildToolbar(presetProjectId));

        TableView<Row> table = buildTable();
        VBox.setVgrow(table, Priority.ALWAYS);
        root.getChildren().add(table);

        installDragAndDrop();
        updatePredicate();
    }

    public VBox getRoot() {
        return root;
    }

    private HBox buildToolbar(Long presetProjectId) {
        search.setPromptText("Search name, type or license");
        search.getStyleClass().add("search-field");
        HBox.setHgrow(search, Priority.ALWAYS);
        search.textProperty().addListener((obs, old, val) -> updatePredicate());

        projectFilter.getItems().add(new ProjectFilter(null, "All projects"));
        context.projects().findAll().forEach(p ->
                projectFilter.getItems().add(new ProjectFilter(p.id(), p.name())));
        projectFilter.getSelectionModel().select(
                projectFilter.getItems().stream()
                        .filter(f -> f.id() != null && f.id().equals(presetProjectId))
                        .findFirst()
                        .orElse(projectFilter.getItems().get(0)));
        projectFilter.valueProperty().addListener((obs, old, val) -> updatePredicate());

        statusFilter.getItems().add("All statuses");
        for (VerificationStatus status : VerificationStatus.values()) {
            statusFilter.getItems().add(status.label());
        }
        statusFilter.getSelectionModel().select(0);
        statusFilter.valueProperty().addListener((obs, old, val) -> updatePredicate());

        return new HBox(8, search, projectFilter, statusFilter);
    }

    private TableView<Row> buildTable() {
        TableView<Row> table = new TableView<>(filtered);
        table.setColumnResizePolicy(TableView.CONSTRAINED_RESIZE_POLICY_FLEX_LAST_COLUMN);
        table.setPlaceholder(EmptyState.of("No assets match",
                "Import files or loosen the filters above.", null, null));

        TableColumn<Row, Row> file = new TableColumn<>("File");
        file.setCellValueFactory(c -> new ReadOnlyObjectWrapper<>(c.getValue()));
        file.setCellFactory(col -> new TableCell<>() {
            @Override
            protected void updateItem(Row row, boolean empty) {
                super.updateItem(row, empty);
                if (empty || row == null) {
                    setGraphic(null);
                    return;
                }
                Label name = new Label(row.asset().fileName());
                name.getStyleClass().add("row-title");
                HBox box = new HBox(8, TypeChip.of(row.asset().fileType()), name);
                box.setAlignment(Pos.CENTER_LEFT);
                setGraphic(box);
            }
        });
        file.setPrefWidth(280);

        TableColumn<Row, String> project = column("Project", 140,
                r -> r.projectName());
        TableColumn<Row, String> size = column("Size", 90,
                r -> Formats.bytes(r.asset().sizeBytes()));
        TableColumn<Row, String> license = column("License", 150,
                r -> r.asset().license());

        TableColumn<Row, Row> status = new TableColumn<>("Status");
        status.setCellValueFactory(c -> new ReadOnlyObjectWrapper<>(c.getValue()));
        status.setCellFactory(col -> new TableCell<>() {
            @Override
            protected void updateItem(Row row, boolean empty) {
                super.updateItem(row, empty);
                setGraphic(empty || row == null ? null : StatusBadge.of(row.asset().status()));
            }
        });
        status.setPrefWidth(110);

        TableColumn<Row, String> added = column("Added", 100,
                r -> Formats.relative(r.asset().addedAt()));

        table.getColumns().setAll(List.of(file, project, size, license, status, added));

        table.setRowFactory(tv -> {
            javafx.scene.control.TableRow<Row> row = new javafx.scene.control.TableRow<>();
            row.setOnMouseClicked(e -> {
                if (e.getClickCount() == 2 && !row.isEmpty()) {
                    ReportDialog.show(window(), context, row.getItem().asset());
                }
            });
            return row;
        });
        return table;
    }

    private TableColumn<Row, String> column(String title, double width,
                                            java.util.function.Function<Row, String> value) {
        TableColumn<Row, String> column = new TableColumn<>(title);
        column.setCellValueFactory(c -> new ReadOnlyObjectWrapper<>(value.apply(c.getValue())));
        column.setPrefWidth(width);
        return column;
    }

    private void installDragAndDrop() {
        root.setOnDragOver(event -> {
            if (event.getDragboard().hasFiles()) {
                event.acceptTransferModes(TransferMode.COPY);
            }
            event.consume();
        });
        root.setOnDragDropped(event -> {
            if (event.getDragboard().hasFiles()) {
                ImportFlow.withFiles(window(), context, selectedProjectId(),
                        event.getDragboard().getFiles(), appView::refresh);
                event.setDropCompleted(true);
            }
            event.consume();
        });
    }

    private void updatePredicate() {
        String query = search.getText() == null ? "" : search.getText().toLowerCase(Locale.ROOT).strip();
        ProjectFilter pf = projectFilter.getValue();
        String statusLabel = statusFilter.getValue();

        filtered.setPredicate(row -> {
            if (pf != null && pf.id() != null && row.asset().projectId() != pf.id()) {
                return false;
            }
            if (statusLabel != null && !"All statuses".equals(statusLabel)
                    && !row.asset().status().label().equals(statusLabel)) {
                return false;
            }
            if (query.isEmpty()) {
                return true;
            }
            return (row.asset().fileName() + " " + row.asset().fileType() + " "
                    + row.asset().license() + " " + row.projectName())
                    .toLowerCase(Locale.ROOT).contains(query);
        });
    }

    private Long selectedProjectId() {
        ProjectFilter pf = projectFilter.getValue();
        return pf == null ? null : pf.id();
    }

    private javafx.stage.Window window() {
        return root.getScene() == null ? null : root.getScene().getWindow();
    }
}
