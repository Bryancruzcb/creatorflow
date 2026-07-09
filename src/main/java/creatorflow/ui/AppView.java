package creatorflow.ui;

import creatorflow.AppContext;
import creatorflow.ui.pages.AssetsPage;
import creatorflow.ui.pages.DashboardPage;
import creatorflow.ui.pages.ProjectsPage;
import creatorflow.ui.pages.SettingsPage;
import javafx.scene.Node;
import javafx.scene.layout.BorderPane;

/** Root layout: fixed sidebar on the left, the active page in the center. */
public final class AppView {

    public enum Page {
        DASHBOARD("Dashboard"),
        PROJECTS("Projects"),
        ASSETS("Assets"),
        SETTINGS("Settings");

        private final String label;

        Page(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }
    }

    private final AppContext context;
    private final BorderPane root;
    private final Sidebar sidebar;

    private Page current = Page.DASHBOARD;
    private Long assetsProjectFilter;

    public AppView(AppContext context) {
        this.context = context;
        this.sidebar = new Sidebar(this);
        this.root = new BorderPane();
        root.getStyleClass().add("app-root");
        root.setLeft(sidebar.getRoot());
        navigate(Page.DASHBOARD);
    }

    public BorderPane getRoot() {
        return root;
    }

    public void navigate(Page page) {
        if (page != Page.ASSETS) {
            assetsProjectFilter = null;
        }
        current = page;
        root.setCenter(buildPage(page));
        sidebar.update(page, context.projects().count(), context.assets().count());
    }

    /** Assets page pre-filtered to one project (used by project cards). */
    public void navigateToAssets(long projectId) {
        assetsProjectFilter = projectId;
        current = Page.ASSETS;
        root.setCenter(buildPage(Page.ASSETS));
        sidebar.update(Page.ASSETS, context.projects().count(), context.assets().count());
    }

    /** Rebuilds the current page from the database (after imports, new projects, ...). */
    public void refresh() {
        if (current == Page.ASSETS && assetsProjectFilter != null) {
            navigateToAssets(assetsProjectFilter);
        } else {
            navigate(current);
        }
    }

    private Node buildPage(Page page) {
        return switch (page) {
            case DASHBOARD -> new DashboardPage(context, this).getRoot();
            case PROJECTS -> new ProjectsPage(context, this).getRoot();
            case ASSETS -> new AssetsPage(context, this, assetsProjectFilter).getRoot();
            case SETTINGS -> new SettingsPage(context).getRoot();
        };
    }
}
