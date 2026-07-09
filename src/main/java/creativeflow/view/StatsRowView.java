package creativeflow.view;

import creativeflow.component.StatCard;
import javafx.scene.layout.HBox;

/** Builds the dashboard stats row. */
public class StatsRowView {

    private final HBox root;

    public StatsRowView() {
        root = buildStatsRow();
    }

    public HBox getRoot() {
        return root;
    }

    private HBox buildStatsRow() {
        HBox row = new HBox(10);
        row.getStyleClass().add("stats-row");

        String[][] stats = {
            {"4", "Projects"},
            {"38", "Assets"},
            {"3", "Exports"},
            {"2", "Drafts"}
        };

        for (String[] stat : stats) {
            row.getChildren().add(new StatCard(stat[0], stat[1]).getRoot());
        }

        return row;
    }
}
