import { describe, expect, it } from 'vitest';
import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { deserializeClip, serializeClip, type MotionCurves } from './motionCurves';

function syntheticClip() {
  return new AnimationClip('Synthetic', 1.5, [
    new VectorKeyframeTrack('Body.position', [0, 0.75, 1.5], [0, 1, 0, 0.25, 1.1, 0, 0.5, 1, 0]),
    new QuaternionKeyframeTrack('Head.quaternion', [0, 1.5], [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068]),
    new NumberKeyframeTrack('Head_2.morphTargetInfluences', [0, 1.5], [0, 0.25, 1, 0]),
  ]);
}

describe('motion curve serialization', () => {
  it('round-trips a clip exactly (serialize → deserialize → serialize)', () => {
    const first = serializeClip(syntheticClip());
    const second = serializeClip(deserializeClip(first));
    expect(second).toEqual(first);
  });

  it('serializes track type, times, and float32-exact values', () => {
    const data = serializeClip(syntheticClip());
    expect(data.formatVersion).toBe(1);
    expect(data.name).toBe('Synthetic');
    expect(data.duration).toBe(1.5);
    expect(data.tracks.map((track) => track.type)).toEqual(['vector', 'quaternion', 'number']);
    expect(data.tracks[0].times).toEqual([0, 0.75, 1.5]);
    expect(data.tracks[1].values).toEqual([0, 0, 0, 1, 0, Math.fround(0.7071068), 0, Math.fround(0.7071068)]);
  });

  it('deserializes into the correct three track classes', () => {
    const clip = deserializeClip(serializeClip(syntheticClip()));
    expect(clip.tracks[0]).toBeInstanceOf(VectorKeyframeTrack);
    expect(clip.tracks[1]).toBeInstanceOf(QuaternionKeyframeTrack);
    expect(clip.tracks[2]).toBeInstanceOf(NumberKeyframeTrack);
    expect(clip.duration).toBe(1.5);
  });

  it('rejects an unknown track type', () => {
    const bad = { formatVersion: 1, name: 'X', duration: 1, tracks: [{ name: 'A.scale', type: 'matrix', times: [0], values: [1] }] } as unknown as MotionCurves;
    expect(() => deserializeClip(bad)).toThrow(/track type/i);
  });
});
