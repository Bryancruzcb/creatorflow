import { describe, expect, it } from 'vitest';
import {
  CURRENT_FINGERPRINT_VERSION,
  claimVersionCaveat,
  classifyClaimVersion,
  sortClaimsForDisplay,
} from './fingerprintVersions';

/**
 * Version classification is done in the client precisely so that a row the server returned can be
 * shown and labelled rather than filtered away. These tests hold the two failure directions apart:
 * never call something a match when it isn't, and never drop something just because it isn't.
 */
describe('classifyClaimVersion', () => {
  it('matches only an identical version string', () => {
    expect(classifyClaimVersion(CURRENT_FINGERPRINT_VERSION, CURRENT_FINGERPRINT_VERSION)).toBe('MATCH');
  });

  it('recognizes another revision of the same family as recorded-but-not-comparable', () => {
    expect(classifyClaimVersion('creatorflow.motion-fingerprint/v2', CURRENT_FINGERPRINT_VERSION))
      .toBe('DIFFERENT_VERSION');
    // Recognition is by family, not an allowlist: a future revision must not read as an unknown
    // format, which would be both wrong and less useful than naming what it actually is.
    expect(classifyClaimVersion('creatorflow.motion-fingerprint/v17', CURRENT_FINGERPRINT_VERSION))
      .toBe('DIFFERENT_VERSION');
  });

  it('calls anything outside the family an unknown format', () => {
    for (const foreign of ['sha256-of-file', 'creatorflow.motion-fingerprint', 'v1', 'creatorflow.audio/v1']) {
      expect(classifyClaimVersion(foreign, CURRENT_FINGERPRINT_VERSION)).toBe('UNKNOWN_VERSION');
    }
  });

  it('treats a missing version on the row as unknown rather than assuming the current one', () => {
    expect(classifyClaimVersion(null, CURRENT_FINGERPRINT_VERSION)).toBe('UNKNOWN_VERSION');
    expect(classifyClaimVersion('', CURRENT_FINGERPRINT_VERSION)).toBe('UNKNOWN_VERSION');
    expect(classifyClaimVersion('   ', CURRENT_FINGERPRINT_VERSION)).toBe('UNKNOWN_VERSION');
  });

  /**
   * If this build does not know which version produced the fingerprint being looked up, it is in
   * no position to say a row is the same version. Never MATCH.
   */
  it('never returns MATCH when the lookup version is unknown', () => {
    expect(classifyClaimVersion(CURRENT_FINGERPRINT_VERSION, null)).toBe('DIFFERENT_VERSION');
    expect(classifyClaimVersion(CURRENT_FINGERPRINT_VERSION, '')).toBe('DIFFERENT_VERSION');
    expect(classifyClaimVersion('sha256-of-file', null)).toBe('UNKNOWN_VERSION');
  });
});

describe('claimVersionCaveat', () => {
  it('has no caveat for a match, and a plain sentence for everything else', () => {
    expect(claimVersionCaveat('MATCH')).toBeNull();
    expect(claimVersionCaveat('DIFFERENT_VERSION')).toMatch(/not comparable/i);
    expect(claimVersionCaveat('UNKNOWN_VERSION')).toMatch(/unknown fingerprint format/i);
  });
});

describe('sortClaimsForDisplay', () => {
  /**
   * By username, never by time. A recency order would read as a ranking, with the top row looking
   * like whoever "got there first" — which this store does not and cannot record.
   */
  it('orders by username regardless of when each claim was recorded', () => {
    const rows = [
      { id: 1, memberUsername: 'zoe', recordedAt: '2026-01-01T00:00:00Z' },
      { id: 2, memberUsername: 'amir', recordedAt: '2026-12-31T00:00:00Z' },
      { id: 3, memberUsername: 'Bea', recordedAt: '2026-06-01T00:00:00Z' },
    ];
    expect(sortClaimsForDisplay(rows).map((row) => row.memberUsername)).toEqual(['amir', 'Bea', 'zoe']);
  });

  it('does not mutate the input', () => {
    const rows = [
      { id: 1, memberUsername: 'zoe' },
      { id: 2, memberUsername: 'amir' },
    ];
    sortClaimsForDisplay(rows);
    expect(rows.map((row) => row.memberUsername)).toEqual(['zoe', 'amir']);
  });

  it('breaks a username tie by id so the order is total and stable', () => {
    const rows = [
      { id: 9, memberUsername: 'mira' },
      { id: 4, memberUsername: 'mira' },
    ];
    expect(sortClaimsForDisplay(rows).map((row) => row.id)).toEqual([4, 9]);
  });
});
