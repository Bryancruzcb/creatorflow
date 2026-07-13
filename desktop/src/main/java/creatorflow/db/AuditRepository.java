package creatorflow.db;

import creatorflow.workflow.AuditEventRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Durable append-only operational audit trail. */
public final class AuditRepository {

    private final Connection connection;

    public AuditRepository(Database database) {
        this.connection = database.connection();
    }

    public AuditEventRecord append(String scanRunId, String eventType, String payloadJson) {
        Instant now = Instant.now();
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO audit_events(scan_run_id, event_type, payload_json, created_at)
                    VALUES (?, ?, ?, ?)""", Statement.RETURN_GENERATED_KEYS)) {
                statement.setString(1, scanRunId);
                statement.setString(2, requireText(eventType));
                statement.setString(3, payloadJson == null ? "{}" : payloadJson);
                statement.setString(4, now.toString());
                statement.executeUpdate();
                try (ResultSet keys = statement.getGeneratedKeys()) {
                    if (!keys.next()) throw new SQLException("Audit insert did not return an id");
                    return new AuditEventRecord(keys.getLong(1), scanRunId, eventType,
                            payloadJson == null ? "{}" : payloadJson, now);
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not append audit event", e);
            }
        }
    }

    public List<AuditEventRecord> forScan(String scanRunId) {
        synchronized (connection) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT * FROM audit_events WHERE scan_run_id = ? ORDER BY id""")) {
                statement.setString(1, scanRunId);
                try (ResultSet result = statement.executeQuery()) {
                    List<AuditEventRecord> events = new ArrayList<>();
                    while (result.next()) {
                        events.add(new AuditEventRecord(result.getLong("id"), scanRunId,
                                result.getString("event_type"), result.getString("payload_json"),
                                Instant.parse(result.getString("created_at"))));
                    }
                    return events;
                }
            } catch (SQLException e) {
                throw new IllegalStateException("Could not list audit events", e);
            }
        }
    }

    private static String requireText(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Event type is required");
        return value.strip();
    }
}
