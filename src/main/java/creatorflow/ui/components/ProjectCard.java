package creatorflow.ui.components;

import creatorflow.model.Asset;
import creatorflow.model.Project;
import creatorflow.ui.util.Formats;
import java.nio.file.Files;
import java.nio.file.Path;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.scene.shape.Rectangle;

/** Project tile: cover (first image asset, or a placeholder monogram), name, meta. */
public final class ProjectCard {

    private static final double COVER_HEIGHT = 104;

    private ProjectCard() {
    }

    public static VBox of(Project project, Asset coverAsset, Runnable onOpen) {
        Label name = new Label(project.name());
        name.getStyleClass().add("card-title");

        Label meta = new Label(project.assetCount() == 1
                ? "1 asset · created " + Formats.relative(project.createdAt())
                : project.assetCount() + " assets · created " + Formats.relative(project.createdAt()));
        meta.getStyleClass().add("card-meta");

        Label description = new Label(project.description().isBlank()
                ? "No description yet." : project.description());
        description.getStyleClass().add("card-description");
        description.setWrapText(true);

        VBox card = new VBox(4, cover(project, coverAsset), name, meta, description);
        card.getStyleClass().add("project-card");
        card.setOnMouseClicked(e -> onOpen.run());
        HBox.setHgrow(card, Priority.ALWAYS);
        return card;
    }

    private static StackPane cover(Project project, Asset coverAsset) {
        StackPane cover = new StackPane();
        cover.getStyleClass().add("project-cover");
        cover.setMinHeight(COVER_HEIGHT);
        cover.setPrefHeight(COVER_HEIGHT);
        cover.setMaxHeight(COVER_HEIGHT);

        ImageView imageView = coverImage(coverAsset);
        if (imageView != null) {
            cover.getChildren().add(imageView);
            Rectangle clip = new Rectangle();
            clip.setArcWidth(12);
            clip.setArcHeight(12);
            clip.widthProperty().bind(cover.widthProperty());
            clip.heightProperty().bind(cover.heightProperty());
            cover.setClip(clip);
        } else {
            Label monogram = new Label(project.name().isBlank()
                    ? "?" : project.name().substring(0, 1).toUpperCase(java.util.Locale.ROOT));
            monogram.getStyleClass().add("project-monogram");
            cover.getChildren().add(monogram);
            cover.setAlignment(Pos.CENTER);
        }
        return cover;
    }

    private static ImageView coverImage(Asset asset) {
        if (asset == null || !asset.isImage() || !Files.exists(Path.of(asset.storedPath()))) {
            return null;
        }
        Image image = new Image(Path.of(asset.storedPath()).toUri().toString(), 560, 0, true, true);
        if (image.isError()) {
            return null;
        }
        ImageView view = new ImageView(image);
        view.setFitHeight(COVER_HEIGHT);
        view.setPreserveRatio(true);
        return view;
    }
}
