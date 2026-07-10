package creatorflow.ui.pages;

import creatorflow.AppContext;
import creatorflow.ui.PageHeader;
import creatorflow.verification.OriginalityEngine;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ScrollPane;
import javafx.scene.input.Clipboard;
import javafx.scene.input.ClipboardContent;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

public final class SettingsPage {

    private final ScrollPane root;

    public SettingsPage(AppContext context) {
        VBox content = new VBox(16);
        content.getStyleClass().add("page");

        content.getChildren().add(PageHeader.build("Settings",
                "Where CreatorFlow keeps your data, and how verification works."));

        String dataDir = context.paths().dataDir().toString();
        Label path = new Label(dataDir);
        path.getStyleClass().add("mono");

        Button copy = new Button("Copy path");
        copy.getStyleClass().add("ghost-button");
        copy.setOnAction(e -> {
            ClipboardContent clip = new ClipboardContent();
            clip.putString(dataDir);
            Clipboard.getSystemClipboard().setContent(clip);
            copy.setText("Copied");
        });

        content.getChildren().add(card("Library location",
                "The database and every imported file live here. Point another machine at the "
                        + "same folder with -Dcreatorflow.data.dir=<path>.",
                new HBox(10, path, copy)));

        content.getChildren().add(card("Verification engine",
                "Imports run four layers: SHA-256 exact hashing, dHash + pHash perceptual image "
                        + "fingerprints, a volume-invariant audio energy fingerprint, and embedded "
                        + "metadata inspection. Fingerprints within a Hamming distance of "
                        + OriginalityEngine.SIMILARITY_THRESHOLD + "/64 are flagged as similar.",
                note("Detection proves conflicts, never ownership — every import also records "
                        + "the uploader's declaration and license.")));

        content.getChildren().add(card("About",
                "CreatorFlow 1.0.0 — asset manager with a built-in originality check.",
                note("Java " + System.getProperty("java.version")
                        + " · JavaFX " + System.getProperty("javafx.version", "runtime"))));

        root = new ScrollPane(content);
        root.setFitToWidth(true);
        root.getStyleClass().add("page-scroll");
    }

    public ScrollPane getRoot() {
        return root;
    }

    private static VBox card(String title, String body, javafx.scene.Node extra) {
        Label titleLabel = new Label(title);
        titleLabel.getStyleClass().add("card-title");

        Label bodyLabel = new Label(body);
        bodyLabel.getStyleClass().add("card-description");
        bodyLabel.setWrapText(true);

        VBox card = new VBox(8, titleLabel, bodyLabel, extra);
        card.getStyleClass().add("settings-card");
        card.setMaxWidth(720);
        return card;
    }

    private static Label note(String text) {
        Label label = new Label(text);
        label.getStyleClass().add("field-note");
        label.setWrapText(true);
        return label;
    }
}
