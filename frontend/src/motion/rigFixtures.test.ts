import { describe, expect, it } from 'vitest';
import { clipInRig, rigById, rigFixtures } from './rigFixtures';

describe('rig fixtures', () => {
  it('exposes at least two rigs, each with a real .glb and attribution', () => {
    expect(rigFixtures.length).toBeGreaterThanOrEqual(2);
    for (const rig of rigFixtures) {
      expect(rig.glbUrl).toMatch(/\.glb$/);
      expect(rig.attribution.length).toBeGreaterThan(0);
      expect(rig.clips.length).toBeGreaterThan(0);
    }
  });

  it('only references clip names that exist in the same rig', () => {
    for (const rig of rigFixtures) {
      for (const clipName of rig.defaultPair) {
        expect(clipInRig(rig, clipName), `${rig.id} defaultPair ${clipName}`).toBeDefined();
      }
      for (const scenario of rig.scenarios) {
        expect(clipInRig(rig, scenario.source), `${rig.id} ${scenario.id} source`).toBeDefined();
        expect(clipInRig(rig, scenario.candidate), `${rig.id} ${scenario.id} candidate`).toBeDefined();
      }
    }
  });

  it('falls back to the first rig for an unknown id', () => {
    expect(rigById('does-not-exist').id).toBe(rigFixtures[0].id);
  });
});
