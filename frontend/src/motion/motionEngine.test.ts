// frontend/src/motion/motionEngine.test.ts
import { describe, expect, it } from 'vitest';
import type { NormalizedAnimationJson, NormalizedKeyframeJson, NormalizedPoseJson } from './normalizedMotion';
import { compareNormalized } from './motionEngineCore';
import { compareMotion, ENGINE_V2_VERSION } from './motionEngine';

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

  it('is byte-identical to the parity core at full coverage (composition only bites below 100)', () => {
    // NOTE: Task 4 updates this test to pass { poseWeights: JAVA_POSE_WEIGHTS } explicitly;
    // Task 5 replaces it with the DTW-era variant (see those tasks) — it is stage-scoped.
    const source = walk('100');
    const candidate = animation('200', 1,
      keyframe(0, pose('Root/Hip', 0, 0)), keyframe(0.5, pose('Root/Hip', 0.9, 120)), keyframe(1, pose('Root/Hip', 0, 70)));
    const v1 = compareNormalized(source, candidate);
    const v2 = compareMotion(source, candidate);
    expect(v2.engineVersion).toBe(ENGINE_V2_VERSION);
    expect(v2.posePercent).toBe(v1.posePercent);            // same kernel, same lockstep in this stage
    expect(v2.timingPercent).toBe(v1.timingPercent);
    expect(v2.coveragePercent).toBe(v1.coveragePercent);
    expect(v2.coveragePercent).toBe(100);
    expect(v2.overallPercent).toBe(v1.overallPercent);      // (0.65p+0.2t+0.15c)*c/100 === Java overall at c=100
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
