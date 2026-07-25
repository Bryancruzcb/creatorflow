package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import creatorflow.model.VerificationStatus;
import creatorflow.ownership.OwnershipOutcome;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Deterministic default release policy for a validated CreatorFlow manifest. */
public final class ReleaseGate {

    public static final String REPORT_SCHEMA = "creatorflow.gate-report/v0.1";

    private final Clock clock;

    public ReleaseGate() {
        this(Clock.systemUTC());
    }

    ReleaseGate(Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public Report evaluate(CreativeManifest manifest) {
        Objects.requireNonNull(manifest, "manifest");
        List<Violation> violations = new ArrayList<>();
        int blocked = 0;
        int unresolved = 0;
        int flaggedUnreviewed = 0;
        int ownershipMismatchUndecided = 0;

        for (AssetEntry asset : manifest.assets()) {
            if (asset.decision() == ReleaseDecision.BLOCKED) {
                blocked++;
                violations.add(violation(asset, Code.BLOCKED_DECISION,
                        "A BLOCKED decision always prevents release"));
                continue;
            }
            if (asset.decision() == ReleaseDecision.EXCLUDED) continue;

            if (!asset.source().resolved()) {
                unresolved++;
                violations.add(violation(asset, Code.UNRESOLVED_SOURCE,
                        "Source and license evidence must be resolved or the asset excluded"));
            }

            boolean flagged = asset.verification() == VerificationStatus.SIMILAR
                    || asset.verification() == VerificationStatus.DUPLICATE;
            if (flagged && asset.decision() != ReleaseDecision.APPROVED) {
                flaggedUnreviewed++;
                violations.add(violation(asset, Code.FLAGGED_WITHOUT_APPROVAL,
                        "SIMILAR and DUPLICATE assets require APPROVED or EXCLUDED"));
            }

            // Ownership mismatch is a REVIEW LEAD, mirroring FLAGGED_WITHOUT_APPROVAL: it blocks only
            // while no human decision has been recorded (PENDING). A MATCH never blocks, and an
            // UNVERIFIABLE never blocks — absence of proof is not proof. Any human decision resolves
            // it: APPROVED/EXCLUDED clear it here (EXCLUDED already skipped above; BLOCKED already
            // handled above), never the Open Cloud result itself. The message stays a lead, not an
            // accusation of infringement.
            if (asset.ownership() != null
                    && asset.ownership().outcome() == OwnershipOutcome.MISMATCH
                    && asset.decision() == ReleaseDecision.PENDING) {
                ownershipMismatchUndecided++;
                violations.add(violation(asset, Code.OWNERSHIP_MISMATCH_WITHOUT_DECISION,
                        "The animation's creator is not the owner of the target experience and no "
                                + "decision has been recorded — confirm the team has rights to ship it."));
            }
        }

        Summary summary = new Summary(manifest.assets().size(), violations.size(), blocked,
                unresolved, flaggedUnreviewed, ownershipMismatchUndecided);
        return new Report(REPORT_SCHEMA, manifest.schema(), manifest.project(), Instant.now(clock),
                violations.isEmpty(), summary, violations);
    }

    private static Violation violation(AssetEntry asset, Code code, String message) {
        return new Violation(code, asset.path(), asset.verification(), asset.decision(), message);
    }

    public enum Code {
        BLOCKED_DECISION,
        UNRESOLVED_SOURCE,
        FLAGGED_WITHOUT_APPROVAL,
        OWNERSHIP_MISMATCH_WITHOUT_DECISION
    }

    @JsonPropertyOrder({"schema", "manifestSchema", "project", "evaluatedAt", "passed", "summary", "violations"})
    public record Report(
            String schema,
            String manifestSchema,
            CreativeManifest.Project project,
            Instant evaluatedAt,
            boolean passed,
            Summary summary,
            List<Violation> violations) {
        public Report {
            violations = List.copyOf(violations);
        }
    }

    public record Summary(
            int assets,
            int violations,
            int blockedAssets,
            int unresolvedAssets,
            int flaggedWithoutApproval,
            int ownershipMismatchWithoutDecision) {
    }

    public record Violation(
            Code code,
            String path,
            VerificationStatus verification,
            ReleaseDecision decision,
            String message) {
    }
}
