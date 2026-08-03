package creatorflow.bridge;

import creatorflow.service.team.TeamClient;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A {@link TeamClient} that forwards to whatever the current test installed, mirroring the
 * {@code fakeVerifier} seam already used for Open Cloud.
 *
 * <p>{@link LocalBridgeServer} takes its team client once, at construction, but a test needs to
 * change the answer per case — and no test in this package may open a socket to a real provenance
 * store. This closes both gaps with one object.
 */
final class DelegatingTeamClient implements TeamClient {

    private final AtomicReference<TeamClient> delegate;

    DelegatingTeamClient(AtomicReference<TeamClient> delegate) {
        this.delegate = delegate;
    }

    private TeamClient current() {
        TeamClient client = delegate.get();
        if (client == null) throw new IllegalStateException("no fake TeamClient installed for this test");
        return client;
    }

    @Override
    public boolean isConfigured() {
        return current().isConfigured();
    }

    @Override
    public TeamDescription describe() {
        return current().describe();
    }

    @Override
    public LookupResult lookup(String fingerprint) {
        return current().lookup(fingerprint);
    }

    @Override
    public ShareResult share(ShareRequest request) {
        return current().share(request);
    }

    @Override
    public RetractResult retract(long claimId, String reason) {
        return current().retract(claimId, reason);
    }
}
