package creatorflow.ui.pages;

import creatorflow.AppContext;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.registry.HttpRegistryClient;
import creatorflow.service.registry.RegistrySettings;
import creatorflow.ui.PageHeader;
import creatorflow.verification.OriginalityEngine;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.PasswordField;
import javafx.scene.control.ScrollPane;
import javafx.scene.control.TextField;
import javafx.scene.control.TextInputDialog;
import javafx.scene.control.Tooltip;
import javafx.scene.input.Clipboard;
import javafx.scene.input.ClipboardContent;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
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

        content.getChildren().add(registryCard(context));

        content.getChildren().add(openCloudCard(context));

        content.getChildren().add(card("About",
                "CreatorFlow 1.3.0 — asset manager with a built-in originality check.",
                note("Java " + System.getProperty("java.version")
                        + " · JavaFX " + System.getProperty("javafx.version", "runtime"))));

        root = new ScrollPane(content);
        root.setFitToWidth(true);
        root.getStyleClass().add("page-scroll");
    }

    public ScrollPane getRoot() {
        return root;
    }

    /** Opt-in connection to a shared registry; imports send fingerprints only, never files. */
    private VBox registryCard(AppContext context) {
        RegistrySettings settings = context.registrySettings();

        TextField url = new TextField(settings.baseUrl());
        url.setPromptText("http://localhost:8080");
        HBox.setHgrow(url, Priority.ALWAYS);

        TextField key = new TextField(settings.apiKey());
        key.setPromptText("issued when you create an account");
        HBox.setHgrow(key, Priority.ALWAYS);

        Label status = new Label(settings.isConfigured()
                ? "Configured" + (settings.username().isBlank() ? "" : " as " + settings.username())
                : "Not configured — imports verify against the local library only.");
        status.getStyleClass().add("field-note");
        status.setWrapText(true);

        Button test = new Button("Test connection");
        test.getStyleClass().add("ghost-button");
        test.setOnAction(e -> status.setText(HttpRegistryClient.health(url.getText())
                ? "Registry reachable."
                : "Could not reach " + url.getText().strip() + " — is the server running?"));

        Button createAccount = new Button("Create account");
        createAccount.getStyleClass().add("ghost-button");
        createAccount.setOnAction(e -> {
            TextInputDialog prompt = new TextInputDialog(settings.username());
            prompt.setTitle("Create registry account");
            prompt.setHeaderText(null);
            prompt.setContentText("Username:");
            prompt.initOwner(root.getScene() == null ? null : root.getScene().getWindow());
            if (root.getScene() != null) {
                prompt.getDialogPane().getStylesheets().addAll(root.getScene().getStylesheets());
                prompt.getDialogPane().getStyleClass().add("cf-dialog");
            }
            prompt.showAndWait().ifPresent(username -> {
                try {
                    String apiKey = HttpRegistryClient.createAccount(url.getText(), username.strip());
                    key.setText(apiKey);
                    settings.save(url.getText(), apiKey, username.strip());
                    status.setText("Account “" + username.strip() + "” created — key saved.");
                } catch (Exception ex) {
                    status.setText("Could not create account: " + ex.getMessage());
                }
            });
        });

        Button save = new Button("Save");
        save.getStyleClass().add("primary-button");
        save.setOnAction(e -> {
            settings.save(url.getText(), key.getText(), settings.username());
            status.setText(settings.isConfigured()
                    ? "Saved — imports now check the community registry too."
                    : "Saved. Fill both fields to enable registry checks.");
        });

        VBox fields = new VBox(8,
                fieldLabel("Server URL"), url,
                fieldLabel("API key"), key,
                new HBox(8, createAccount, test, save),
                status);

        return card("Community registry",
                "Optional. When configured, every import is also checked against everyone's "
                        + "registered fingerprints on a shared server — your files never leave "
                        + "this machine, only their fingerprints do. Run the server with: "
                        + "mvn -pl server spring-boot:run",
                fields);
    }

    /**
     * Opt-in Roblox Open Cloud key used to verify animation ownership. Unlike the registry card,
     * the field is <em>masked</em> (higher-privilege secret) and a storage-mode note tells the
     * user the truth about how the key is protected at rest.
     */
    private VBox openCloudCard(AppContext context) {
        OpenCloudSettings settings = context.openCloudSettings();

        PasswordField key = new PasswordField();
        key.setText(settings.apiKey());
        key.setPromptText("paste your Open Cloud API key");
        HBox.setHgrow(key, Priority.ALWAYS);

        Label storage = new Label(storageLine(settings));
        storage.getStyleClass().add("field-note");
        storage.setWrapText(true);

        Label status = new Label(settings.isConfigured()
                ? "Configured — ownership can be verified for animations with a Roblox id."
                : "Not configured — add a key to verify who owns an animation and its experience.");
        status.getStyleClass().add("field-note");
        status.setWrapText(true);

        // Seam: real connection testing needs the Open Cloud client, wired in Task 3. The button
        // exists now (disabled) so the layout and enable/wire step land cleanly then.
        Button test = new Button("Test connection");
        test.getStyleClass().add("ghost-button");
        test.setDisable(true);
        test.setTooltip(new Tooltip("Available once Open Cloud verification ships."));

        Button save = new Button("Save");
        save.getStyleClass().add("primary-button");
        save.setOnAction(e -> {
            settings.save(key.getText());
            key.setText(settings.apiKey());
            storage.setText(storageLine(settings));
            status.setText(settings.isConfigured()
                    ? "Saved — key stored, " + settings.storageMode().label() + "."
                    : "Cleared — no key stored.");
        });

        Button clear = new Button("Clear");
        clear.getStyleClass().add("ghost-button");
        clear.setOnAction(e -> {
            settings.clear();
            key.clear();
            storage.setText(storageLine(settings));
            status.setText("Cleared — no key stored.");
        });

        VBox fields = new VBox(8,
                fieldLabel("API key"), key,
                storage,
                new HBox(8, test, save, clear),
                status);

        return card("Roblox Open Cloud",
                "Optional. Add a user-scoped Open Cloud API key (asset, universe, and group read) "
                        + "to verify who created an animation and who owns the target experience. "
                        + "The key stays on this machine — never in the manifest, the frontend, "
                        + "logs, or version control. Create one at "
                        + "create.roblox.com/dashboard/credentials.",
                fields);
    }

    private static String storageLine(OpenCloudSettings settings) {
        return "Key storage: " + settings.storageMode().label() + ".";
    }

    private static Label fieldLabel(String text) {
        Label label = new Label(text.toUpperCase(java.util.Locale.ROOT));
        label.getStyleClass().add("field-label");
        return label;
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
