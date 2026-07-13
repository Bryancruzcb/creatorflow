package creatorflow.db;

import creatorflow.workflow.WorkspaceState;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

/** Stores the one local workspace cursor restored after restart. */
public final class WorkspaceStateRepository {

    private final Connection connection;

    public WorkspaceStateRepository(Database database) {
        this.connection = database.connection();
    }

    public WorkspaceState save(WorkspaceState state) {
        Instant savedAt = Instant.now();
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO workspace_state(singleton_id, active_project_id, active_scan_run_id,
                        selected_asset_id, selected_finding_id, filters_json, queue_json, updated_at)
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(singleton_id) DO UPDATE SET
                        active_project_id = excluded.active_project_id,
                        active_scan_run_id = excluded.active_scan_run_id,
                        selected_asset_id = excluded.selected_asset_id,
                        selected_finding_id = excluded.selected_finding_id,
                        filters_json = excluded.filters_json,
                        queue_json = excluded.queue_json,
                        updated_at = excluded.updated_at""")) {
                nullableLong(statement, 1, state.activeProjectId());
                statement.setString(2, state.activeScanRunId());
                nullableLong(statement, 3, state.selectedAssetId());
                nullableLong(statement, 4, state.selectedFindingId());
                statement.setString(5, state.filtersJson() == null ? "{}" : state.filtersJson());
                statement.setString(6, state.queueJson() == null ? "[]" : state.queueJson());
                statement.setString(7, savedAt.toString());
                statement.executeUpdate();
                return new WorkspaceState(state.activeProjectId(), state.activeScanRunId(),
                        state.selectedAssetId(), state.selectedFindingId(), state.filtersJson(),
                        state.queueJson(), savedAt);
            } catch (SQLException e) {
                throw new IllegalStateException("Could not save workspace state", e);
            }
        }
    }

    public Optional<WorkspaceState> load() {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "SELECT * FROM workspace_state WHERE singleton_id = 1");
                 ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(new WorkspaceState(
                        nullableLong(result, "active_project_id"), result.getString("active_scan_run_id"),
                        nullableLong(result, "selected_asset_id"),
                        nullableLong(result, "selected_finding_id"), result.getString("filters_json"),
                        result.getString("queue_json"), Instant.parse(result.getString("updated_at"))))
                        : Optional.empty();
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load workspace state", e);
            }
        }
    }

    private static void nullableLong(PreparedStatement statement, int index, Long value) throws SQLException {
        if (value == null) statement.setNull(index, java.sql.Types.BIGINT);
        else statement.setLong(index, value);
    }

    private static Long nullableLong(ResultSet result, String column) throws SQLException {
        long value = result.getLong(column);
        return result.wasNull() ? null : value;
    }
}
