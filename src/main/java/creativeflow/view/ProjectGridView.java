package creativeflow.view;

import creativeflow.component.ProjectCard;
import javafx.scene.layout.ColumnConstraints;
import javafx.scene.layout.GridPane;

/** Builds the project-card grid. */
public class ProjectGridView {

    private final GridPane root;

    public ProjectGridView() {
        root = buildProjectGrid();
    }

    public GridPane getRoot() {
        return root;
    }

    private GridPane buildProjectGrid() {
        GridPane grid = new GridPane();
        grid.setHgap(12);
        grid.setVgap(12);

        String[][] projects = {
            {"Fantasy RPG Game", "#E1F5EE", "18 assets · updated today", "Unity, sprites"},
            {"Logo Pack v2", "#EEEDFE", "9 assets · updated 2d ago", "client, final"},
            {"3D Character Model", "#FAECE7", "6 assets · draft", "Blender, .glb"}
        };

        for (int i = 0; i < projects.length; i++) {
            ProjectCard card = new ProjectCard(
                projects[i][0],
                projects[i][1],
                projects[i][2],
                projects[i][3]
            );

            grid.add(card.getRoot(), i, 0);

            ColumnConstraints column = new ColumnConstraints();
            column.setPercentWidth(33.33);
            grid.getColumnConstraints().add(column);
        }

        return grid;
    }
}
