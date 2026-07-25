import type { LocalDecision, LocalSourceEvidence } from './localBridge';
import type { ManifestOwnershipOutcome } from '../manifest/manifest';

/**
 * The provenance basis for one piece of evidence, mirroring the core classifier
 * (`creatorflow.manifest.EvidenceBases`/`EvidenceBasis`) so the manifest export path and this UI
 * agree on the same rules.
 *
 * Honesty constraint (load-bearing): `VERIFIED` means CreatorFlow computed the value itself (e.g.
 * a fingerprint match, a motion score) — never "original", "owned", or "non-infringing".
 * `DECLARED` means a human typed it. `NOT_VERIFIED` means the tool did not/cannot check it — an
 * honest "unknown", never a negative verdict.
 */
export type EvidenceBasis = 'VERIFIED' | 'DECLARED' | 'NOT_VERIFIED';

export interface EvidenceBases {
  verification: EvidenceBasis;
  source: EvidenceBasis;
  /** Absent until a human records a decision — a decision is a human act, never inferred. */
  decision: EvidenceBasis | null;
  ownership: EvidenceBasis;
}

/**
 * The ownership basis when no verification is available (or its shape is not yet loaded): an honest
 * `NOT_VERIFIED`. A present verification is classified by {@link ownershipBasis} instead.
 */
export const OWNERSHIP_BASIS: EvidenceBasis = 'NOT_VERIFIED';

/** Fingerprint/verification outcomes (CLEAR/SIMILAR/DUPLICATE) are always tool-computed. */
export function verificationBasis(): EvidenceBasis {
  return 'VERIFIED';
}

/**
 * VERIFIED only when a verification obtained authoritative facts from Roblox — a `MATCH` or a
 * `MISMATCH` (both are obtained facts; a mismatch is a review lead, not an absence of proof).
 * `NOT_VERIFIED` when the verification was `UNVERIFIABLE` or none exists. Mirrors
 * `EvidenceBases.ownershipBasis(OwnershipEvidence)` on the core/export path exactly — the two
 * classifiers are a load-bearing invariant and must not diverge. VERIFIED here means "we obtained
 * the facts", never "you have the right to use this".
 */
export function ownershipBasis(
  ownership: { outcome: ManifestOwnershipOutcome } | null | undefined,
): EvidenceBasis {
  return ownership && (ownership.outcome === 'MATCH' || ownership.outcome === 'MISMATCH')
    ? 'VERIFIED'
    : 'NOT_VERIFIED';
}

/** DECLARED once a human has recorded both a source and a license; NOT_VERIFIED (unknown) otherwise. */
export function sourceBasis(sourceEvidence: Pick<LocalSourceEvidence, 'resolved'> | null | undefined): EvidenceBasis {
  return sourceEvidence?.resolved ? 'DECLARED' : 'NOT_VERIFIED';
}

/** DECLARED once a human decision is on record; absent (null) until then. */
export function decisionBasis(decision: Pick<LocalDecision, 'type'> | null | undefined): EvidenceBasis | null {
  return decision ? 'DECLARED' : null;
}

/**
 * Derives the tri-state basis for every evidence facet of one asset. Pure — mirrors
 * `EvidenceBases.of(AssetEntry)` on the core/export path exactly. `ownership` is optional: when a
 * verification is supplied it is classified by {@link ownershipBasis}, otherwise it stays
 * `NOT_VERIFIED`.
 */
export function evidenceBasesFor(
  sourceEvidence: Pick<LocalSourceEvidence, 'resolved'> | null | undefined,
  decision: Pick<LocalDecision, 'type'> | null | undefined,
  ownership?: { outcome: ManifestOwnershipOutcome } | null,
): EvidenceBases {
  return {
    verification: verificationBasis(),
    source: sourceBasis(sourceEvidence),
    decision: decisionBasis(decision),
    ownership: ownershipBasis(ownership),
  };
}
