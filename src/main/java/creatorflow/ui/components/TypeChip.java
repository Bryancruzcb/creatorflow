package creatorflow.ui.components;

import java.util.Locale;
import java.util.Set;
import javafx.scene.control.Label;

/** Small monospace file-type chip, tinted by category (image / audio / model / other). */
public final class TypeChip {

    private static final Set<String> IMAGES = Set.of("png", "jpg", "jpeg", "gif", "bmp", "webp");
    private static final Set<String> AUDIO = Set.of("wav", "aif", "aiff", "au", "mp3", "ogg", "flac");
    private static final Set<String> MODELS = Set.of("glb", "gltf", "fbx", "obj", "blend", "stl");

    private TypeChip() {
    }

    public static Label of(String fileType) {
        String type = fileType == null ? "" : fileType.toLowerCase(Locale.ROOT);
        Label chip = new Label(type.isBlank() ? "FILE" : type.toUpperCase(Locale.ROOT));
        chip.getStyleClass().addAll("type-chip", "type-chip-" + category(type));
        return chip;
    }

    private static String category(String type) {
        if (IMAGES.contains(type)) {
            return "image";
        }
        if (AUDIO.contains(type)) {
            return "audio";
        }
        if (MODELS.contains(type)) {
            return "model";
        }
        return "other";
    }
}
