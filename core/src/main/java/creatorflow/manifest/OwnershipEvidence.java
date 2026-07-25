package creatorflow.manifest;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import creatorflow.ownership.OwnershipOutcome;
import java.time.Instant;

/**
 * The immutable, raw-facts result of one Open Cloud ownership verification for an animation
 * asset: who created it, who owns the target experience, and (when relevant) whether the
 * creator is a member of the owning group.
 *
 * <p>This type stores <em>facts</em>, not just a boolean — {@link #creatorId()},
 * {@link #ownerId()}, and {@link #memberRank()} are kept even when {@link #outcome()} is
 * {@link OwnershipOutcome#MATCH} or {@link OwnershipOutcome#MISMATCH}, so a later policy change
 * (e.g. tightening the group-rank rule) does not require re-verification against Roblox.
 *
 * <p><strong>Honesty constraint (load-bearing):</strong> {@link #verified()} means CreatorFlow
 * obtained authoritative facts from Roblox's API — it is true for both {@code MATCH} and
 * {@code MISMATCH}. It does <em>not</em> mean "you have the right to use this asset"; a
 * {@code MISMATCH} is a review lead for a human, never an accusation or an auto-block.
 *
 * <p><strong>Honesty constraint #2 (load-bearing):</strong> nothing in a scanned file ties it to a
 * Roblox asset id — a person types the id in before a check runs. So the ownership <em>facts</em>
 * below are CreatorFlow's own (VERIFIED), while the <em>linkage</em> between the scanned file and
 * {@link #robloxAssetId()} is a human assertion. {@link #assetIdSource()} records that provenance
 * explicitly ({@link #ASSET_ID_DECLARED_BY_USER}) so no reader can mistake "we checked who owns
 * animation 507766388" for "we verified this file is animation 507766388, and you own it".
 * {@link EvidenceBases#ownershipLinkBasis(OwnershipEvidence)} maps it to the shared tri-state.
 *
 * <p>This is a pure value type — no I/O happens here or anywhere in {@code core}. Populating an
 * instance from a live Roblox call is the desktop module's job.
 *
 * @param robloxAssetId the animation asset id that was checked; {@code null} if nothing was checked
 * @param assetIdSource where {@code robloxAssetId} came from — {@link #ASSET_ID_DECLARED_BY_USER}
 *     for every id this build can produce. {@code null} means the provenance is unknown: either
 *     nothing was checked, or the evidence was read from a manifest exported before this field
 *     existed. Unknown stays unknown; it is never back-filled into a claim we did not record.
 * @param creatorType the asset creator's identity kind, {@link #TYPE_USER} or {@link #TYPE_GROUP};
 *     {@code null} if unknown
 * @param creatorId the asset creator's id; {@code null} if unknown
 * @param assetType the raw Roblox {@code assetType} string (e.g. {@code "Animation"})
 * @param moderationState the raw Roblox moderation state (e.g. {@code "Approved"})
 * @param ownerType the experience owner's identity kind, {@link #TYPE_USER} or
 *     {@link #TYPE_GROUP}; {@code null} if unknown
 * @param ownerId the experience owner's id; {@code null} if unknown
 * @param memberRank the creator-user's numeric rank in the owning group, when the
 *     user-creator/group-owner membership path applied; {@code null} otherwise (including when
 *     the creator is not a member)
 * @param outcome the computed {@link OwnershipOutcome}
 * @param checkedAt when this verification was performed; {@code null} for {@link #unchecked()}
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonPropertyOrder({"robloxAssetId", "assetIdSource", "creatorType", "creatorId", "assetType",
        "moderationState", "ownerType", "ownerId", "memberRank", "outcome", "checkedAt"})
public record OwnershipEvidence(
        Long robloxAssetId,
        String assetIdSource,
        String creatorType,
        Long creatorId,
        String assetType,
        String moderationState,
        String ownerType,
        Long ownerId,
        Integer memberRank,
        OwnershipOutcome outcome,
        Instant checkedAt) {

    /** The asset-creator/experience-owner identity kind: an individual Roblox user. */
    public static final String TYPE_USER = OwnershipOutcome.TYPE_USER;

    /** The asset-creator/experience-owner identity kind: a Roblox group. */
    public static final String TYPE_GROUP = OwnershipOutcome.TYPE_GROUP;

    /**
     * The only {@link #assetIdSource()} CreatorFlow can currently produce: a person typed the
     * animation id in. CreatorFlow cannot derive a Roblox asset id from a scanned file, so every
     * file-to-animation linkage it holds is a human declaration. A future path that obtains an id
     * without a human (say, a Studio plugin reading it out of a place file) must add its own
     * constant and use the canonical constructor — it must not reuse this one.
     */
    public static final String ASSET_ID_DECLARED_BY_USER = "DECLARED_BY_USER";

    /**
     * Rejects a linkage provenance this build does not understand. Mirrors the manifest schema's
     * closed {@code ownershipAssetIdSource} enum: a manifest may say the id was declared by a person,
     * or say nothing at all (unknown), but it may never assert some other — possibly stronger —
     * provenance that no code here can honor.
     */
    public OwnershipEvidence {
        if (assetIdSource != null && !ASSET_ID_DECLARED_BY_USER.equals(assetIdSource)) {
            throw new IllegalArgumentException("Unknown ownership assetIdSource: " + assetIdSource);
        }
    }

    /**
     * Convenience constructor for the only linkage this build can create: an id a person declared.
     * Fills {@link #assetIdSource()} with {@link #ASSET_ID_DECLARED_BY_USER} when an id was checked,
     * and leaves it {@code null} when none was (nothing checked means nothing declared). Use the
     * canonical constructor to preserve an unknown provenance — e.g. when deserializing evidence
     * written before this field existed.
     */
    public OwnershipEvidence(Long robloxAssetId, String creatorType, Long creatorId, String assetType,
            String moderationState, String ownerType, Long ownerId, Integer memberRank,
            OwnershipOutcome outcome, Instant checkedAt) {
        this(robloxAssetId, robloxAssetId == null ? null : ASSET_ID_DECLARED_BY_USER, creatorType,
                creatorId, assetType, moderationState, ownerType, ownerId, memberRank, outcome, checkedAt);
    }

    /** The evidence for an asset that has never been checked: all facts absent, outcome UNVERIFIABLE. */
    public static OwnershipEvidence unchecked() {
        return new OwnershipEvidence(null, null, null, null, null, null, null, null,
                OwnershipOutcome.UNVERIFIABLE, null);
    }

    /**
     * {@code true} when CreatorFlow obtained authoritative facts from Roblox — i.e. the outcome is
     * {@link OwnershipOutcome#MATCH} or {@link OwnershipOutcome#MISMATCH}. This drives the
     * {@code VERIFIED} evidence basis; it does NOT mean "you have rights to this asset".
     */
    public boolean verified() {
        return outcome == OwnershipOutcome.MATCH || outcome == OwnershipOutcome.MISMATCH;
    }
}
