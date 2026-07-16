// frontend/src/motion/testset/derivations.test.ts
import { describe, expect, it } from 'vitest';
import type { MotionCurves } from '../motionCurves';
import { deserializeClip } from '../motionCurves';
import {
  buildMirrorNameSwapper, insertHold, mirrorClip, relocateRoot, rescalePositions, retimeUniform, reupload,
} from './derivations';

function baseClip(): MotionCurves {
  return {
    formatVersion: 1,
    name: 'Base',
    duration: 2,
    tracks: [
      { name: 'Body.position', type: 'vector', times: [0, 1, 2], values: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { name: 'ArmL.quaternion', type: 'quaternion', times: [0, 2], values: [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068] },
      { name: 'Head_2.morphTargetInfluences', type: 'number', times: [0, 2], values: [0, 1] },
    ],
  };
}

describe('derivations are pure', () => {
  it('never mutates the input clip', () => {
    const clip = baseClip();
    const frozen = JSON.stringify(clip);
    reupload(clip);
    retimeUniform(clip, 0.8);
    insertHold(clip, 0.4, 0.3);
    rescalePositions(clip, 1.25);
    relocateRoot(clip, 'Body', [3, 0, 2]);
    mirrorClip(clip, buildMirrorNameSwapper(['Body', 'ArmL', 'ArmR', 'Head_2']));
    expect(JSON.stringify(clip)).toBe(frozen);
  });
});

describe('reupload', () => {
  it('is an exact curve copy under a new name', () => {
    const copy = reupload(baseClip());
    expect(copy.name).not.toBe('Base');
    expect(copy.tracks).toEqual(baseClip().tracks);
    expect(copy.duration).toBe(2);
  });
});

describe('retimeUniform', () => {
  it('scales times and duration, leaves values untouched', () => {
    const fast = retimeUniform(baseClip(), 0.8);
    expect(fast.duration).toBeCloseTo(1.6, 12);
    expect(fast.tracks[0].times).toEqual([0, 0.8, 1.6]);
    expect(fast.tracks[0].values).toEqual(baseClip().tracks[0].values);
  });
});

describe('insertHold', () => {
  it('inserts a value plateau and extends the duration', () => {
    const held = insertHold(baseClip(), 0.5, 0.25); // hold at t=1 for 0.5s
    expect(held.duration).toBeCloseTo(2.5, 12);
    const track = deserializeClip(held).tracks[0];
    const interpolant = (track as unknown as { createInterpolant: () => { evaluate: (t: number) => ArrayLike<number> } }).createInterpolant();
    expect(Array.from(interpolant.evaluate(1)).slice(0, 3)).toEqual([4, 5, 6]);
    expect(Array.from(interpolant.evaluate(1.5)).slice(0, 3)).toEqual([4, 5, 6]);   // still held
    expect(Array.from(interpolant.evaluate(2.5)).slice(0, 3)).toEqual([7, 8, 9]);   // shifted tail
  });

  it('replaces a key landing exactly on the hold point with the plateau pair', () => {
    const held = insertHold(baseClip(), 0.5, 0.25);
    const times = held.tracks[0].times;
    expect(times).toEqual([0, 1, 1.5, 2.5]);
    expect(new Set(times).size).toBe(times.length);
  });
});

describe('rescalePositions', () => {
  it('scales only vector position tracks', () => {
    const scaled = rescalePositions(baseClip(), 2);
    expect(scaled.tracks[0].values).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(scaled.tracks[1].values).toEqual(baseClip().tracks[1].values);
    expect(scaled.tracks[2].values).toEqual(baseClip().tracks[2].values);
  });
});

describe('relocateRoot', () => {
  it('offsets only the root joint position track', () => {
    const moved = relocateRoot(baseClip(), 'Body', [10, 0, -1]);
    expect(moved.tracks[0].values).toEqual([11, 2, 2, 14, 5, 5, 17, 8, 8]);
    expect(moved.tracks[1].values).toEqual(baseClip().tracks[1].values);
  });

  it('throws when the root track is missing (never emit a mislabeled positive)', () => {
    expect(() => relocateRoot(baseClip(), 'Pelvis', [1, 0, 0])).toThrow(/Pelvis/);
  });
});

describe('mirror', () => {
  const nodes = ['Body', 'Head_2', 'ArmL', 'ArmR', 'b_LeftLeg01_015', 'b_RightLeg01_019'];

  it('builds an involutive swap for both rig naming styles', () => {
    const swap = buildMirrorNameSwapper(nodes);
    expect(swap('ArmL.quaternion')).toBe('ArmR.quaternion');
    expect(swap('b_RightLeg01_019.quaternion')).toBe('b_LeftLeg01_015.quaternion');
    expect(swap('Body.position')).toBe('Body.position');
    for (const node of nodes) {
      const once = swap(`${node}.quaternion`);
      expect(swap(once)).toBe(`${node}.quaternion`);
    }
  });

  it('negates position x and quaternion y/z, leaves morph weights alone', () => {
    const mirrored = mirrorClip(baseClip(), buildMirrorNameSwapper(nodes));
    expect(mirrored.tracks[0].values).toEqual([-1, 2, 3, -4, 5, 6, -7, 8, 9]);
    expect(mirrored.tracks[1].name).toBe('ArmR.quaternion');
    expect(mirrored.tracks[1].values).toEqual([0, 0, 0, 1, 0, -0.7071068, 0, 0.7071068]);
    expect(mirrored.tracks[2].values).toEqual([0, 1]);
  });

  it('is an exact involution (mirror twice = original curves)', () => {
    const swap = buildMirrorNameSwapper(nodes);
    const twice = mirrorClip(mirrorClip(baseClip(), swap), swap);
    expect(twice.tracks.map(({ name, type, times, values }) => ({ name, type, times, values })))
      .toEqual(baseClip().tracks);
  });
});
