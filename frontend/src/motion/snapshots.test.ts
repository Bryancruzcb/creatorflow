import { describe, expect, it } from 'vitest';
import { snapshotKindLabel, snapshotStatusLabel, snapshotStatusTone } from './snapshots';

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
});
