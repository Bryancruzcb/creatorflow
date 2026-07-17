// frontend/src/motion/clipToNormalized.test.ts
import { describe, expect, it } from 'vitest';
import { AnimationClip, Matrix4, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { clipToNormalized } from './clipToNormalized';

function clip(): AnimationClip {
  return new AnimationClip('Walk', 1, [
    new VectorKeyframeTrack('Hip.position', [0, 1], [0, 1, 0, 2, 1, 0]),
    new QuaternionKeyframeTrack('Hip.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0, 0.3826834, 0, 0.9238795, 0, 0.7071068, 0, 0.7071068]),
    new QuaternionKeyframeTrack('Arm.quaternion', [0, 1], [0, 0, 0, 1, 0.7071068, 0, 0, 0.7071068]),
    new NumberKeyframeTrack('Face.morphTargetInfluences', [0, 1], [0, 1]),
  ]);
}

describe('clipToNormalized', () => {
  const normalized = clipToNormalized(clip(), 'asset-1');

  it('carries clip identity and defaults', () => {
    expect(normalized.assetId).toBe('asset-1');
    expect(normalized.name).toBe('Walk');
    expect(normalized.duration).toBe(1);
    expect(normalized.priority).toBe('Unknown');
    for (const frame of normalized.keyframes) {
      for (const pose of frame.poses) {
        expect(pose.weight).toBe(1);
        expect(pose.easingStyle).toBe('Linear');
        expect(pose.easingDirection).toBe('InOut');
      }
    }
  });

  it('drops non-joint tracks (morph targets) and keeps position/quaternion nodes', () => {
    const joints = new Set(normalized.keyframes.flatMap((frame) => frame.poses.map((pose) => pose.jointPath)));
    expect(joints).toEqual(new Set(['Hip', 'Arm']));
  });

  it('emits per-node keyframes at the union of that node\'s channel times, cross-sampling the other channel', () => {
    // Hip: position keys {0,1} + quaternion keys {0,0.5,1} -> Hip poses at 0, 0.5, 1
    const times = normalized.keyframes.map((frame) => frame.time);
    expect(times).toEqual([0, 0.5, 1]);
    const hipAtHalf = normalized.keyframes[1].poses.find((pose) => pose.jointPath === 'Hip')!;
    // position lerped halfway between [0,1,0] and [2,1,0]
    expect(hipAtHalf.transform[0]).toBeCloseTo(1, 6);
    expect(hipAtHalf.transform[1]).toBeCloseTo(1, 6);
    // Arm has no key at 0.5 -> Arm appears only at its own keys
    expect(normalized.keyframes[1].poses.some((pose) => pose.jointPath === 'Arm')).toBe(false);
  });

  it('converts quaternions to the row-major CFrame rotation three itself would build', () => {
    const armAtEnd = normalized.keyframes[2].poses.find((pose) => pose.jointPath === 'Arm')!;
    const quaternion = new Quaternion(0.7071068, 0, 0, 0.7071068).normalize();
    const elements = new Matrix4().makeRotationFromQuaternion(quaternion).elements; // column-major
    const expectedRowMajor = [
      elements[0], elements[4], elements[8],
      elements[1], elements[5], elements[9],
      elements[2], elements[6], elements[10],
    ];
    for (let i = 0; i < 9; i += 1) {
      expect(armAtEnd.transform[3 + i]).toBeCloseTo(expectedRowMajor[i], 7);
    }
  });

  it('is deterministic and pure', () => {
    const first = clipToNormalized(clip(), 'asset-1');
    const second = clipToNormalized(clip(), 'asset-1');
    expect(second).toEqual(first);
  });

  it('produces identical output for identical curve data (reupload -> exact upstream)', () => {
    const original = clipToNormalized(clip(), 'a');
    const reupload = clipToNormalized(clip(), 'b');
    expect(reupload.keyframes).toEqual(original.keyframes);
    expect(reupload.duration).toBe(original.duration);
  });
});
