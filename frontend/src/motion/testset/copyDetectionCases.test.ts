// frontend/src/motion/testset/copyDetectionCases.test.ts
import { describe, expect, it } from 'vitest';
import { buildCases } from './copyDetectionCases';
import { buildMirrorNameSwapper } from './derivations';
import { loadRigFixture } from './fixtureLoader';

describe('copy-detection case builder', () => {
  const cases = buildCases([loadRigFixture('robot'), loadRigFixture('fox')]);

  it('produces 7 labeled positives per clip (17 clips → 119)', () => {
    expect(cases.filter((entry) => entry.kind === 'positive')).toHaveLength(119);
    const classes = new Set(cases.filter((entry) => entry.kind === 'positive').map((entry) => entry.caseClass));
    expect([...classes].sort()).toEqual(['hold', 'mirror', 'relocate', 'rescale', 'retime-fast', 'retime-slow', 'reupload']);
  });

  it('produces within-rig negatives only: 92 robot + 5 fox, plus the one variant pair', () => {
    const negatives = cases.filter((entry) => entry.kind === 'negative');
    expect(negatives.filter((entry) => entry.rigId === 'robot')).toHaveLength(92);
    expect(negatives.filter((entry) => entry.rigId === 'fox')).toHaveLength(5);
    expect(cases.filter((entry) => entry.kind === 'variant')).toHaveLength(1);
    expect(cases.find((entry) => entry.kind === 'variant')!.id).toBe('robot:variant:WalkJump-vs-Walking');
  });

  it('builds partial-coverage negatives that genuinely share only a slice of the skeleton', () => {
    const partial = cases.filter((entry) => entry.caseClass === 'partial-coverage');
    expect(partial.map((entry) => entry.id).sort()).toEqual([
      'fox:neg-partial:half:Walk', 'fox:neg-partial:low:Walk',
      'robot:neg-partial:half:Walking', 'robot:neg-partial:low:Walking',
    ]);
    for (const entry of partial) {
      expect(entry.kind).toBe('negative');
      const sourceNames = new Set(entry.source.tracks.map((track) => track.name));
      const candidateNames = entry.candidate.tracks.map((track) => track.name);
      const shared = candidateNames.filter((name) => sourceNames.has(name));
      const renamed = candidateNames.filter((name) => !sourceNames.has(name));
      expect(shared.length).toBeGreaterThan(0);
      expect(renamed.length).toBeGreaterThan(0);
      expect(entry.id.includes(':low:') ? shared.length <= 2 : shared.length >= Math.floor(candidateNames.length / 3)).toBe(true);
      for (const name of renamed) expect(name.startsWith('Unshared')).toBe(true);
    }
  });

  it('labels the known same-family pairs as family negatives', () => {
    const family = cases.filter((entry) => entry.caseClass === 'family').map((entry) => entry.id).sort();
    expect(family).toEqual(['fox:neg:Run-vs-Walk', 'robot:neg:Running-vs-Walking']);
  });

  it('never pairs across rigs and never repeats an id', () => {
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const entry of cases) expect(entry.id.startsWith(entry.rigId)).toBe(true);
  });

  it('derives candidates that differ from the source except for reupload', () => {
    for (const entry of cases.filter((c) => c.kind === 'positive' && c.caseClass !== 'reupload')) {
      expect(JSON.stringify(entry.candidate.tracks)).not.toBe(JSON.stringify(entry.source.tracks));
    }
  });

  it('mirror swapping is a complete involution on the real rigs (no half-mirrored fixtures)', () => {
    // Guards fixture regeneration: a future GLB/loader change that breaks L/R pairing
    // must fail here rather than silently emit a mislabeled mirror positive.
    for (const rigId of ['robot', 'fox'] as const) {
      const fixture = loadRigFixture(rigId);
      const swap = buildMirrorNameSwapper(fixture.nodes);
      for (const clip of fixture.clips) {
        for (const track of clip.tracks) {
          const swapped = swap(track.name);
          expect(swap(swapped), `${rigId} ${track.name} must round-trip`).toBe(track.name);
          const node = track.name.slice(0, track.name.lastIndexOf('.'));
          if (/[LR]$/.test(node) || /Left|Right/.test(node)) {
            expect(swapped, `${rigId} ${track.name} is side-marked but did not swap`).not.toBe(track.name);
          }
        }
      }
    }
  });
});
