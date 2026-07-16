import { describe, expect, it } from 'vitest';
import { deserializeClip, serializeClip } from '../motionCurves';
import { loadRigFixture } from './fixtureLoader';
import { rigFixtures } from '../rigFixtures';

describe.each(['robot', 'fox'] as const)('%s motion fixture', (rigId) => {
  const fixture = loadRigFixture(rigId);
  const rig = rigFixtures.find((entry) => entry.id === rigId)!;

  it('contains exactly the clips the Motion Lab advertises', () => {
    expect(fixture.clips.map((clip) => clip.name).sort()).toEqual(rig.clips.map((clip) => clip.name).sort());
  });

  it('round-trips every clip through the three.js deserializer exactly', () => {
    for (const clip of fixture.clips) {
      expect(serializeClip(deserializeClip(clip))).toEqual(clip);
    }
  });

  it('has well-formed tracks: ascending times, value counts matching type size, positive duration', () => {
    const sizes = { vector: 3, quaternion: 4 } as const;
    for (const clip of fixture.clips) {
      expect(clip.duration).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        for (let i = 1; i < track.times.length; i += 1) expect(track.times[i]).toBeGreaterThan(track.times[i - 1]);
        if (track.type !== 'number') expect(track.values.length).toBe(track.times.length * sizes[track.type]);
        else expect(track.values.length % track.times.length).toBe(0);
        expect(track.times[track.times.length - 1]).toBeLessThanOrEqual(clip.duration + 0.000001);
      }
    }
  });

  it('records the node list needed for mirror mapping', () => {
    expect(fixture.nodes.length).toBeGreaterThan(0);
    const trackNodes = new Set(fixture.clips.flatMap((clip) => clip.tracks.map((track) => track.name.slice(0, track.name.lastIndexOf('.')))));
    for (const node of trackNodes) expect(fixture.nodes).toContain(node);
  });
});
