package creatorflow.workflow;

import java.time.Instant;

/** Durable operational/audit entry. */
public record AuditEventRecord(long id, String scanRunId, String eventType, String payloadJson,
                               Instant createdAt) {
}
