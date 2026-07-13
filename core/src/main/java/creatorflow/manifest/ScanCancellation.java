package creatorflow.manifest;

import java.util.concurrent.atomic.AtomicBoolean;

/** Thread-safe cooperative cancellation signal for a running scan. */
public final class ScanCancellation {

    private final AtomicBoolean cancelled = new AtomicBoolean();

    public void cancel() {
        cancelled.set(true);
    }

    public boolean isCancelled() {
        return cancelled.get();
    }
}
