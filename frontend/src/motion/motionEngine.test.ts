// frontend/src/motion/motionEngine.test.ts
import { describe, expect, it } from 'vitest';
import type { NormalizedAnimationJson, NormalizedKeyframeJson, NormalizedPoseJson } from './normalizedMotion';
import { compareMotion } from './motionEngine';

function pose(jointPath: string, x: number, yawDegrees: number): NormalizedPoseJson {
  const angle = (yawDegrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { jointPath, transform: [x, 0, 0, c, 0, s, 0, 1, 0, -s, 0, c], weight: 1, easingStyle: 'Linear', easingDirection: 'InOut' };
}
const keyframe = (time: number, ...poses: NormalizedPoseJson[]): NormalizedKeyframeJson => ({ time, poses });
const animation = (assetId: string, duration: number, ...keyframes: NormalizedKeyframeJson[]): NormalizedAnimationJson =>
  ({ assetId, name: assetId, duration, looped: false, priority: 'Movement', keyframes });

describe('compareMotion (v2) — composition stage', () => {
  const walk = (id: string) => animation(id, 1,
    keyframe(0, pose('Root/Hip', 0, 0)), keyframe(0.5, pose('Root/Hip', 0.25, 35)), keyframe(1, pose('Root/Hip', 0, 70)));

  it('keeps the composition anchored to the Java blend at full coverage', () => {
    const source = walk('100');
    const candidate = animation('200', 1,
      keyframe(0, pose('Root/Hip', 0, 0)), keyframe(0.5, pose('Root/Hip', 0.9, 120)), keyframe(1, pose('Root/Hip', 0, 70)));
    const v2 = compareMotion(source, candidate);
    expect(v2.coveragePercent).toBe(100);
    const blend = v2.posePercent * 0.65 + v2.timingPercent * 0.2 + v2.coveragePercent * 0.15;
    expect(v2.overallPercent).toBeCloseTo(blend, 1); // coverage/100 = 1 -> attenuation is identity
  });

  it('annihilates tiny-overlap scores instead of promoting them (the false-accusation guard)', () => {
    // 1 shared joint of 21 total: pose/timing 100, coverage ~4.76 -> overall ~4.76, LOW verdict
    const sharedPose = (id: string) => keyframe(0, pose('Root/Hip', 0, 0));
    const sharedPose2 = (id: string) => keyframe(1, pose('Root/Hip', 0.2, 30));
    const withExtras = (id: string, prefix: string) => animation(id, 1,
      { time: 0, poses: [pose('Root/Hip', 0, 0), ...Array.from({ length: 10 }, (_, i) => pose(`${prefix}${i}`, 0, 10))] },
      { time: 1, poses: [pose('Root/Hip', 0.2, 30), ...Array.from({ length: 10 }, (_, i) => pose(`${prefix}${i}`, 0, 40))] });
    const result = compareMotion(withExtras('100', 'SourceOnly'), withExtras('200', 'CandidateOnly'));
    expect(result.coveragePercent).toBeCloseTo(100 / 21, 1);
    expect(result.overallPercent).toBeLessThan(10);
    expect(result.verdict).toBe('LOW_SIMILARITY');
  });

  it('does not inflate at full coverage the way the old harmonic mean did', () => {
    const source = walk('100');
    const candidate = animation('200', 1,
      keyframe(0, pose('Root/Hip', 0, 15)), keyframe(0.5, pose('Root/Hip', 0.25, 50)), keyframe(1, pose('Root/Hip', 0, 85)));
    const v2 = compareMotion(source, candidate);
    // overall must never exceed the Java blend when coverage is 100 (harmonic would)
    expect(v2.overallPercent).toBeLessThanOrEqual(v2.posePercent * 0.65 + v2.timingPercent * 0.2 + 15 + 0.01);
  });

  it('keeps exact-curve recognition and the 100 override', () => {
    const result = compareMotion(walk('100'), walk('200'));
    expect(result.exactCurveData).toBe(true);
    expect(result.verdict).toBe('EXACT_CURVE_DATA');
    expect(result.overallPercent).toBe(100);
  });
});

describe('compareMotion (v2) — de-weight stage', () => {
  it('applies the de-weighted kernel by default (finding 7)', () => {
    const still = (id: string, x: number, yaw: number) => animation(id, 1,
      keyframe(0, pose('Root/Hip', x, yaw)), keyframe(1, pose('Root/Hip', x, yaw)));
    // Pure position offset of 1.0: position kernel now contributes 0.25:
    // pose = 0.25*10.5399 + 0.65*100 + 0.10*100 = 77.635 -> *0.96 + 4 = 78.53
    // (under Java weights this is 63.93 — the assertion below fails pre-de-weight, TDD-proving the swap)
    const positionOnly = compareMotion(still('100', 0, 0), still('200', 1, 0));
    expect(positionOnly.posePercent).toBeCloseTo(78.53, 1);
    // Pure 90-degree rotation offset drops further under the heavier rotation weight:
    // pose = 0.25*100 + 0.65*5.9165 + 0.10*100 = 38.85 -> *0.96 + 4 = 41.29
    const rotationOnly = compareMotion(still('100', 0, 0), still('200', 0, 90));
    expect(rotationOnly.posePercent).toBeCloseTo(41.29, 1);
  });
});

describe('compareMotion (v2) — banded DTW stage', () => {
  const posesAt = (yaw: number) => pose('Root/Hip', 0, yaw);
  /** A clip whose yaw sweeps 0..90 with an inserted hold between 40% and 70% of the timeline. */
  const heldSweep = (id: string) => animation(id, 1.3,
    keyframe(0, posesAt(0)), keyframe(0.4, posesAt(36)), keyframe(0.7, posesAt(36)), keyframe(1.3, posesAt(90)));
  const sweep = (id: string) => animation(id, 1,
    keyframe(0, posesAt(0)), keyframe(0.4, posesAt(36)), keyframe(1, posesAt(90)));

  it('aligns an inserted hold elastically instead of punishing the lockstep misalignment', () => {
    const dtw = compareMotion(sweep('100'), heldSweep('200'));
    // Lockstep at these samples misaligns the post-hold sweep; DTW re-aligns it.
    expect(dtw.posePercent).toBeGreaterThan(97);
    expect(dtw.warpScore).toBeLessThan(100);   // the alignment cost shows up as warp, not pose damage
    expect(dtw.verdict).toBe('HIGH_SIMILARITY');
  });

  it('reports zero warp and full timing for identical timelines', () => {
    const result = compareMotion(sweep('100'), sweep('200'));
    expect(result.exactCurveData).toBe(true);   // identical curves
    const nearCopy = compareMotion(sweep('100'), animation('300', 1,
      keyframe(0, posesAt(1)), keyframe(0.4, posesAt(37)), keyframe(1, posesAt(91))));
    expect(nearCopy.warpScore).toBe(100);
    expect(nearCopy.timingPercent).toBe(100);
  });

  it('stays deterministic: two runs produce identical results', () => {
    const first = compareMotion(sweep('100'), heldSweep('200'));
    const second = compareMotion(sweep('100'), heldSweep('200'));
    expect(second).toEqual(first);
  });
});
