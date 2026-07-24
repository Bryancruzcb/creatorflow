package creatorflow.manifest;

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
 * <p>This is a pure value type — no I/O happens here or anywhere in {@code core}. Populating an
 * instance from a live Roblox call is the desktop module's job.
 *
 * @param robloxAssetId the animation asset id that was checked; {@code null} if nothing was checked
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
public record OwnershipEvidence(
        Long robloxAssetId,
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
