package creatorflow.ui.dialogs;

import creatorflow.AppContext;
import creatorflow.model.Asset;
import creatorflow.model.AssetMatch;
import creatorflow.ui.components.StatusBadge;
import creatorflow.ui.components.TypeChip;
import creatorflow.ui.util.Formats;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.ButtonType;
import javafx.scene.control.Dialog;
import javafx.scene.control.Label;
import javafx.scene.control.Tooltip;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.stage.Window;

/** The originality report for one asset: verdict, evidence, provenance, declaration. */
public final class ReportDialog {

    private static final DateTimeFormatter ADDED =
            DateTimeFormatter.ofPattern("MMM d, uuuu 'at' HH:mm");

    private ReportDialog() {
    }

    public static void show(Window owner, AppContext context, Asset asset) {
        Dialog<ButtonType> dialog = new Dialog<>();
        dialog.setTitle("Originality report — " + asset.fileName());
        dialog.initOwner(owner);
        Dialogs.applyStyles(dialog, owner);
        dialog.getDialogPane().setContent(buildContent(context, asset));
        dialog.getDialogPane().getButtonTypes().add(ButtonType.CLOSE);
        dialog.showAndWait();
    }

    /** Also rendered standalone for README screenshots. */
    public static Node buildContent(AppContext context, Asset asset) {
        List<AssetMatch> matches = context.assets().matchesFor(asset.id());

        Label name = new Label(asset.fileName());
        name.getStyleClass().add("report-title");
        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);
        HBox titleRow = new HBox(10, TypeChip.of(asset.fileType()), name, spacer,
                StatusBadge.of(asset.status()));
        titleRow.setAlignment(Pos.CENTER_LEFT);

        Label verdictText = new Label(verdictLine(asset, matches));
        verdictText.setWrapText(true);
        verdictText.getStyleClass().add("verdict-text");
        HBox verdict = new HBox(verdictText);
        verdict.getStyleClass().addAll("verdict-banner",
                "verdict-" + asset.status().name().toLowerCase(Locale.ROOT));

        VBox content = new VBox(14, titleRow, verdict);
        content.getStyleClass().addAll("dialog-content", "report-content");
        content.setPrefWidth(560);

        Node preview = preview(asset);
        if (preview != null) {
            content.getChildren().add(preview);
        }

        if (!matches.isEmpty()) {
            VBox evidence = new VBox(6);
            for (AssetMatch match : matches) {
                Label layer = new Label(layerName(match.layer()));
                layer.getStyleClass().add("layer-chip");
                Label note = new Label(match.note());
                note.setWrapText(true);
                note.getStyleClass().add("row-note");
                HBox row = new HBox(10, layer, note);
                row.setAlignment(Pos.TOP_LEFT);
                evidence.getChildren().add(row);
            }
            content.getChildren().addAll(section("Match evidence"), evidence);
        }

        VBox provenance = new VBox(4);
        for (String finding : asset.findings().split("\n")) {
            if (finding.isBlank()) {
                continue;
            }
            Label label = new Label(finding);
            label.setWrapText(true);
            label.getStyleClass().add("row-note");
            provenance.getChildren().add(label);
        }
        if (!provenance.getChildren().isEmpty()) {
            content.getChildren().addAll(section("Provenance"), provenance);
        }

        VBox declaration = new VBox(4,
                keyValue("License", asset.license()),
                keyValue("Ownership", asset.ownershipDeclared()
                        ? "Declared by uploader" : "Not declared"),
                keyValue("Added", ADDED.format(asset.addedAt().atZone(ZoneId.systemDefault()))),
                sha(asset));
        content.getChildren().addAll(section("Declaration & identity"), declaration);

        Label layers = new Label("Layers run: " + String.join(" · ", layersRunFor(asset)));
        layers.getStyleClass().add("report-footer");
        layers.setWrapText(true);
        content.getChildren().add(layers);

        return content;
    }

    private static String verdictLine(Asset asset, List<AssetMatch> matches) {
        return switch (asset.status()) {
            case CLEAR -> "No matches against the indexed library. Detection can never prove "
                    + "originality — the uploader's declaration below is part of the record.";
            case SIMILAR -> "Perceptually close to " + matches.size()
                    + (matches.size() == 1 ? " indexed asset." : " indexed assets.")
                    + " Review before publishing or reusing.";
            case DUPLICATE -> "Byte-identical to an asset already in the library.";
        };
    }

    private static Node preview(Asset asset) {
        if (!asset.isImage() || !Files.exists(Path.of(asset.storedPath()))) {
            return null;
        }
        Image image = new Image(Path.of(asset.storedPath()).toUri().toString(), 0, 280, true, true);
        if (image.isError()) {
            return null;
        }
        ImageView view = new ImageView(image);
        view.setFitHeight(140);
        view.setPreserveRatio(true);
        HBox box = new HBox(view);
        box.getStyleClass().add("report-preview");
        return box;
    }

    private static Label section(String text) {
        Label label = new Label(text.toUpperCase(Locale.ROOT));
        label.getStyleClass().add("field-label");
        return label;
    }

    private static HBox keyValue(String key, String value) {
        Label keyLabel = new Label(key);
        keyLabel.getStyleClass().add("kv-key");
        keyLabel.setMinWidth(90);
        Label valueLabel = new Label(value);
        valueLabel.getStyleClass().add("kv-value");
        valueLabel.setWrapText(true);
        return new HBox(10, keyLabel, valueLabel);
    }

    private static HBox keyValueMono(String key, String value, String tooltip) {
        HBox row = keyValue(key, value);
        Label valueLabel = (Label) row.getChildren().get(1);
        valueLabel.getStyleClass().add("mono");
        if (tooltip != null) {
            Tooltip.install(valueLabel, new Tooltip(tooltip));
        }
        return row;
    }

    private static HBox sha(Asset asset) {
        return keyValueMono("SHA-256", Formats.shortSha(asset.sha256()), asset.sha256());
    }

    private static List<String> layersRunFor(Asset asset) {
        java.util.ArrayList<String> layers = new java.util.ArrayList<>();
        layers.add("SHA-256");
        if (asset.dHash() != null) {
            layers.add("dHash + pHash");
        }
        if (asset.audioFp() != null) {
            layers.add("audio fingerprint");
        }
        layers.add("metadata inspection");
        return layers;
    }

    private static String layerName(String layer) {
        return switch (layer) {
            case "sha256" -> "SHA-256";
            case "phash" -> "pHash";
            case "dhash" -> "dHash";
            case "audio" -> "AUDIO";
            default -> layer;
        };
    }
}
