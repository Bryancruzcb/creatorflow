package creatorflow.db;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PluginPairingRepositoryTest {

    @TempDir
    Path directory;

    @Test
    void insertsFindsListsAndRevokesRoundTrip() {
        try (Database database = new Database(directory.resolve("pairings.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var pairings = new PluginPairingRepository(database);

            Instant issuedAt = Instant.now();
            Instant expiresAt = issuedAt.plusSeconds(3600);
            var inserted = pairings.insert("pairing-1", projectId, "hash-1", issuedAt, expiresAt);
            assertEquals("pairing-1", inserted.id());
            assertEquals(projectId, inserted.projectId());
            assertEquals("hash-1", inserted.tokenHash());
            assertEquals(expiresAt, inserted.expiresAt());
            assertEquals(null, inserted.revokedAt());

            var active = pairings.findActiveByTokenHash("hash-1");
            assertTrue(active.isPresent());
            assertEquals("pairing-1", active.orElseThrow().id());
            assertEquals(projectId, active.orElseThrow().projectId());

            assertFalse(pairings.findActiveByTokenHash("no-such-hash").isPresent());

            // revoke() soft-deletes; a second revoke of the same id is a no-op (already revoked).
            assertTrue(pairings.revoke("pairing-1", projectId, Instant.now()));
            assertFalse(pairings.revoke("pairing-1", projectId, Instant.now()));
            assertFalse(pairings.revoke("no-such-id", projectId, Instant.now()));

            // A revoked row is excluded from findActiveByTokenHash even though it hasn't expired.
            assertFalse(pairings.findActiveByTokenHash("hash-1").isPresent());

            List<?> forProject = pairings.listForProject(projectId);
            assertEquals(1, forProject.size());
        }
    }

    @Test
    void expiredRowsAreExcludedFromFindActiveButKeptInTheProjectList() {
        try (Database database = new Database(directory.resolve("expiry.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var pairings = new PluginPairingRepository(database);

            Instant past = Instant.now().minus(1, ChronoUnit.HOURS);
            pairings.insert("expired-1", projectId, "hash-expired", past.minusSeconds(10), past);

            assertFalse(pairings.findActiveByTokenHash("hash-expired").isPresent());
            List<?> forProject = pairings.listForProject(projectId);
            assertEquals(1, forProject.size());
        }
    }

    @Test
    void listForProjectOrdersNewestFirstAndCascadesWithTheProject() throws Exception {
        try (Database database = new Database(directory.resolve("cascade.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var pairings = new PluginPairingRepository(database);

            Instant now = Instant.now();
            pairings.insert("older", projectId, "hash-older", now.minusSeconds(120), now.plusSeconds(3600));
            pairings.insert("newer", projectId, "hash-newer", now.minusSeconds(10), now.plusSeconds(3600));

            List<creatorflow.workflow.PluginPairingRecord> forProject = pairings.listForProject(projectId);
            assertEquals(2, forProject.size());
            assertEquals("newer", forProject.get(0).id());
            assertEquals("older", forProject.get(1).id());

            try (var statement = database.connection().prepareStatement("DELETE FROM projects WHERE id = ?")) {
                statement.setLong(1, projectId);
                assertEquals(1, statement.executeUpdate());
            }
            assertTrue(pairings.listForProject(projectId).isEmpty());
        }
    }

    @Test
    void revokeIsScopedToTheOwningProjectAndLeavesAMismatchedPairingActive() throws Exception {
        try (Database database = new Database(directory.resolve("cross-project.db"))) {
            Path projectARoot = Files.createDirectory(directory.resolve("project-a"));
            Path projectBRoot = Files.createDirectory(directory.resolve("project-b"));
            long projectAId = new LocalProjectRepository(database).adopt(projectARoot).projectId();
            long projectBId = new LocalProjectRepository(database).adopt(projectBRoot).projectId();
            var pairings = new PluginPairingRepository(database);

            Instant issuedAt = Instant.now();
            Instant expiresAt = issuedAt.plusSeconds(3600);
            pairings.insert("pairing-a", projectAId, "hash-a", issuedAt, expiresAt);

            // Revoking with the wrong project id must not touch a pairing owned by another
            // project — the WHERE clause has to scope by project_id, not just id.
            assertFalse(pairings.revoke("pairing-a", projectBId, Instant.now()));
            assertTrue(pairings.findActiveByTokenHash("hash-a").isPresent());

            // The correct project id still revokes it.
            assertTrue(pairings.revoke("pairing-a", projectAId, Instant.now()));
            assertFalse(pairings.findActiveByTokenHash("hash-a").isPresent());
        }
    }

    @Test
    void rejectsBlankRequiredFields() {
        try (Database database = new Database(directory.resolve("reject.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var pairings = new PluginPairingRepository(database);
            Instant now = Instant.now();
            org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                    () -> pairings.insert(" ", projectId, "hash", now, now.plusSeconds(60)));
            org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                    () -> pairings.insert("id", projectId, " ", now, now.plusSeconds(60)));
            org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class,
                    () -> pairings.findActiveByTokenHash(" "));
        }
    }
}
