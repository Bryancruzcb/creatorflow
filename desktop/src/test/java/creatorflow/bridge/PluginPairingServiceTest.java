package creatorflow.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import creatorflow.db.Database;
import creatorflow.db.LocalProjectRepository;
import creatorflow.db.PluginPairingRepository;
import creatorflow.verification.Sha256;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PluginPairingServiceTest {

    @TempDir
    Path directory;

    @Test
    void tokensAreProjectScopedUniqueAndRevocableById() throws Exception {
        try (Database database = new Database(directory.resolve("service.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var service = new PluginPairingService(new PluginPairingRepository(database), Duration.ofMinutes(10));

            var first = service.issue(projectId);
            var second = service.issue(projectId);

            assertNotEquals(first.token(), second.token());
            assertNotEquals(first.id(), second.id());
            assertEquals(projectId, service.authenticate(first.token()).orElseThrow().projectId());
            assertFalse(service.authenticate("wrong").isPresent());
            assertFalse(service.authenticate(null).isPresent());
            assertFalse(service.authenticate("  ").isPresent());

            assertTrue(service.revoke(first.id(), projectId));
            assertFalse(service.authenticate(first.token()).isPresent());
            assertTrue(service.authenticate(second.token()).isPresent());

            // Revoking again, or an unknown id, is a no-op rather than an error.
            assertFalse(service.revoke(first.id(), projectId));
            assertFalse(service.revoke("no-such-pairing", projectId));

            assertThrows(IllegalArgumentException.class, () -> service.issue(0));
        }
    }

    @Test
    void expiredPairingIsRejected() throws Exception {
        try (Database database = new Database(directory.resolve("expiry.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var service = new PluginPairingService(new PluginPairingRepository(database), Duration.ofMillis(1));

            var pairing = service.issue(projectId);
            Thread.sleep(25);
            assertFalse(service.authenticate(pairing.token()).isPresent());
        }
    }

    @Test
    void listReportsActiveExpiredAndRevokedStatusWithoutTokenOrHash() throws Exception {
        try (Database database = new Database(directory.resolve("list.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var longLived = new PluginPairingService(new PluginPairingRepository(database), Duration.ofMinutes(10));
            var shortLived = new PluginPairingService(new PluginPairingRepository(database), Duration.ofMillis(1));

            var active = longLived.issue(projectId);
            var toRevoke = longLived.issue(projectId);
            var expiring = shortLived.issue(projectId);
            Thread.sleep(25);

            longLived.revoke(toRevoke.id(), projectId);

            var views = longLived.list(projectId);
            assertEquals(3, views.size());
            var byId = views.stream().collect(java.util.stream.Collectors.toMap(
                    PluginPairingService.PairingView::id, view -> view));
            assertEquals(PluginPairingService.PairingStatus.ACTIVE, byId.get(active.id()).status());
            assertEquals(PluginPairingService.PairingStatus.REVOKED, byId.get(toRevoke.id()).status());
            assertEquals(PluginPairingService.PairingStatus.EXPIRED, byId.get(expiring.id()).status());
        }
    }

    @Test
    void revokeWithAMismatchedProjectIdFailsAndLeavesThePairingActive() throws Exception {
        try (Database database = new Database(directory.resolve("cross-project-service.db"))) {
            Path projectARoot = Files.createDirectory(directory.resolve("project-a"));
            Path projectBRoot = Files.createDirectory(directory.resolve("project-b"));
            long projectAId = new LocalProjectRepository(database).adopt(projectARoot).projectId();
            long projectBId = new LocalProjectRepository(database).adopt(projectBRoot).projectId();
            var service = new PluginPairingService(new PluginPairingRepository(database), Duration.ofMinutes(10));

            var pairing = service.issue(projectAId);

            // Revoking under the wrong project must fail and leave the pairing usable — the
            // route-layer belongsToProject check is not the only thing standing between a
            // cross-project request and a live pairing.
            assertFalse(service.revoke(pairing.id(), projectBId));
            assertTrue(service.authenticate(pairing.token()).isPresent());

            assertTrue(service.revoke(pairing.id(), projectAId));
            assertFalse(service.authenticate(pairing.token()).isPresent());
        }
    }

    @Test
    void aValidPairingStillAuthenticatesAfterASimulatedDesktopRestart() throws Exception {
        Path file = directory.resolve("restart.db");
        long projectId;
        String token;
        try (Database database = new Database(file)) {
            projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var service = new PluginPairingService(new PluginPairingRepository(database), Duration.ofHours(8));
            token = service.issue(projectId).token();
            assertTrue(service.authenticate(token).isPresent());
        }

        // A brand-new service and repository over the same on-disk database (no shared in-memory
        // state) is exactly what a desktop relaunch looks like.
        try (Database reopened = new Database(file)) {
            var restartedService = new PluginPairingService(
                    new PluginPairingRepository(reopened), Duration.ofHours(8));
            var authenticated = restartedService.authenticate(token);
            assertTrue(authenticated.isPresent());
            assertEquals(projectId, authenticated.orElseThrow().projectId());
        }
    }

    @Test
    void theRawTokenIsNeverPersistedOnlyItsSha256HashIsStoredAtRest() throws Exception {
        try (Database database = new Database(directory.resolve("hash-at-rest.db"))) {
            long projectId = new LocalProjectRepository(database).adopt(directory).projectId();
            var service = new PluginPairingService(new PluginPairingRepository(database), Duration.ofHours(8));

            var issued = service.issue(projectId);
            String storedHash;
            try (PreparedStatement statement = database.connection().prepareStatement(
                    "SELECT token_hash FROM plugin_pairings WHERE id = ?")) {
                statement.setString(1, issued.id());
                try (ResultSet result = statement.executeQuery()) {
                    assertTrue(result.next());
                    storedHash = result.getString("token_hash");
                }
            }
            assertNotNull(storedHash);
            assertNotEquals(issued.token(), storedHash);
            assertEquals(Sha256.hash(issued.token().getBytes(StandardCharsets.UTF_8)), storedHash);

            // The raw token also never appears anywhere else in the table (belt-and-suspenders:
            // guards against a future column accidentally carrying it).
            try (PreparedStatement statement = database.connection().prepareStatement(
                    "SELECT * FROM plugin_pairings WHERE id = ?")) {
                statement.setString(1, issued.id());
                try (ResultSet result = statement.executeQuery()) {
                    assertTrue(result.next());
                    int columns = result.getMetaData().getColumnCount();
                    for (int i = 1; i <= columns; i++) {
                        Object value = result.getObject(i);
                        if (value != null) {
                            assertNotEquals(issued.token(), value.toString(),
                                    "raw token must not appear in column " + result.getMetaData().getColumnName(i));
                        }
                    }
                }
            }
        }
    }
}
