package creatorflow.db;

import creatorflow.model.Project;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public final class ProjectRepository {

    private static final String SELECT_WITH_COUNT = """
            SELECT p.id, p.name, p.description, p.created_at, COUNT(a.id) AS asset_count
            FROM projects p LEFT JOIN assets a ON a.project_id = p.id
            """;

    private final Connection conn;

    public ProjectRepository(Database database) {
        this.conn = database.connection();
    }

    public Project insert(String name, String description) {
        if (existsByName(name)) {
            throw new IllegalArgumentException("A project named “" + name + "” already exists.");
        }
        Instant now = Instant.now();
        String sql = "INSERT INTO projects(name, description, created_at) VALUES (?, ?, ?)";
        try (PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, name);
            ps.setString(2, description);
            ps.setString(3, now.toString());
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                keys.next();
                return new Project(keys.getLong(1), name, description, now, 0);
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not create project", e);
        }
    }

    public boolean existsByName(String name) {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT 1 FROM projects WHERE name = ? COLLATE NOCASE")) {
            ps.setString(1, name);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not query projects", e);
        }
    }

    public List<Project> findAll() {
        String sql = SELECT_WITH_COUNT + " GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC";
        try (PreparedStatement ps = conn.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            List<Project> projects = new ArrayList<>();
            while (rs.next()) {
                projects.add(map(rs));
            }
            return projects;
        } catch (SQLException e) {
            throw new IllegalStateException("Could not list projects", e);
        }
    }

    public Optional<Project> findById(long id) {
        String sql = SELECT_WITH_COUNT + " WHERE p.id = ? GROUP BY p.id";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(map(rs)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not load project " + id, e);
        }
    }

    public Map<Long, String> namesById() {
        try (PreparedStatement ps = conn.prepareStatement("SELECT id, name FROM projects");
             ResultSet rs = ps.executeQuery()) {
            Map<Long, String> names = new HashMap<>();
            while (rs.next()) {
                names.put(rs.getLong(1), rs.getString(2));
            }
            return names;
        } catch (SQLException e) {
            throw new IllegalStateException("Could not list project names", e);
        }
    }

    public int count() {
        try (PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM projects");
             ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getInt(1);
        } catch (SQLException e) {
            throw new IllegalStateException("Could not count projects", e);
        }
    }

    private static Project map(ResultSet rs) throws SQLException {
        return new Project(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("description"),
                Instant.parse(rs.getString("created_at")),
                rs.getInt("asset_count"));
    }
}
