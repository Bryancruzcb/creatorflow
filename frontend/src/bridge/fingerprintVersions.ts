/**
 * Classifying a shared claim's fingerprint version against the one being looked up.
 *
 * This is done here, in the client, and deliberately not on the server. The store returns every
 * non-retracted row for a fingerprint, whatever version produced it; if it filtered by version
 * instead, rows recorded under a different one would silently vanish — and a person would see
 * "no one else has this" when what actually happened is "nobody with a comparable fingerprint".
 *
 * There is an honest limit worth stating rather than papering over: the version string is hashed
 * *inside* the canonical form, so a v2 claim for the same clip carries a completely different
 * 64-hex fingerprint and will never turn up in a v1 lookup at all. Cross-version invisibility is
 * inherent to fingerprint-keyed lookup, not something this function fixes. What it does fix is the
 * case that IS reachable — a row whose version this build cannot vouch for must be shown and
 * labelled, never counted as a match and never quietly dropped.
 */

/**
 * The one fingerprint format this build actually computes, from
 * `MotionComparisonEngine.fingerprint`.
 */
export const CURRENT_FINGERPRINT_VERSION = 'creatorflow.motion-fingerprint/v1';

/**
 * A CreatorFlow motion fingerprint of *some* revision.
 *
 * Recognition is by family, not by an allowlist of versions. An allowlist would make every future
 * revision read "unknown fingerprint format", which is both wrong and unhelpful: a
 * `creatorflow.motion-fingerprint/v2` row is a CreatorFlow fingerprint this build cannot compare
 * against, and saying exactly that is more use than pretending not to know what it is.
 */
const RECOGNIZED_FAMILY = /^creatorflow\.motion-fingerprint\/v\d+$/;

export type ClaimVersionMatch =
  /** Same fingerprint version as the lookup: this row is genuinely comparable. */
  | 'MATCH'
  /** A CreatorFlow fingerprint of another revision — recorded, but not comparable. */
  | 'DIFFERENT_VERSION'
  /** Not a fingerprint format this build knows at all. Shown, never matched. */
  | 'UNKNOWN_VERSION';

/**
 * @param claimVersion  the `algorithmVersion` the store returned on the row
 * @param lookupVersion the version of the fingerprint being looked up, or `null` when this build
 *                      does not know its own — in which case nothing can be called a match, because
 *                      "same version" is not a claim we are in a position to make
 */
export function classifyClaimVersion(
  claimVersion: string | null | undefined,
  lookupVersion: string | null | undefined,
): ClaimVersionMatch {
  const claim = (claimVersion ?? '').trim();
  const lookup = (lookupVersion ?? '').trim();
  if (claim.length === 0) return 'UNKNOWN_VERSION';
  if (lookup.length > 0 && claim === lookup) return 'MATCH';
  return RECOGNIZED_FAMILY.test(claim) ? 'DIFFERENT_VERSION' : 'UNKNOWN_VERSION';
}

/** The sentence shown on a row that is not a match. `null` for a match — it needs no caveat. */
export function claimVersionCaveat(match: ClaimVersionMatch): string | null {
  switch (match) {
    case 'DIFFERENT_VERSION':
      return 'Recorded under a different fingerprint version — not comparable.';
    case 'UNKNOWN_VERSION':
      return 'Unknown fingerprint format — this build cannot tell whether it is comparable.';
    default:
      return null;
  }
}

/**
 * Rows in the order they are rendered: **by username**.
 *
 * Not by time. Usernames are unique, so the order is stable, and — the actual reason — an order
 * that tracked `recordedAt` would read as a ranking, with the top row looking like whoever "got
 * there first". This store records who ran CreatorFlow, not who authored anything, and its
 * ordering must not imply otherwise.
 */
export function sortClaimsForDisplay<T extends { memberUsername: string; id: number }>(claims: readonly T[]): T[] {
  return [...claims].sort((a, b) => {
    const byName = a.memberUsername.localeCompare(b.memberUsername, 'en', { sensitivity: 'base' });
    return byName !== 0 ? byName : a.id - b.id;
  });
}
