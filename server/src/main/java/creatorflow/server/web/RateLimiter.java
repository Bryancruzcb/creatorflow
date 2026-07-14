package creatorflow.server.web;

import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * A small dependency-free per-key token-bucket limiter. Each key (a client IP) gets a bucket that
 * refills at a steady rate up to a capacity; a request costs one token. This smooths out bursts
 * and caps sustained request rate so a single client cannot flood the server. The clock is
 * injectable so the refill logic is deterministically testable.
 */
public final class RateLimiter {

    private final int capacity;
    private final double refillPerSecond;
    private final long staleAfterNanos;
    private final LongSupplier clockNanos;
    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimiter(int capacity, double refillPerSecond) {
        this(capacity, refillPerSecond, System::nanoTime);
    }

    RateLimiter(int capacity, double refillPerSecond, LongSupplier clockNanos) {
        if (capacity <= 0 || refillPerSecond <= 0) {
            throw new IllegalArgumentException("capacity and refill rate must be positive");
        }
        this.capacity = capacity;
        this.refillPerSecond = refillPerSecond;
        this.staleAfterNanos = (long) (capacity / refillPerSecond * 1_000_000_000L) + 60_000_000_000L;
        this.clockNanos = clockNanos;
    }

    /** Returns true if a token was available (request allowed), false if the client is over its rate. */
    public boolean tryAcquire(String key) {
        long now = clockNanos.getAsLong();
        Bucket bucket = buckets.computeIfAbsent(key, ignored -> new Bucket(capacity, now));
        synchronized (bucket) {
            double elapsedSeconds = Math.max(0, now - bucket.lastRefillNanos) / 1_000_000_000.0;
            bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
            bucket.lastRefillNanos = now;
            if (bucket.tokens >= 1.0) {
                bucket.tokens -= 1.0;
                return true;
            }
            return false;
        }
    }

    /** Drops buckets that have been idle long enough to have fully refilled, bounding memory. */
    public void pruneStale() {
        long now = clockNanos.getAsLong();
        buckets.entrySet().removeIf(entry -> {
            synchronized (entry.getValue()) {
                return now - entry.getValue().lastRefillNanos > staleAfterNanos;
            }
        });
    }

    int trackedKeys() {
        return buckets.size();
    }

    private static final class Bucket {
        private double tokens;
        private long lastRefillNanos;

        private Bucket(int initialTokens, long now) {
            this.tokens = initialTokens;
            this.lastRefillNanos = now;
        }
    }
}
