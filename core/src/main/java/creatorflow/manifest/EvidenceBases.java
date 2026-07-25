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
 *   <li>{@code ownership} is {@code VERIFIED} exactly when the asset carries an ownership evidence
 *       whose facts were obtained from Roblox's Open Cloud API — i.e. {@link OwnershipEvidence#verified()}
 *       is true (outcome {@code MATCH} or {@code MISMATCH}, both authoritative facts). It is
 *       {@code NOT_VERIFIED} when no verification exists or the verification was {@code UNVERIFIABLE}.
 *       {@code VERIFIED} here means "we obtained the facts", never "you have the right to use this".
 *       The frontend classifier ({@code evidenceBasis.ts}'s {@code ownershipBasis}) mirrors this rule.</li>
 * </ul>
 *
 * <p><strong>The ownership basis covers the facts, not the linkage.</strong> An ownership check runs
 * against an animation id a <em>person typed in</em>: nothing in a scanned file identifies a Roblox
 * asset. So {@code ownership == VERIFIED} says "we obtained these facts about that id", and
 * {@link #ownershipLinkBasis(OwnershipEvidence)} separately says "a human asserted this file is that
 * animation" ({@code DECLARED}). The two must never be collapsed: a verified ownership fact about a
 * declared id is not a verified statement about the file.
 */
@JsonPropertyOrder({"verification", "source", "ownership", "decision"})
public record EvidenceBases(
        EvidenceBasis verification,
        EvidenceBasis source,
        @JsonInclude(JsonInclude.Include.NON_NULL) EvidenceBasis decision,
        EvidenceBasis ownership) {

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
        return new EvidenceBases(EvidenceBasis.VERIFIED, source, decision, ownershipBasis(asset.ownership()));
    }

    /**
     * The ownership basis: {@code VERIFIED} only when a verification obtained authoritative facts
     * (a {@code MATCH} or {@code MISMATCH}), else {@code NOT_VERIFIED}. Mirrored verbatim by
     * {@code evidenceBasis.ts}'s {@code ownershipBasis} — the two classifiers must not diverge.
     */
    private static EvidenceBasis ownershipBasis(OwnershipEvidence ownership) {
        return ownership != null && ownership.verified() ? EvidenceBasis.VERIFIED : EvidenceBasis.NOT_VERIFIED;
    }

    /**
     * The basis for the <em>linkage</em> between a scanned file and the Roblox animation id its
     * ownership was checked against — a different question from {@link #ownership()}, which covers
     * the facts Roblox returned about that id.
     *
     * <p>{@code DECLARED} exactly when the evidence records
     * {@link OwnershipEvidence#ASSET_ID_DECLARED_BY_USER}: a person typed the id, and CreatorFlow
     * cannot check that the file really is that animation. Anything else — no evidence, nothing
     * checked, or a provenance this build does not recognize (including evidence exported before
     * the field existed) — is {@code NOT_VERIFIED}, an honest unknown. It is never {@code VERIFIED};
     * no code path can verify a file-to-animation linkage. Mirrored verbatim by
     * {@code evidenceBasis.ts}'s {@code ownershipLinkBasis} — a load-bearing cross-runtime invariant.
     */
    public static EvidenceBasis ownershipLinkBasis(OwnershipEvidence ownership) {
        return ownership != null
                && OwnershipEvidence.ASSET_ID_DECLARED_BY_USER.equals(ownership.assetIdSource())
                ? EvidenceBasis.DECLARED
                : EvidenceBasis.NOT_VERIFIED;
    }
}
