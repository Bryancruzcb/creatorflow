package creatorflow.ui.pages;

import creatorflow.AppContext;
import creatorflow.model.Asset;
import creatorflow.model.AssetMatch;
import creatorflow.model.Project;
import creatorflow.model.VerificationStatus;
import creatorflow.ui.AppView;
import creatorflow.ui.PageHeader;
import creatorflow.ui.components.EmptyState;
import creatorflow.ui.components.ProjectCard;
import creatorflow.ui.components.StatCard;
import creatorflow.ui.components.StatusBadge;
import creatorflow.ui.components.TypeChip;
import creatorflow.ui.dialogs.ImportFlow;
import creatorflow.ui.dialogs.NewProjectDialog;
import creatorflow.ui.dialogs.ReportDialog;
import creatorflow.ui.util.Formats;
import java.util.List;
import java.util.Map;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ScrollPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;

public final class DashboardPage {

    private final AppContext context;
    private final AppView appView;
    private final ScrollPane root;

    public DashboardPage(AppContext context, AppView appView) {
        this.context = context;
        this.appView = appView;

        VBox content = new VBox(20);
        content.getStyleClass().add("page");

        Button newProject = new Button("New project");
        newProject.getStyleClass().add("ghost-button");
        newProject.setOnAction(e -> NewProjectDialog.show(window(), context.projects())
                .ifPresent(p -> appView.refresh()));

        Button importAssets = new Button("Import assets");
        importAssets.getStyleClass().add("primary-button");
        importAssets.setOnAction(e -> ImportFlow.start(window(), context, null, appView::refresh));

        content.getChildren().add(PageHeader.build("Dashboard",
                "Your library at a glance.", newProject, importAssets));

        if (context.projects().count() == 0 && context.assets().count() == 0) {
            content.getChildren().add(EmptyState.of(
                    "Start your library",
                    "Create a project, then import sprites, audio or models. Every file is "
                            + "fingerprinted and checked for originality on the way in.",
                    "Import your first assets",
                    () -> ImportFlow.start(window(), context, null, appView::refresh)));
        } else {
            content.getChildren().add(statsRow());
            addNeedsReview(content);
            addRecentProjects(content);
            addRecentFiles(content);
        }

        root = new ScrollPane(content);
        root.setFitToWidth(true);
        root.getStyleClass().add("page-scroll");
    }

    public ScrollPane getRoot() {
        return root;
    }

    private HBox statsRow() {
        Map<VerificationStatus, Integer> byStatus = context.assets().countByStatus();
        int flagged = byStatus.get(VerificationStatus.SIMILAR) + byStatus.get(VerificationStatus.DUPLICATE);

        HBox row = new HBox(12,
                StatCard.of(String.valueOf(context.projects().count()), "Projects", "in this workspace"),
                StatCard.of(String.valueOf(context.assets().count()), "Assets",
                        byStatus.get(VerificationStatus.CLEAR) + " verified clear"),
                StatCard.of(String.valueOf(flagged), "Flagged",
                        flagged == 0 ? "nothing needs review" : "similar or duplicate",
                        flagged > 0 ? "stat-card-flagged" : null),
                StatCard.of(Formats.bytes(context.assets().totalSizeBytes()), "Library size",
                        "managed in " + context.paths().libraryDir().getFileName()));
        return row;
    }

    private void addNeedsReview(VBox content) {
        List<Asset> flagged = context.assets().findFlagged();
        if (flagged.isEmpty()) {
            return;
        }
        content.getChildren().add(sectionLabel("Needs review"));

        VBox list = new VBox();
        list.getStyleClass().add("panel");
        for (Asset asset : flagged.subList(0, Math.min(5, flagged.size()))) {
            Label name = new Label(asset.fileName());
            name.getStyleClass().add("row-title");

            List<AssetMatch> matches = context.assets().matchesFor(asset.id());
            Label note = new Label(matches.isEmpty() ? asset.status().summary() : matches.get(0).note());
            note.getStyleClass().add("row-note");

            Region spacer = new Region();
            HBox.setHgrow(spacer, Priority.ALWAYS);

            Button view = new Button("View report");
            view.getStyleClass().add("ghost-button");
            view.setOnAction(e -> ReportDialog.show(window(), context, asset));

            HBox row = new HBox(12, StatusBadge.of(asset.status()), name, note, spacer, view);
            row.setAlignment(Pos.CENTER_LEFT);
            row.getStyleClass().add("list-row");
            list.getChildren().add(row);
        }
        content.getChildren().add(list);
    }

    private void addRecentProjects(VBox content) {
        List<Project> projects = context.projects().findAll();
        if (projects.isEmpty()) {
            return;
        }
        content.getChildren().add(sectionLabel("Recent projects"));

        HBox grid = new HBox(12);
        for (Project project : projects.subList(0, Math.min(3, projects.size()))) {
            Asset cover = context.assets().findByProject(project.id()).stream()
                    .filter(Asset::isImage)
                    .findFirst()
                    .orElse(null);
            grid.getChildren().add(ProjectCard.of(project, cover,
                    () -> appView.navigateToAssets(project.id())));
        }
        content.getChildren().add(grid);
    }

    private void addRecentFiles(VBox content) {
        List<Asset> recent = context.assets().findRecent(6);
        if (recent.isEmpty()) {
            return;
        }
        content.getChildren().add(sectionLabel("Recently added"));

        Map<Long, String> projectNames = context.projects().namesById();
        VBox list = new VBox();
        list.getStyleClass().add("panel");
        for (Asset asset : recent) {
            Label name = new Label(asset.fileName());
            name.getStyleClass().add("row-title");

            Label project = new Label(projectNames.getOrDefault(asset.projectId(), "—"));
            project.getStyleClass().add("row-note");

            Region spacer = new Region();
            HBox.setHgrow(spacer, Priority.ALWAYS);

            Label added = new Label(Formats.relative(asset.addedAt()));
            added.getStyleClass().add("row-note");

            HBox row = new HBox(12, TypeChip.of(asset.fileType()), name, project, spacer,
                    StatusBadge.of(asset.status()), added);
            row.setAlignment(Pos.CENTER_LEFT);
            row.getStyleClass().add("list-row");
            row.setOnMouseClicked(e -> {
                if (e.getClickCount() == 2) {
                    ReportDialog.show(window(), context, asset);
                }
            });
            list.getChildren().add(row);
        }
        content.getChildren().add(list);
    }

    private static Label sectionLabel(String text) {
        Label label = new Label(text.toUpperCase(java.util.Locale.ROOT));
        label.getStyleClass().add("section-label");
        return label;
    }

    private javafx.stage.Window window() {
        return root.getScene() == null ? null : root.getScene().getWindow();
    }
}
