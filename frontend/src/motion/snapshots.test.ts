import { describe, expect, it } from 'vitest';
import type { AnimationSnapshotKind } from '../bridge/localBridge';
import {
  formatSnapshotFingerprint,
  snapshotKindLabel,
  snapshotStatusLabel,
  snapshotStatusTone,
  sortSnapshotsForDisplay,
} from './snapshots';

describe('animation snapshot presentation', () => {
  it('labels the two snapshot kinds', () => {
    expect(snapshotKindLabel('LAST_KNOWN_GOOD')).toBe('Last known good');
    expect(snapshotKindLabel('LAST_PUBLISHED')).toBe('Last published');
  });

  it('labels each status', () => {
    expect(snapshotStatusLabel('FIRST_SNAPSHOT')).toBe('First snapshot');
    expect(snapshotStatusLabel('UNCHANGED')).toBe('Unchanged since last snapshot');
    expect(snapshotStatusLabel('CHANGED')).toBe('Changed since last snapshot');
  });

  it('flags only a changed snapshot as a warning', () => {
    expect(snapshotStatusTone('FIRST_SNAPSHOT')).toBe('neutral');
    expect(snapshotStatusTone('UNCHANGED')).toBe('positive');
    expect(snapshotStatusTone('CHANGED')).toBe('warning');
  });

  it('shortens a long fingerprint but leaves a short one alone', () => {
    expect(formatSnapshotFingerprint('a'.repeat(64))).toBe(`${'a'.repeat(12)}…`);
    expect(formatSnapshotFingerprint('abc123')).toBe('abc123');
  });

  it('sorts snapshots by name, then asset id, then kind', () => {
    const lkg: AnimationSnapshotKind = 'LAST_KNOWN_GOOD';
    const pub: AnimationSnapshotKind = 'LAST_PUBLISHED';
    const rows = [
      { name: 'Walk', assetId: '2', kind: pub },
      { name: 'Run', assetId: '9', kind: lkg },
      { name: 'Walk', assetId: '2', kind: lkg },
    ];
    expect(sortSnapshotsForDisplay(rows).map((r) => `${r.name}:${r.kind}`))
      .toEqual(['Run:LAST_KNOWN_GOOD', 'Walk:LAST_KNOWN_GOOD', 'Walk:LAST_PUBLISHED']);
  });
});
