import { describe, expect, it } from 'vitest';
import {
  decisionBasis,
  evidenceBasesFor,
  OWNERSHIP_BASIS,
  sourceBasis,
  verificationBasis,
} from './evidenceBasis';
import type { LocalDecisionType } from './localBridge';

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

describe('evidenceBasesFor', () => {
  it('combines all four facets for a fully unresolved, undecided asset', () => {
    expect(evidenceBasesFor(null, null)).toEqual({
      verification: 'VERIFIED',
      source: 'NOT_VERIFIED',
      decision: null,
      ownership: 'NOT_VERIFIED',
    });
  });

  it('combines all four facets for a resolved, decided asset', () => {
    expect(evidenceBasesFor({ resolved: true }, { type: 'APPROVED' })).toEqual({
      verification: 'VERIFIED',
      source: 'DECLARED',
      decision: 'DECLARED',
      ownership: 'NOT_VERIFIED',
    });
  });

  it('keeps ownership NOT_VERIFIED regardless of source/decision state', () => {
    expect(evidenceBasesFor({ resolved: true }, { type: 'BLOCKED' }).ownership).toBe('NOT_VERIFIED');
    expect(evidenceBasesFor({ resolved: false }, null).ownership).toBe('NOT_VERIFIED');
  });
});
