package creatorflow.ui.pages;

import creatorflow.AppContext;
import creatorflow.model.Asset;
import creatorflow.model.Project;
import creatorflow.ui.AppView;
import creatorflow.ui.PageHeader;
import creatorflow.ui.components.EmptyState;
import creatorflow.ui.components.ProjectCard;
import creatorflow.ui.dialogs.NewProjectDialog;
import java.util.List;
import javafx.scene.control.Button;
import javafx.scene.control.ScrollPane;
import javafx.scene.layout.ColumnConstraints;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.VBox;

public final class ProjectsPage {

    private final AppContext context;
    private final AppView appView;
    private final ScrollPane root;

    public ProjectsPage(AppContext context, AppView appView) {
        this.context = context;
        this.appView = appView;

        VBox content = new VBox(20);
        content.getStyleClass().add("page");

        Button newProject = new Button("New project");
        newProject.getStyleClass().add("primary-button");
        newProject.setOnAction(e -> createProject());

        List<Project> projects = context.projects().findAll();
        content.getChildren().add(PageHeader.build("Projects",
                projects.size() == 1 ? "1 project" : projects.size() + " projects", newProject));

        if (projects.isEmpty()) {
            content.getChildren().add(EmptyState.of(
                    "No projects yet",
                    "Projects group related assets — a game, a client, a collection.",
                    "Create your first project",
                    this::createProject));
        } else {
            GridPane grid = new GridPane();
            grid.setHgap(12);
            grid.setVgap(12);
            for (int i = 0; i < 3; i++) {
                ColumnConstraints column = new ColumnConstraints();
                column.setPercentWidth(100.0 / 3);
                grid.getColumnConstraints().add(column);
            }
            int i = 0;
            for (Project project : projects) {
                Asset cover = context.assets().findByProject(project.id()).stream()
                        .filter(Asset::isImage)
                        .findFirst()
                        .orElse(null);
                grid.add(ProjectCard.of(project, cover,
                        () -> appView.navigateToAssets(project.id())), i % 3, i / 3);
                i++;
            }
            content.getChildren().add(grid);
        }

        root = new ScrollPane(content);
        root.setFitToWidth(true);
        root.getStyleClass().add("page-scroll");
    }

    public ScrollPane getRoot() {
        return root;
    }

    private void createProject() {
        javafx.stage.Window window = root.getScene() == null ? null : root.getScene().getWindow();
        NewProjectDialog.show(window, context.projects()).ifPresent(p -> appView.refresh());
    }
}
