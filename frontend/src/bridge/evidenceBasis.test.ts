import { describe, expect, it } from 'vitest';
import {
  decisionBasis,
  evidenceBasesFor,
  OWNERSHIP_BASIS,
  ownershipBasis,
  ownershipLinkBasis,
  sourceBasis,
  verificationBasis,
} from './evidenceBasis';
import type { LocalDecisionType } from './localBridge';
import type { ManifestOwnershipOutcome } from '../manifest/manifest';

describe('verificationBasis', () => {
  it('is always VERIFIED — a fingerprint/verification outcome is always tool-computed', () => {
    expect(verificationBasis()).toBe('VERIFIED');
  });
});

describe('sourceBasis', () => {
  it('is DECLARED when the source evidence is resolved', () => {
    expect(sourceBasis({ resolved: true })).toBe('DECLARED');
  });

  it('is NOT_VERIFIED when the source evidence is unresolved, missing, or null', () => {
    expect(sourceBasis({ resolved: false })).toBe('NOT_VERIFIED');
    expect(sourceBasis(null)).toBe('NOT_VERIFIED');
    expect(sourceBasis(undefined)).toBe('NOT_VERIFIED');
  });
});

describe('decisionBasis', () => {
  it('is DECLARED for every human decision type', () => {
    const types: LocalDecisionType[] = ['APPROVED', 'NEEDS_REVIEW', 'BLOCKED', 'EXCLUDED'];
    types.forEach((type) => {
      expect(decisionBasis({ type })).toBe('DECLARED');
    });
  });

  it('is null (absent) when no decision has been recorded yet', () => {
    expect(decisionBasis(null)).toBeNull();
    expect(decisionBasis(undefined)).toBeNull();
  });
});

describe('OWNERSHIP_BASIS', () => {
  it('is always NOT_VERIFIED — no code calls a Roblox ownership/permission API', () => {
    expect(OWNERSHIP_BASIS).toBe('NOT_VERIFIED');
  });
});

describe('ownershipBasis', () => {
  it('is VERIFIED once facts were obtained — for BOTH a MATCH and a MISMATCH', () => {
    // VERIFIED = "we obtained authoritative facts from Roblox", true for a match AND a mismatch
    // (a mismatch is a review lead, not an absence of verification).
    expect(ownershipBasis({ outcome: 'MATCH' })).toBe('VERIFIED');
    expect(ownershipBasis({ outcome: 'MISMATCH' })).toBe('VERIFIED');
  });

  it('is NOT_VERIFIED for an UNVERIFIABLE outcome or no verification at all', () => {
    expect(ownershipBasis({ outcome: 'UNVERIFIABLE' })).toBe('NOT_VERIFIED');
    expect(ownershipBasis(null)).toBe('NOT_VERIFIED');
    expect(ownershipBasis(undefined)).toBe('NOT_VERIFIED');
  });

  // Cross-runtime parity: this truth table is asserted verbatim by the Java
  // EvidenceBasesTest#ownershipBasisTruthTableMatchesTheCrossRuntimeContract so the export path
  // and this UI never disagree on what an outcome means.
  it('matches the Java EvidenceBases ownership truth table exactly', () => {
    const table: Array<[ManifestOwnershipOutcome | null, 'VERIFIED' | 'NOT_VERIFIED']> = [
      ['MATCH', 'VERIFIED'],
      ['MISMATCH', 'VERIFIED'],
      ['UNVERIFIABLE', 'NOT_VERIFIED'],
      [null, 'NOT_VERIFIED'],
    ];
    table.forEach(([outcome, expected]) => {
      expect(ownershipBasis(outcome ? { outcome } : outcome)).toBe(expected);
    });
  });
});

describe('ownershipLinkBasis', () => {
  it('is DECLARED when a person supplied the animation id — never VERIFIED', () => {
    // The ownership FACTS can be VERIFIED (CreatorFlow obtained them), but the link between the
    // scanned file and that animation id is a human claim: nothing in the file identifies a Roblox
    // asset, so no code path can ever verify it.
    expect(ownershipLinkBasis({ assetIdSource: 'DECLARED_BY_USER' })).toBe('DECLARED');
  });

  it('is NOT_VERIFIED when the linkage provenance is absent or unknown', () => {
    expect(ownershipLinkBasis(null)).toBe('NOT_VERIFIED');
    expect(ownershipLinkBasis(undefined)).toBe('NOT_VERIFIED');
    // e.g. an ownership block exported before assetIdSource existed: unknown stays unknown.
    expect(ownershipLinkBasis({})).toBe('NOT_VERIFIED');
  });

  // Cross-runtime parity: asserted verbatim by the Java
  // EvidenceBasesTest#ownershipLinkBasisTruthTableMatchesTheCrossRuntimeContract.
  it('matches the Java EvidenceBases.ownershipLinkBasis truth table exactly', () => {
    expect(ownershipLinkBasis({ assetIdSource: 'DECLARED_BY_USER' })).toBe('DECLARED');
    expect(ownershipLinkBasis({ assetIdSource: undefined })).toBe('NOT_VERIFIED');
  });

  it('never returns VERIFIED for any input', () => {
    const inputs = [null, undefined, {}, { assetIdSource: 'DECLARED_BY_USER' as const }];
    inputs.forEach((input) => expect(ownershipLinkBasis(input)).not.toBe('VERIFIED'));
  });
});

describe('evidenceBasesFor', () => {
  it('combines all four facets for a fully unresolved, undecided, unverified asset', () => {
    expect(evidenceBasesFor(null, null)).toEqual({
      verification: 'VERIFIED',
      source: 'NOT_VERIFIED',
      decision: null,
      ownership: 'NOT_VERIFIED',
    });
  });

  it('combines all four facets for a resolved, decided asset (ownership still absent)', () => {
    expect(evidenceBasesFor({ resolved: true }, { type: 'APPROVED' })).toEqual({
      verification: 'VERIFIED',
      source: 'DECLARED',
      decision: 'DECLARED',
      ownership: 'NOT_VERIFIED',
    });
  });

  it('promotes ownership to VERIFIED when a verification is supplied', () => {
    expect(evidenceBasesFor({ resolved: true }, { type: 'APPROVED' }, { outcome: 'MISMATCH' })).toEqual({
      verification: 'VERIFIED',
      source: 'DECLARED',
      decision: 'DECLARED',
      ownership: 'VERIFIED',
    });
  });

  it('keeps ownership NOT_VERIFIED for an UNVERIFIABLE verification or none at all', () => {
    expect(evidenceBasesFor({ resolved: true }, { type: 'BLOCKED' }, { outcome: 'UNVERIFIABLE' }).ownership)
      .toBe('NOT_VERIFIED');
    expect(evidenceBasesFor({ resolved: false }, null).ownership).toBe('NOT_VERIFIED');
  });
});
