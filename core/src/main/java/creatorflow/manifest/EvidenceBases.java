package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import creatorflow.manifest.CreativeManifest.AssetEntry;
import creatorflow.manifest.CreativeManifest.ReleaseDecision;
import java.util.Objects;

/**
 * Per-facet evidence provenance for one manifest asset: whether CreatorFlow computed a fact
 * itself ({@link EvidenceBasis#VERIFIED}), a person typed it ({@link EvidenceBasis#DECLARED}), or
 * it is a condition the tool cannot check ({@link EvidenceBasis#NOT_VERIFIED}).
 *
 * <p>This is the single reusable classifier for the tri-state: the desktop module's release export
 * path (via {@link #of(AssetEntry)}) and the frontend's client-side classifier must both agree
 * with the rules implemented here.
 *
 * <p><strong>Rules:</strong>
 * <ul>
 *   <li>{@code verification} is always {@code VERIFIED} — {@link creatorflow.model.VerificationStatus}
 *       (CLEAR/SIMILAR/DUPLICATE) is always a fingerprint match CreatorFlow computed itself.</li>
 *   <li>{@code source} is {@code DECLARED} when {@link CreativeManifest.SourceEvidence#resolved()},
 *       otherwise {@code NOT_VERIFIED} — an unresolved source is unknown, not merely "pending".</li>
 *   <li>{@code decision} is {@code DECLARED} once a human decision is present (any value other than
 *       the {@code PENDING} default), otherwise {@code null} (absent) — a decision is a human act,
 *       never inferred, so "no decision yet" is represented as absence rather than a basis.</li>
 *   <li>{@code ownership} is always {@code NOT_VERIFIED} — nothing in CreatorFlow calls a Roblox
 *       ownership or permission API. This must be shown explicitly, never omitted.</li>
 * </ul>
 */
@JsonPropertyOrder({"verification", "source", "ownership", "decision"})
public record EvidenceBases(
        EvidenceBasis verification,
        EvidenceBasis source,
        @JsonInclude(JsonInclude.Include.NON_NULL) EvidenceBasis decision,
        EvidenceBasis ownership) {

    /** Ownership is a constant this increment: no code calls a Roblox ownership/permission API. */
    public static final EvidenceBasis OWNERSHIP = EvidenceBasis.NOT_VERIFIED;

    public EvidenceBases {
        Objects.requireNonNull(verification, "verification");
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(ownership, "ownership");
    }

    /**
     * Derives the tri-state basis for each evidence facet of one asset. Pure — no clock, no
     * randomness, no I/O — so it never affects manifest determinism.
     */
    public static EvidenceBases of(AssetEntry asset) {
        Objects.requireNonNull(asset, "asset");
        EvidenceBasis source = asset.source().resolved() ? EvidenceBasis.DECLARED : EvidenceBasis.NOT_VERIFIED;
        EvidenceBasis decision = asset.decision() == ReleaseDecision.PENDING ? null : EvidenceBasis.DECLARED;
        return new EvidenceBases(EvidenceBasis.VERIFIED, source, decision, OWNERSHIP);
    }
}
