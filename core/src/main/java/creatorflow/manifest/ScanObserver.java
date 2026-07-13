package creatorflow.manifest;

/** Receives ordered progress events from a project scan. */
@FunctionalInterface
public interface ScanObserver {

    void onEvent(ScanEvent event);

    static ScanObserver noop() {
        return ignored -> { };
    }
}
