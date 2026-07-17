package creatorflow.db;

import creatorflow.workflow.LocalProject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Persists only roots selected through the desktop-owned native directory picker. */
public final class LocalProjectRepository {

    private final Connection connection;

    public LocalProjectRepository(Database database) {
        this.connection = database.connection();
    }

    public LocalProject adopt(Path selectedRoot) {
        Path root = canonicalDirectory(selectedRoot);
        synchronized (connection) {
            Optional<LocalProject> existing = findByRootInternal(root);
            if (existing.isPresent()) return existing.orElseThrow();

            String baseName = root.getFileName() == null ? "Local project" : root.getFileName().toString();
            Instant now = Instant.now();
            boolean previousAutoCommit;
            try {
                String name = availableName(baseName.isBlank() ? "Local project" : baseName);
                previousAutoCommit = connection.getAutoCommit();
                connection.setAutoCommit(false);
                long projectId;
                try (PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO projects(name, description, created_at) VALUES (?, ?, ?)",
                        Statement.RETURN_GENERATED_KEYS)) {
                    statement.setString(1, name);
                    statement.setString(2, "Local project selected through CreatorFlow");
                    statement.setString(3, now.toString());
                    statement.executeUpdate();
                    try (ResultSet keys = statement.getGeneratedKeys()) {
                        if (!keys.next()) throw new SQLException("Project insert did not return an id");
                        projectId = keys.getLong(1);
                    }
                }
                try (PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO local_projects(project_id, root_path, adopted_at, ui_state_json)
                        VALUES (?, ?, ?, '{}')""")) {
                    statement.setLong(1, projectId);
                    statement.setString(2, root.toString());
                    statement.setString(3, now.toString());
                    statement.executeUpdate();
                }
                connection.commit();
                connection.setAutoCommit(previousAutoCommit);
                return new LocalProject(projectId, name, root, now, null, "{}", null, null, null);
            } catch (SQLException e) {
                rollbackQuietly();
                autoCommitQuietly();
                throw new IllegalStateException("Could not adopt local project " + root, e);
            }
        }
    }

    public Optional<LocalProject> findByProjectId(long projectId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT lp.*, p.name FROM local_projects lp
                    JOIN projects p ON p.id = lp.project_id
                    WHERE lp.project_id = ?""")) {
                statement.setLong(1, projectId);
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(map(result)) : Optional.empty();
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not load local project " + projectId, e);
            }
        }
    }

    public Optional<LocalProject> findByRoot(Path root) {
        Path canonical = canonicalDirectory(root);
        synchronized (connection) {
            return findByRootInternal(canonical);
        }
    }

    public List<LocalProject> list() {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT lp.*, p.name FROM local_projects lp
                    JOIN projects p ON p.id = lp.project_id
                    ORDER BY lower(p.name), lp.project_id""");
                 ResultSet result = statement.executeQuery()) {
                List<LocalProject> projects = new ArrayList<>();
                while (result.next()) projects.add(map(result));
                return projects;
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list local projects", e);
            }
        }
    }

    public void setActiveScanRun(long projectId, String scanRunId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "UPDATE local_projects SET active_scan_run_id = ? WHERE project_id = ?")) {
                statement.setString(1, scanRunId);
                statement.setLong(2, projectId);
                if (statement.executeUpdate() != 1) {
                    throw new IllegalArgumentException("Unknown local project " + projectId);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not update active scan run", e);
            }
        }
    }

    public void saveUiState(long projectId, String uiStateJson) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "UPDATE local_projects SET ui_state_json = ? WHERE project_id = ?")) {
                statement.setString(1, uiStateJson == null ? "{}" : uiStateJson);
                statement.setLong(2, projectId);
                if (statement.executeUpdate() != 1) {
                    throw new IllegalArgumentException("Unknown local project " + projectId);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not save project UI state", e);
            }
        }
    }

    /**
     * Records the user's declared intended Roblox experience for this project. This is a
     * human declaration only; CreatorFlow does not verify ownership of or access to it.
     */
    public void bindExperience(long projectId, Long universeId, Long placeId, String experienceName) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement(
                    "UPDATE local_projects SET universe_id = ?, place_id = ?, experience_name = ? WHERE project_id = ?")) {
                setNullableLong(statement, 1, universeId);
                setNullableLong(statement, 2, placeId);
                statement.setString(3, experienceName);
                statement.setLong(4, projectId);
                if (statement.executeUpdate() != 1) {
                    throw new IllegalArgumentException("Unknown local project " + projectId);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not bind intended experience", e);
            }
        }
    }

    private Optional<LocalProject> findByRootInternal(Path root) {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT lp.*, p.name FROM local_projects lp
                JOIN projects p ON p.id = lp.project_id
                WHERE lp.root_path = ?""")) {
            statement.setString(1, root.toString());
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(map(result)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not find local project", e);
        }
    }

    private String availableName(String base) throws SQLException {
        String candidate = base;
        int suffix = 2;
        while (nameExists(candidate)) candidate = base + " (" + suffix++ + ")";
        return candidate;
    }

    private boolean nameExists(String name) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "SELECT 1 FROM projects WHERE name = ? COLLATE NOCASE")) {
            statement.setString(1, name);
            try (ResultSet result = statement.executeQuery()) {
                return result.next();
            }
        }
    }

    private static LocalProject map(ResultSet result) throws SQLException {
        return new LocalProject(
                result.getLong("project_id"),
                result.getString("name"),
                Path.of(result.getString("root_path")),
                Instant.parse(result.getString("adopted_at")),
                result.getString("active_scan_run_id"),
                result.getString("ui_state_json"),
                getNullableLong(result, "universe_id"),
                getNullableLong(result, "place_id"),
                result.getString("experience_name"));
    }

    private static void setNullableLong(PreparedStatement statement, int index, Long value) throws SQLException {
        if (value == null) statement.setNull(index, java.sql.Types.BIGINT);
        else statement.setLong(index, value);
    }

    private static Long getNullableLong(ResultSet result, String column) throws SQLException {
        long value = result.getLong(column);
        return result.wasNull() ? null : value;
    }

    private static Path canonicalDirectory(Path path) {
        if (path == null) throw new IllegalArgumentException("Project root is required");
        try {
            Path real = path.toRealPath();
            if (!Files.isDirectory(real)) throw new IllegalArgumentException("Project root is not a directory: " + path);
            return real;
        } catch (IOException e) {
            throw new IllegalArgumentException("Project root cannot be opened: " + path, e);
        }
    }

    private void rollbackQuietly() {
        try {
            connection.rollback();
        } catch (SQLException ignored) {
            // original failure is more useful
        }
    }

    private void autoCommitQuietly() {
        try {
            connection.setAutoCommit(true);
        } catch (SQLException ignored) {
            // surfaced by the next database operation
        }
    }
}
