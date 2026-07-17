import { describe, expect, it } from 'vitest';
import { parseExperienceFormInput, parsePublishedPlaceVersionInput, resolveRollbackTargetLabel } from './LocalProjectWorkspace';
import type { LocalRelease } from '../bridge/localBridge';

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
