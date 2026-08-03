package creatorflow.ui.pages;

import creatorflow.AppContext;
import creatorflow.service.opencloud.OpenCloudClient;
import creatorflow.service.opencloud.OpenCloudSettings;
import creatorflow.service.team.HttpTeamClient;
import creatorflow.service.team.TeamSettings;
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

        content.getChildren().add(teamCard(context));

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

    /**
     * Opt-in connection to a self-hosted team provenance store.
     *
     * <p>This card carries the whole second-team-member story end to end, in the order that person
     * hits it: server URL → create an account (with the operator's signup token if they set one) →
     * test the connection → join a team with a code, or create one → see who is in it. A teammate
     * needs nothing out-of-band except the base URL, the token if set, and a code.
     *
     * <p>The API key field is masked and protected at rest exactly like the Open Cloud key — same
     * {@code ApiKeyProtector}, same honest storage-mode label. The key never crosses the local
     * bridge; the workspace is told a boolean.
     */
    private VBox teamCard(AppContext context) {
        TeamSettings settings = context.teamSettings();

        TextField url = new TextField(settings.baseUrl());
        url.setPromptText("http://studio-box.local:8080");
        HBox.setHgrow(url, Priority.ALWAYS);

        PasswordField key = new PasswordField();
        key.setText(settings.apiKey());
        key.setPromptText("issued when you create an account");
        HBox.setHgrow(key, Priority.ALWAYS);

        TextField signupToken = new TextField();
        signupToken.setPromptText("only if the person running the server set one");
        HBox.setHgrow(signupToken, Priority.ALWAYS);

        Label storage = new Label(TeamCardText.storageLine(settings.storageMode()));
        storage.getStyleClass().add("field-note");
        storage.setWrapText(true);

        Label members = note("");
        Label status = note(TeamCardText.configurationStatus(settings.hasAccount(), settings.teamName()));

        Button test = new Button("Test connection");
        test.getStyleClass().add("ghost-button");
        test.setOnAction(e -> {
            if (url.getText() == null || url.getText().isBlank()) {
                status.setText(TeamCardText.SAVE_BEFORE_TESTING);
                return;
            }
            status.setText(TeamCardText.connectionMessage(
                    HttpTeamClient.health(url.getText()), url.getText()));
        });

        Button createAccount = new Button("Create account");
        createAccount.getStyleClass().add("ghost-button");
        createAccount.setOnAction(e -> prompt("Create an account on the team store", "Username:",
                settings.username()).ifPresent(username -> {
            try {
                String apiKey = HttpTeamClient.createAccount(url.getText(), username.strip(),
                        signupToken.getText());
                settings.save(url.getText(), apiKey, username.strip());
                key.setText(apiKey);
                storage.setText(TeamCardText.storageLine(settings.storageMode()));
                status.setText(TeamCardText.accountCreated(username.strip()));
            } catch (Exception failure) {
                status.setText(TeamCardText.accountFailed(safeMessage(failure)));
            }
        }));

        Button save = new Button("Save");
        save.getStyleClass().add("primary-button");
        save.setOnAction(e -> {
            settings.save(url.getText(), key.getText(), settings.username());
            key.setText(settings.apiKey());
            storage.setText(TeamCardText.storageLine(settings.storageMode()));
            status.setText(TeamCardText.configurationStatus(settings.hasAccount(), settings.teamName()));
        });

        Button joinTeam = new Button("Join team");
        joinTeam.getStyleClass().add("ghost-button");
        joinTeam.setTooltip(new Tooltip("Paste a single-use join code from a team owner."));
        joinTeam.setOnAction(e -> prompt("Join a team", "Join code:", "").ifPresent(code -> {
            try {
                var joined = new HttpTeamClient(settings).joinTeam(code.strip());
                settings.saveTeam(joined.id(), joined.name());
                status.setText(TeamCardText.joinedTeam(joined.name()));
                refreshMembers(settings, members);
            } catch (Exception failure) {
                status.setText(TeamCardText.failed("join that team", safeMessage(failure)));
            }
        }));

        Button createTeam = new Button("Create team");
        createTeam.getStyleClass().add("ghost-button");
        createTeam.setOnAction(e -> prompt("Create a team", "Team name:", "").ifPresent(name -> {
            try {
                var created = new HttpTeamClient(settings).createTeam(name.strip());
                settings.saveTeam(created.id(), created.name());
                status.setText(TeamCardText.createdTeam(created.name()));
                refreshMembers(settings, members);
            } catch (Exception failure) {
                status.setText(TeamCardText.failed("create that team", safeMessage(failure)));
            }
        }));

        Button joinCode = new Button("Mint join code");
        joinCode.getStyleClass().add("ghost-button");
        joinCode.setTooltip(new Tooltip("Owners only. Shown once, single-use, expires in 24 hours."));
        joinCode.setOnAction(e -> {
            if (settings.teamId() == null) {
                status.setText("Join or create a team first.");
                return;
            }
            try {
                String code = new HttpTeamClient(settings).issueJoinCode(settings.teamId());
                ClipboardContent clip = new ClipboardContent();
                clip.putString(code);
                Clipboard.getSystemClipboard().setContent(clip);
                // The raw code is shown here and nowhere else: the server kept only its hash.
                status.setText("Join code copied: " + code + " — " + TeamCardText.CODE_SHOWN_ONCE);
            } catch (Exception failure) {
                status.setText(TeamCardText.failed("mint a join code", safeMessage(failure)));
            }
        });

        refreshMembers(settings, members);

        VBox fields = new VBox(8,
                fieldLabel("Server URL"), url,
                fieldLabel("Signup token (optional)"), signupToken,
                fieldLabel("API key"), key,
                storage,
                new HBox(8, createAccount, test, save),
                new HBox(8, joinTeam, createTeam, joinCode),
                members,
                status,
                note(TeamCardText.OPTIONAL),
                note(TeamCardText.ONE_ACCOUNT_EACH));

        return card("Team provenance store",
                "Optional, self-hosted, and off unless you set it up. When a team is connected, the "
                        + "motion comparison view can ask that team's store who else recorded the "
                        + "exact same curve fingerprint. Only the fingerprint and what you type "
                        + "travel — never curves, files, or scan paths. Run the server with: "
                        + "mvn -pl server spring-boot:run",
                fields);
    }

    /** Live member list, or nothing at all — never a stale one, because none is kept. */
    private static void refreshMembers(TeamSettings settings, Label target) {
        if (!settings.isConfigured()) {
            target.setText("");
            return;
        }
        try {
            var lines = new HttpTeamClient(settings).memberLines(settings.teamId());
            target.setText("Members: " + String.join(", ", lines));
        } catch (Exception unreachable) {
            target.setText("Members: unknown — the team store could not be reached just now.");
        }
    }

    private java.util.Optional<String> prompt(String title, String field, String initial) {
        TextInputDialog dialog = new TextInputDialog(initial == null ? "" : initial);
        dialog.setTitle(title);
        dialog.setHeaderText(null);
        dialog.setContentText(field);
        dialog.initOwner(root.getScene() == null ? null : root.getScene().getWindow());
        if (root.getScene() != null) {
            dialog.getDialogPane().getStylesheets().addAll(root.getScene().getStylesheets());
            dialog.getDialogPane().getStyleClass().add("cf-dialog");
        }
        return dialog.showAndWait().filter(value -> !value.isBlank());
    }

    /** Never lets a null message render as the word "null" in the status line. */
    private static String safeMessage(Exception failure) {
        return failure.getMessage() == null || failure.getMessage().isBlank()
                ? failure.getClass().getSimpleName() : failure.getMessage();
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

        Label status = new Label(OpenCloudCardText.configurationStatus(settings.isConfigured()));
        status.getStyleClass().add("field-note");
        status.setWrapText(true);

        // Probes Open Cloud with the saved key (a stable public asset) so the user learns the key is
        // accepted before relying on it. Synchronous, mirroring the registry card's "Test connection".
        Button test = new Button("Test connection");
        test.getStyleClass().add("ghost-button");
        test.setTooltip(new Tooltip("Checks that Roblox accepts your saved key."));
        test.setOnAction(e -> {
            if (!settings.isConfigured()) {
                status.setText(OpenCloudCardText.SAVE_BEFORE_TESTING);
                return;
            }
            status.setText(OpenCloudCardText.connectionMessage(
                    new OpenCloudClient(settings).testConnection()));
        });

        Button save = new Button("Save");
        save.getStyleClass().add("primary-button");
        save.setOnAction(e -> {
            settings.save(key.getText());
            key.setText(settings.apiKey());
            storage.setText(storageLine(settings));
            status.setText(OpenCloudCardText.savedStatus(
                    settings.isConfigured(), settings.storageMode()));
        });

        Button clear = new Button("Clear");
        clear.getStyleClass().add("ghost-button");
        clear.setOnAction(e -> {
            settings.clear();
            key.clear();
            storage.setText(storageLine(settings));
            status.setText(OpenCloudCardText.CLEARED);
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
        return OpenCloudCardText.storageLine(settings.storageMode());
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
