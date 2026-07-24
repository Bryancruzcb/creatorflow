package creatorflow.workflow;

import creatorflow.ownership.OwnershipOutcome;
import java.time.Instant;

/**
 * A persisted row from the insert-only {@code ownership_verifications} ledger: one point-in-time
 * Open Cloud ownership observation for an immutable scan asset. Carries the raw facts (creator and
 * experience-owner identities, the group-membership rank when that path applied, moderation state)
 * next to the computed {@link OwnershipOutcome}, plus the raw response JSON and the {@code checkedAt}
 * stamp so downstream reads facts rather than re-deriving them.
 *
 * <p><strong>Honesty:</strong> {@code outcome == MATCH || outcome == MISMATCH} means authoritative
 * facts were obtained (the basis for {@code VERIFIED}); it never means "you have rights to this
 * asset". A {@code MISMATCH} is a review lead, not an accusation. {@code checkedAt} is surfaced so a
 * verification's staleness is visible — a check is an observation, not a standing guarantee.
 *
 * @param id the ledger row id (a UUID)
 * @param scanAssetId the immutable scan asset this verification is about
 * @param robloxAssetId the animation asset id that was checked against Roblox
 * @param universeId the bound experience's universe id the creator was checked against
 * @param creatorType {@code "USER"} | {@code "GROUP"} | {@code null}
 * @param creatorId the asset creator's id; {@code null} if it could not be obtained
 * @param assetType the raw Roblox {@code assetType} string (e.g. {@code "Animation"})
 * @param moderationState the raw Roblox moderation state (e.g. {@code "Approved"})
 * @param ownerType the experience owner's identity kind; {@code null} if unknown
 * @param ownerId the experience owner's id; {@code null} if unknown
 * @param memberRank the creator-user's rank in the owning group, when that path applied; else {@code null}
 * @param outcome the computed {@link OwnershipOutcome}
 * @param rawResponseJson the raw upstream response(s) captured for audit; may be {@code null}
 * @param checkedAt when this verification was performed
 */
public record OwnershipVerificationRecord(
        String id,
        long scanAssetId,
        long robloxAssetId,
        long universeId,
        String creatorType,
        Long creatorId,
        String assetType,
        String moderationState,
        String ownerType,
        Long ownerId,
        Integer memberRank,
        OwnershipOutcome outcome,
        String rawResponseJson,
        Instant checkedAt) {

    /** {@code true} when authoritative facts were obtained (outcome {@code MATCH} or {@code MISMATCH}). */
    public boolean verified() {
        return outcome == OwnershipOutcome.MATCH || outcome == OwnershipOutcome.MISMATCH;
    }
}
