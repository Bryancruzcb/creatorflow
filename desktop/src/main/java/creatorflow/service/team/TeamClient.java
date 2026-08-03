package creatorflow.service.team;

import java.time.Instant;
import java.util.List;

/**
 * The desktop's optional connection to a self-hosted team provenance store.
 *
 * <p>Only fingerprints and what a person chose to declare ever travel — never curves, files, or
 * scan paths. All outbound team traffic originates in this JVM, exactly as {@code OpenCloudClient}
 * is the sole Roblox call site: the React workspace talks only to {@code LocalBridgeServer} on
 * 127.0.0.1.
 *
 * <p><strong>Nothing here caches.</strong> There is no local mirror of a teammate's claim, by
 * design — a stale copy of someone else's record is precisely the false-accusation vector this
 * phase must not create. Offline therefore renders as unknown, never as "nobody else has this",
 * which is why every method returns a {@link TeamStatus} instead of throwing or returning a bare
 * empty list.
 */
public interface TeamClient {

    /**
     * One member's recorded observation, as this machine received it.
     *
     * <p>Note what is absent and stays absent: no verdict, score, distance or rank. The
     * {@code algorithmVersion} is carried through untouched so the UI — not the server, and not
     * this client — can classify a row as a match, as "recorded under a different fingerprint
     * version", or as an unknown format.
     *
     * <p>{@code canRetract} is the server's own answer to "may this viewer pull the kill switch on
     * this row" — author or team OWNER. It is carried rather than re-derived so the button a
     * person sees and the rule the server enforces cannot drift apart.
     */
    record ClaimRecord(long id, String memberUsername, boolean isYours, boolean canRetract,
                       String algorithmVersion, String clipName, double durationSeconds,
                       Long robloxAssetId, String ownershipContext, String declaredSource,
                       String declaredLicense, String declaredNote, Instant observedAt,
                       Instant recordedAt) {
    }

    /** The lookup's answer. {@code claims} is meaningful only when {@code status} is {@code OK}. */
    record LookupResult(TeamStatus status, List<ClaimRecord> claims, String message) {

        public static LookupResult of(TeamStatus status, String message) {
            return new LookupResult(status, List.of(), message);
        }
    }

    /**
     * Exactly what a share puts on the wire.
     *
     * <p>{@code fingerprint}, {@code algorithmVersion}, {@code clipName} and
     * {@code durationSeconds} are read by the desktop from its own {@code motion_snapshots} row —
     * never from the browser's request — so the frontend cannot publish a fingerprint the desktop
     * did not compute. The remaining fields are DECLARED text a person typed, passed through
     * verbatim.
     */
    record ShareRequest(String fingerprint, String algorithmVersion, String clipName,
                        double durationSeconds, Long robloxAssetId, String ownershipContext,
                        String declaredSource, String declaredLicense, String declaredNote,
                        Instant observedAt) {
    }

    /**
     * @param alreadyShared      an identical live claim already existed, so nothing was created
     * @param declarationsDiffer this request's declared fields differ from the stored claim's. The
     *                           copy for it is "already shared — retract to change": an
     *                           append-only row is never quietly overwritten
     */
    record ShareResult(TeamStatus status, ClaimRecord claim, boolean alreadyShared,
                       boolean declarationsDiffer, String message) {

        public static ShareResult of(TeamStatus status, String message) {
            return new ShareResult(status, null, false, false, message);
        }
    }

    /** Retract's answer. The claim is returned as its tombstone, for confirmation copy only. */
    record RetractResult(TeamStatus status, ClaimRecord claim, String message) {

        public static RetractResult of(TeamStatus status, String message) {
            return new RetractResult(status, null, message);
        }
    }

    /** Live facts about the configured team. {@code memberCount} is null when nothing was reached. */
    record TeamDescription(TeamStatus status, Integer memberCount, String message) {
    }

    /** A base URL, an API key, and a selected team. Anything less and lookups cannot run. */
    boolean isConfigured();

    /** Live member count for the configured team, or a status explaining why there isn't one. */
    TeamDescription describe();

    /**
     * Every non-retracted claim in the configured team for this exact fingerprint.
     *
     * <p>Fingerprint only. The caller's own algorithm version is deliberately not sent: filtering
     * server-side would hide rows recorded under a different fingerprint version, and those are
     * exactly the rows a person needs shown and labelled rather than silently dropped.
     *
     * <p>Never throws for network reasons and never returns an empty list to mean failure.
     */
    LookupResult lookup(String fingerprint);

    ShareResult share(ShareRequest request);

    /** Removes a claim from every future lookup. Not a recall — no server can retrieve a copy someone read. */
    RetractResult retract(long claimId, String reason);

    /**
     * The no-op client for a machine that has configured nothing. Every call answers
     * {@link TeamStatus#NOT_CONFIGURED} — never an empty success, which the UI would be entitled
     * to render as "nobody has this".
     */
    static TeamClient disabled() {
        return new TeamClient() {
            private static final String MESSAGE = "No team provenance store is configured.";

            @Override
            public boolean isConfigured() {
                return false;
            }

            @Override
            public TeamDescription describe() {
                return new TeamDescription(TeamStatus.NOT_CONFIGURED, null, MESSAGE);
            }

            @Override
            public LookupResult lookup(String fingerprint) {
                return LookupResult.of(TeamStatus.NOT_CONFIGURED, MESSAGE);
            }

            @Override
            public ShareResult share(ShareRequest request) {
                return ShareResult.of(TeamStatus.NOT_CONFIGURED, MESSAGE);
            }

            @Override
            public RetractResult retract(long claimId, String reason) {
                return RetractResult.of(TeamStatus.NOT_CONFIGURED, MESSAGE);
            }
        };
    }
}
