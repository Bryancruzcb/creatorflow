package creatorflow.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class PluginPairingServiceTest {

    @Test
    void tokensAreProjectScopedUniqueAndRevocable() {
        var service = new PluginPairingService(Duration.ofMinutes(10));
        var first = service.issue(12);
        var second = service.issue(12);

        assertNotEquals(first.token(), second.token());
        assertEquals(12, service.authenticate(first.token()).orElseThrow().projectId());
        assertFalse(service.authenticate("wrong").isPresent());
        service.revoke(first.token());
        assertFalse(service.authenticate(first.token()).isPresent());
        assertTrue(service.authenticate(second.token()).isPresent());
        assertThrows(IllegalArgumentException.class, () -> service.issue(0));
    }

    @Test
    void expiredPairingIsRejected() throws Exception {
        var service = new PluginPairingService(Duration.ofMillis(1));
        var pairing = service.issue(7);
        Thread.sleep(5);
        assertFalse(service.authenticate(pairing.token()).isPresent());
    }
}
