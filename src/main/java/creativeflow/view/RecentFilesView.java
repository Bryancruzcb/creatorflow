package creativeflow.view;

import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.scene.paint.Color;
import javafx.scene.shape.Circle;

/** Builds the recent files list. */
public class RecentFilesView {

    private final VBox root;

    public RecentFilesView() {
        root = buildRecentFilesList();
    }

    public VBox getRoot() {
        return root;
    }

    private VBox buildRecentFilesList() {
        VBox list = new VBox();
        list.getStyleClass().add("recent-files-list");

        String[][] files = {
            {"hero_sprite_final.png", "#1D9E75", "Fantasy RPG Game", "today"},
            {"character_base.glb", "#7F77DD", "3D Character Model", "yesterday"},
            {"forest_ambience.wav", "#EF9F27", "Fantasy RPG Game", "2d ago"}
        };

        for (int i = 0; i < files.length; i++) {
            HBox row = buildFileRow(files[i][0], files[i][1], files[i][2], files[i][3]);
            row.getStyleClass().add("file-row");

            if (i < files.length - 1) {
                row.getStyleClass().add("file-row-bordered");
            }

            list.getChildren().add(row);
        }

        return list;
    }

    private HBox buildFileRow(String fileName, String dotColor, String project, String date) {
        HBox row = new HBox(12);
        row.setAlignment(Pos.CENTER_LEFT);

        Circle dot = new Circle(4, Color.web(dotColor));

        Label nameLabel = new Label(fileName);
        nameLabel.getStyleClass().add("file-name");

        Label projectLabel = new Label(project);
        projectLabel.getStyleClass().add("file-meta");

        Label dateLabel = new Label(date);
        dateLabel.getStyleClass().add("file-meta");

        HBox.setHgrow(nameLabel, Priority.ALWAYS);
        row.getChildren().addAll(dot, nameLabel, projectLabel, dateLabel);

        return row;
    }
}
