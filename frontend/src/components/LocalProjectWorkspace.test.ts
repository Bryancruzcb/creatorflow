import { describe, expect, it } from 'vitest';
import {
  describeOwnershipOutcome,
  formatCheckedAt,
  formatRetryAfter,
  ownershipVerifyDisabledReason,
  ownershipVerifyError,
  parseExperienceFormInput,
  parsePublishedPlaceVersionInput,
  parseRobloxAssetIdInput,
  resolveRollbackTargetLabel,
} from './LocalProjectWorkspace';
import {
  LocalBridgeError,
  type LocalDecision,
  type LocalDecisionType,
  type LocalOwnershipVerification,
  type LocalRelease,
} from '../bridge/localBridge';

function decision(type: LocalDecisionType): LocalDecision {
  return {
    id: `dec-${type}`,
    scanAssetId: 42,
    type,
    reason: 'Recorded by a person while reviewing this file.',
    supersedesDecisionId: null,
    createdAt: '2026-07-24T00:00:00Z',
  };
}

function verification(overrides: Partial<LocalOwnershipVerification> = {}): LocalOwnershipVerification {
  return {
    id: 'own-1',
    scanAssetId: 42,
    robloxAssetId: 507766388,
    assetIdSource: 'DECLARED_BY_USER',
    universeId: 90110,
    creatorType: 'USER',
    creatorId: 1,
    assetType: 'Animation',
    moderationState: 'Approved',
    ownerType: 'USER',
    ownerId: 1,
    memberRank: null,
    outcome: 'MATCH',
    verified: true,
    checkedAt: '2026-07-24T00:00:00Z',
    ...overrides,
  };
}

describe('parseExperienceFormInput', () => {
  it('accepts a fully specified positive-integer declaration and trims the name', () => {
    const result = parseExperienceFormInput({ universeId: '1234567890', placeId: '9876543210', experienceName: '  Obby Tower  ' });
    expect(result).toEqual({ ok: true, value: { universeId: 1234567890, placeId: 9876543210, experienceName: 'Obby Tower' } });
  });

  it('rejects a zero, negative, non-integer, or non-numeric universe id', () => {
    expect(parseExperienceFormInput({ universeId: '0', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: '-5', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: '1.5', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: 'abc', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: '', placeId: '1', experienceName: 'X' }).ok).toBe(false);
  });

  it('rejects a non-positive place id independently of a valid universe id', () => {
    const result = parseExperienceFormInput({ universeId: '1', placeId: '-4', experienceName: 'X' });
    expect(result).toEqual({ ok: false, error: 'Place ID must be a positive whole number.' });
  });

  it('rejects a blank or whitespace-only experience name', () => {
    const result = parseExperienceFormInput({ universeId: '1', placeId: '1', experienceName: '   ' });
    expect(result).toEqual({ ok: false, error: 'Experience name is required.' });
  });
});

describe('parsePublishedPlaceVersionInput', () => {
  it('accepts a positive integer', () => {
    expect(parsePublishedPlaceVersionInput('42')).toEqual({ ok: true, value: 42 });
    expect(parsePublishedPlaceVersionInput('  7  ')).toEqual({ ok: true, value: 7 });
  });

  it('rejects zero, negative, non-integer, or non-numeric input', () => {
    expect(parsePublishedPlaceVersionInput('0').ok).toBe(false);
    expect(parsePublishedPlaceVersionInput('-3').ok).toBe(false);
    expect(parsePublishedPlaceVersionInput('1.5').ok).toBe(false);
    expect(parsePublishedPlaceVersionInput('abc').ok).toBe(false);
    expect(parsePublishedPlaceVersionInput('').ok).toBe(false);
  });

  it('carries a human-readable error message', () => {
    expect(parsePublishedPlaceVersionInput('0')).toEqual({ ok: false, error: 'Place version must be a positive whole number.' });
  });
});

describe('parseRobloxAssetIdInput', () => {
  it('accepts a positive integer and trims whitespace', () => {
    expect(parseRobloxAssetIdInput('507766388')).toEqual({ ok: true, value: 507766388 });
    expect(parseRobloxAssetIdInput('  42  ')).toEqual({ ok: true, value: 42 });
  });

  it('rejects zero, negative, non-integer, or non-numeric input', () => {
    expect(parseRobloxAssetIdInput('0').ok).toBe(false);
    expect(parseRobloxAssetIdInput('-3').ok).toBe(false);
    expect(parseRobloxAssetIdInput('1.5').ok).toBe(false);
    expect(parseRobloxAssetIdInput('abc').ok).toBe(false);
    expect(parseRobloxAssetIdInput('').ok).toBe(false);
  });
});

describe('describeOwnershipOutcome', () => {
  it('classifies a MATCH as VERIFIED positive evidence, not a review lead', () => {
    const display = describeOwnershipOutcome(verification({ outcome: 'MATCH' }), null);
    expect(display.basis).toBe('VERIFIED');
    expect(display.tone).toBe('match');
    expect(display.isReviewLead).toBe(false);
  });

  it('classifies a MISMATCH as VERIFIED facts surfaced as a non-accusatory review lead', () => {
    const display = describeOwnershipOutcome(verification({ outcome: 'MISMATCH', ownerId: 999 }), null);
    expect(display.basis).toBe('VERIFIED');
    expect(display.tone).toBe('review-lead');
    expect(display.isReviewLead).toBe(true);
    // A mismatch is a lead for a human, never an accusation.
    const copy = `${display.headline} ${display.detail}`.toLowerCase();
    expect(copy).toContain('review');
    expect(copy).not.toContain('infringement');
    expect(copy).not.toContain('stolen');
  });

  it('classifies an UNVERIFIABLE as NOT_VERIFIED, never a false verified', () => {
    const display = describeOwnershipOutcome(verification({
      outcome: 'UNVERIFIABLE', verified: false, creatorId: null, ownerId: null, moderationState: null,
    }), null);
    expect(display.basis).toBe('NOT_VERIFIED');
    expect(display.tone).toBe('unverifiable');
    expect(display.isReviewLead).toBe(false);
  });

  it('keeps the file-to-animation linkage DECLARED for every outcome, never VERIFIED', () => {
    // The facts basis and the linkage basis answer different questions and must not be collapsed:
    // CreatorFlow obtained the facts, but a person claimed this file is that animation.
    (['MATCH', 'MISMATCH', 'UNVERIFIABLE'] as const).forEach((outcome) => {
      const display = describeOwnershipOutcome(verification({ outcome }), null);
      expect(display.linkBasis).toBe('DECLARED');
      expect(display.linkage.toLowerCase()).toContain('you entered');
      expect(display.linkage.toLowerCase()).toContain('cannot check that this file is that animation');
    });
  });

  it('never states the linkage as an outcome the tool established', () => {
    const display = describeOwnershipOutcome(verification({ outcome: 'MATCH' }), null);
    const copy = `${display.headline} ${display.detail} ${display.linkage}`.toLowerCase();
    expect(copy).not.toContain('this file is owned');
    expect(copy).not.toContain('you own this file');
    // The verdict speaks about the animation ID that was checked, not about the file itself.
    expect(display.detail.toLowerCase()).toContain('animation id you entered');
  });

  it('only says "no decision is on record" for a MISMATCH when there really is none', () => {
    const mismatch = verification({ outcome: 'MISMATCH', ownerId: 999 });
    expect(describeOwnershipOutcome(mismatch, null).detail.toLowerCase()).toContain('no decision is on record');

    // A person already ruled on this file: claiming otherwise misreads their own record.
    (['APPROVED', 'NEEDS_REVIEW', 'BLOCKED', 'EXCLUDED'] as const).forEach((type) => {
      const detail = describeOwnershipOutcome(mismatch, decision(type)).detail.toLowerCase();
      expect(detail).not.toContain('no decision is on record');
      expect(detail).toContain('lead'); // still a lead for a person, never an accusation
      expect(detail).not.toContain('infringement');
      expect(detail).not.toContain('stolen');
    });
  });

  it('says an Approved decision is the human call that clears the lead, without claiming CreatorFlow checked rights', () => {
    const detail = describeOwnershipOutcome(verification({ outcome: 'MISMATCH', ownerId: 999 }), decision('APPROVED')).detail;
    const copy = detail.toLowerCase();
    expect(copy).toContain('approved');
    // The decision is a person's call — CreatorFlow never claims to have established the rights.
    expect(copy).not.toContain('creatorflow confirmed');
    expect(copy).toMatch(/their call|a person/);
  });

  it('keeps the lead standing when the only decision on record is Needs review', () => {
    const copy = describeOwnershipOutcome(verification({ outcome: 'MISMATCH', ownerId: 999 }), decision('NEEDS_REVIEW'))
      .detail.toLowerCase();
    expect(copy).toContain('needs review');
    expect(copy).toContain('still stands');
  });

  it('ignores a decision for the non-lead outcomes — only a MISMATCH asks for a call', () => {
    // A MATCH or UNVERIFIABLE verdict says nothing about decisions either way.
    const match = describeOwnershipOutcome(verification({ outcome: 'MATCH' }), decision('APPROVED'));
    const unverifiable = describeOwnershipOutcome(verification({ outcome: 'UNVERIFIABLE', verified: false }), decision('APPROVED'));
    expect(match.detail.toLowerCase()).not.toContain('decision');
    expect(unverifiable.detail.toLowerCase()).not.toContain('decision');
  });
});

describe('formatCheckedAt', () => {
  it('reports point-in-time staleness relative to now (today / yesterday / N days ago)', () => {
    const now = new Date('2026-07-24T12:00:00Z');
    expect(formatCheckedAt('2026-07-24T00:00:00Z', now)).toBe('checked today');
    expect(formatCheckedAt('2026-07-23T00:00:00Z', now)).toBe('checked yesterday');
    expect(formatCheckedAt('2026-07-21T00:00:00Z', now)).toBe('checked 3 days ago');
  });

  it('treats a future or clock-skewed stamp as today rather than a negative age', () => {
    const now = new Date('2026-07-24T00:00:00Z');
    expect(formatCheckedAt('2026-07-25T00:00:00Z', now)).toBe('checked today');
  });
});

describe('ownershipVerifyError', () => {
  it('maps a 409 to the no-key state pointing at the desktop Settings card', () => {
    const result = ownershipVerifyError(new LocalBridgeError('Add a key in Settings', 409));
    expect(result.kind).toBe('no-key');
    expect(result.message.toLowerCase()).toContain('settings');
  });

  it('maps a 429 to a distinct rate-limited message', () => {
    const result = ownershipVerifyError(new LocalBridgeError('slow down', 429));
    expect(result.kind).toBe('rate-limited');
    expect(result.message.toLowerCase()).toContain('rate-limited, try again');
  });

  it('tells a rate-limited person how long to wait when the bridge reported a Retry-After', () => {
    const result = ownershipVerifyError(new LocalBridgeError('slow down', 429, 30));
    expect(result.kind).toBe('rate-limited');
    expect(result.message).toContain('30 seconds');
  });

  it('stays vague — never invents a countdown — when no Retry-After was reported', () => {
    const result = ownershipVerifyError(new LocalBridgeError('slow down', 429));
    expect(result.message).toContain('in a moment');
    expect(result.message).not.toMatch(/\d/);
  });

  it('maps a 404 to the not-applicable state carrying the server message', () => {
    const result = ownershipVerifyError(new LocalBridgeError('This asset needs an animation id and a bound experience to verify ownership.', 404));
    expect(result.kind).toBe('not-applicable');
    expect(result.message).toBe('This asset needs an animation id and a bound experience to verify ownership.');
  });

  it('maps any other failure to a generic error state', () => {
    expect(ownershipVerifyError(new LocalBridgeError('boom', 500)).kind).toBe('error');
    expect(ownershipVerifyError(new Error('offline')).kind).toBe('error');
    expect(ownershipVerifyError('weird').message.length).toBeGreaterThan(0);
  });
});

describe('formatRetryAfter', () => {
  it('says how long to wait in whole units when the wait is known', () => {
    expect(formatRetryAfter(30)).toBe('in 30 seconds');
    expect(formatRetryAfter(1)).toBe('in 1 second');
    expect(formatRetryAfter(60)).toBe('in 1 minute');
    expect(formatRetryAfter(150)).toBe('in 3 minutes');
  });

  it('rounds a fractional wait up, so nobody is told to retry in a fraction of a second', () => {
    expect(formatRetryAfter(1.2)).toBe('in 2 seconds');
    expect(formatRetryAfter(0.4)).toBe('in 1 second');
  });

  it('stays vague for an unknown, zero, or nonsense wait rather than inventing a countdown', () => {
    expect(formatRetryAfter(null)).toBe('in a moment');
    expect(formatRetryAfter(0)).toBe('in a moment');
    expect(formatRetryAfter(-5)).toBe('in a moment');
    expect(formatRetryAfter(Number.NaN)).toBe('in a moment');
    expect(formatRetryAfter(Number.POSITIVE_INFINITY)).toBe('in a moment');
  });
});

describe('ownershipVerifyDisabledReason', () => {
  it('returns null (enabled) when an experience is bound, a key is configured, and a valid id is entered', () => {
    expect(ownershipVerifyDisabledReason('507766388', true, true)).toBeNull();
  });

  it('explains that an intended experience must be bound first', () => {
    const reason = ownershipVerifyDisabledReason('507766388', false, true);
    expect(reason).not.toBeNull();
    expect(reason!.toLowerCase()).toContain('experience');
  });

  it('explains that a Roblox animation asset id is required', () => {
    const reason = ownershipVerifyDisabledReason('', true, true);
    expect(reason).not.toBeNull();
    expect(reason!.toLowerCase()).toContain('id');
  });

  it('disables with the no-key reason when the desktop reports no Open Cloud key configured', () => {
    const reason = ownershipVerifyDisabledReason('507766388', true, false);
    expect(reason).not.toBeNull();
    expect(reason!.toLowerCase()).toContain('key');
    expect(reason!.toLowerCase()).toContain('settings');
  });

  it('leaves the action available when the key status is unknown — an unknown is never asserted as "no key"', () => {
    // An older/other bridge that does not report the flag must not have the UI claim a key state it
    // was never told; the post-click 409 stays the fallback.
    expect(ownershipVerifyDisabledReason('507766388', true, null)).toBeNull();
  });
});

describe('resolveRollbackTargetLabel', () => {
  const releases: LocalRelease[] = [
    {
      id: 'abcdef12-3456-7890-abcd-ef1234567890', scanRunId: 'run-1', release: '1.0.0', policyResult: 'PASS',
      createdAt: '2026-01-01T00:00:00Z', manifestUrl: '/m', reportUrl: '/r',
      comparison: { previousReleaseId: null, added: 0, changed: 0, removed: 0, addedPaths: [], changedPaths: [], removedPaths: [], unresolved: 0, approved: 0, blocked: 0, excluded: 0 },
    },
  ];

  it('resolves the prior release name and a short id tag when the id is in the fetched list', () => {
    expect(resolveRollbackTargetLabel('abcdef12-3456-7890-abcd-ef1234567890', releases)).toBe('1.0.0 (vabcdef12)');
  });

  it('falls back to the raw id when the prior release is not in the fetched list', () => {
    expect(resolveRollbackTargetLabel('missing-id', releases)).toBe('missing-id');
  });
});
