package creatorflow.server.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class RateLimiterTest {

    @Test
    void allowsBurstToCapacityThenBlocksUntilRefill() {
        AtomicLong clock = new AtomicLong(0);
        // capacity 3, refills 1 token/second.
        RateLimiter limiter = new RateLimiter(3, 1.0, clock::get);

        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertFalse(limiter.tryAcquire("1.2.3.4"), "4th request in the same instant is over the burst");

        clock.addAndGet(1_000_000_000L); // +1 second → one token refilled
        assertTrue(limiter.tryAcquire("1.2.3.4"));
        assertFalse(limiter.tryAcquire("1.2.3.4"));
    }

    @Test
    void keepsClientsIndependent() {
        AtomicLong clock = new AtomicLong(0);
        RateLimiter limiter = new RateLimiter(1, 1.0, clock::get);

        assertTrue(limiter.tryAcquire("a"));
        assertFalse(limiter.tryAcquire("a"));
        assertTrue(limiter.tryAcquire("b"), "a different client has its own bucket");
    }

    @Test
    void prunesIdleBuckets() {
        AtomicLong clock = new AtomicLong(0);
        RateLimiter limiter = new RateLimiter(2, 1.0, clock::get);
        limiter.tryAcquire("gone");
        clock.addAndGet(3_600_000_000_000L); // an hour later
        limiter.pruneStale();
        assertEquals(0, limiter.trackedKeys());
    }
}
