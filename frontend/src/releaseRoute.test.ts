import { describe, expect, it } from 'vitest';
import type { AssetRecord } from './data';
import { initialAssets } from './data';
import {
  applyPreparedResolutions,
  assetsInGroup,
  attachSourceRecord,
  currentStationIndex,
  evidenceSplit,
  excludeFromRelease,
  recordLicense,
  releaseCounts,
  releaseGroup,
  routeStations,
  primaryMatch,
  walkedThrough,
} from './releaseRoute';

const byId = (assets: readonly AssetRecord[], id: string) => {
  const found = assets.find((asset) => asset.id === id);
  if (!found) throw new Error(`no sample asset ${id}`);
  return found;
};

describe('releaseCounts on the sample', () => {
  it('reads 3 blocked, 6 need review, 3 approved, 9 unresolved, as the release bar always has', () => {
    expect(releaseCounts(initialAssets)).toEqual({
      blocked: 3, review: 6, clear: 3, excluded: 0, unresolved: 9, total: 12, ready: false,
    });
  });

  it('puts every file in exactly one group, so the groups add up to the total', () => {
    const counts = releaseCounts(initialAssets);
    expect(counts.blocked + counts.review + counts.clear + counts.excluded).toBe(counts.total);
    for (const group of ['blocked', 'review', 'clear', 'excluded'] as const) {
      expect(assetsInGroup(initialAssets, group)).toHaveLength(counts[group]);
    }
  });

  it('counts an empty project as ready with nothing in it', () => {
    expect(releaseCounts([])).toEqual({ blocked: 0, review: 0, clear: 0, excluded: 0, unresolved: 0, total: 0, ready: true });
  });

  it('no longer counts an excluded file as needing review (the old rule did)', () => {
    const avocado = byId(initialAssets, 'avocado-prop');
    expect(avocado.status).toBe('review');
    const after = releaseCounts(excludeFromRelease(initialAssets, avocado.id));
    expect(after.review).toBe(5);
    expect(after.excluded).toBe(1);
    expect(after.unresolved).toBe(8);
  });
});

describe('releaseGroup', () => {
  it('lets a human decision outrank the scan', () => {
    expect(releaseGroup({ status: 'blocked', decision: 'approved' })).toBe('clear');
    expect(releaseGroup({ status: 'blocked', decision: 'excluded' })).toBe('excluded');
    expect(releaseGroup({ status: 'blocked', decision: 'pending' })).toBe('blocked');
    expect(releaseGroup({ status: 'review', decision: 'needs-review' })).toBe('review');
    expect(releaseGroup({ status: 'clear', decision: 'pending' })).toBe('review');
  });
});

describe('routeStations', () => {
  it('derives the sample route: Scan done, 6 need review, 3 blocked, Export locked, You are here at Evidence', () => {
    const stations = routeStations('complete', releaseCounts(initialAssets));
    expect(stations.map((station) => [station.id, station.state, station.word])).toEqual([
      ['scan', 'done', 'Done'],
      ['evidence', 'review', '6 need review'],
      ['exceptions', 'open', '3 blocked'],
      ['export', 'locked', 'Locked'],
    ]);
    expect(currentStationIndex(stations)).toBe(1);
    expect(walkedThrough('complete', 1)).toBe(2);
  });

  it('never calls Evidence done while a file needs review, even when nothing is blocked', () => {
    const counts = { blocked: 0, review: 1, clear: 11, excluded: 0, unresolved: 1, total: 12, ready: false };
    const stations = routeStations('complete', counts);
    expect(stations[1]).toMatchObject({ state: 'review', word: '1 needs review' });
    expect(stations[2]).toMatchObject({ state: 'done', word: 'Done' });
    expect(stations[3]).toMatchObject({ state: 'locked' });
    expect(currentStationIndex(stations)).toBe(1);
  });

  it('jumps to Exceptions when review is clear but files are still blocked', () => {
    const counts = { blocked: 2, review: 0, clear: 10, excluded: 0, unresolved: 2, total: 12, ready: false };
    expect(currentStationIndex(routeStations('complete', counts))).toBe(2);
  });

  it('unlocks Export, and puts You are here on it, only when every file is decided', () => {
    const counts = { blocked: 0, review: 0, clear: 10, excluded: 2, unresolved: 0, total: 12, ready: true };
    const stations = routeStations('complete', counts);
    expect(stations[3]).toMatchObject({ state: 'ready', word: 'Ready' });
    expect(currentStationIndex(stations)).toBe(3);
  });

  it('shows no result before or during the scan, or when it failed, and walks nothing', () => {
    const counts = releaseCounts(initialAssets);
    expect(routeStations('idle', counts).map((s) => s.state)).toEqual(['next', 'waiting', 'waiting', 'locked']);
    expect(routeStations('scanning', counts).map((s) => s.state)).toEqual(['running', 'waiting', 'waiting', 'locked']);
    expect(routeStations('failed', counts).map((s) => s.state)).toEqual(['failed', 'waiting', 'waiting', 'locked']);
    expect(walkedThrough('idle', 0)).toBe(0);
    expect(walkedThrough('failed', 0)).toBe(0);
  });

  it('takes its titles from the workflow steps', () => {
    expect(routeStations('complete', releaseCounts(initialAssets)).map((s) => `${s.number} ${s.title}`)).toEqual([
      '01 Scan the project', '02 Review the evidence', '03 Resolve exceptions', '04 Export the manifest',
    ]);
  });
});

describe('evidence', () => {
  it('splits the sample into 5 near-exact copies at 99% and 7 weak resemblances from 46% down to 18%', () => {
    const { near, weak } = evidenceSplit(initialAssets);
    expect(near).toHaveLength(5);
    expect(near.every((asset) => primaryMatch(asset)?.similarity === 99)).toBe(true);
    expect(weak.map((asset) => primaryMatch(asset)?.similarity)).toEqual([46, 38, 34, 31, 29, 24, 18]);
  });

  it('judges a file by its first source record, the one the match workbench opens on', () => {
    const avocado = byId(initialAssets, 'avocado-prop');
    expect(primaryMatch(avocado)).toBe(avocado.matches![0]);
    expect(primaryMatch(avocado)?.provider).toBe('Khronos glTF Sample Assets');
    // Not the 100% record: that is the team's own import of the same file.
    expect(Math.max(...avocado.matches!.map((match) => match.similarity))).toBe(100);
    expect(primaryMatch({ matches: [] })).toBeUndefined();
    expect(primaryMatch({})).toBeUndefined();
  });
});

describe('decisions are copy-on-write', () => {
  it('records a license without touching the original array or the other files', () => {
    const before = initialAssets;
    const after = recordLicense(before, 'ui-icon-set');
    expect(after).not.toBe(before);
    expect(byId(before, 'ui-icon-set').decision).toBe('blocked');
    expect(byId(after, 'ui-icon-set')).toMatchObject({ status: 'clear', decision: 'approved', license: 'License and attribution recorded' });
    expect(after.filter((asset) => asset.id !== 'ui-icon-set')).toEqual(before.filter((asset) => asset.id !== 'ui-icon-set'));
  });

  it('attaches a source record as the origin and license', () => {
    const avocado = byId(initialAssets, 'avocado-prop');
    const match = avocado.matches![0];
    expect(byId(attachSourceRecord(initialAssets, avocado.id, match), avocado.id)).toMatchObject({
      origin: match.provider, license: `${match.license} · source record attached`, status: 'clear', decision: 'approved',
    });
  });

  it('applies the prepared resolutions: two CC0 records attached, two files excluded, one blocker left', () => {
    const counts = releaseCounts(applyPreparedResolutions(initialAssets));
    expect(counts).toMatchObject({ blocked: 1, review: 4, clear: 5, excluded: 2, unresolved: 5, ready: false });
  });
});
