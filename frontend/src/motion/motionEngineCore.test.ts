/**
 * First-principles unit tests for the fiddly corners of the Java port.
 * These pin hand-computed values so a transcription slip fails HERE with a
 * readable message; full behavioral proof against Java lives in
 * parity/motionParity.test.ts (Task 3).
 */
import { describe, expect, it } from 'vitest';
import type { NormalizedAnimationJson, NormalizedKeyframeJson, NormalizedPoseJson } from './normalizedMotion';
import { ALGORITHM_VERSION, compareNormalized } from './motionEngineCore';

const IDENTITY_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function pose(jointPath: string, x: number, yawDegrees: number, overrides: Partial<NormalizedPoseJson> = {}): NormalizedPoseJson {
  const angle = (yawDegrees * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    jointPath,
    transform: [x, 0, 0, cosine, 0, sine, 0, 1, 0, -sine, 0, cosine],
    weight: 1,
    easingStyle: 'Linear',
    easingDirection: 'InOut',
    ...overrides,
  };
}

function keyframe(time: number, ...poses: NormalizedPoseJson[]): NormalizedKeyframeJson {
  return { time, poses };
}

function animation(assetId: string, duration: number, ...keyframes: NormalizedKeyframeJson[]): NormalizedAnimationJson {
  return { assetId, name: assetId, duration, looped: false, priority: 'Movement', keyframes };
}

describe('exact curve detection (canonical, not SHA)', () => {
  it('treats reordered frames and poses as exact, and overrides all percents to 100', () => {
    const hip0 = pose('Root/Hip', 0, 0);
    const arm0 = pose('Root/Hip/Arm', 0, 0);
    const hip1 = pose('Root/Hip', 0.1, 20);
    const arm1 = pose('Root/Hip/Arm', 0, -35);
    const ordered = animation('100', 1, { time: 0, poses: [hip0, arm0] }, { time: 1, poses: [hip1, arm1] });
    const reversed = animation('200', 1, { time: 1, poses: [arm1, hip1] }, { time: 0, poses: [arm0, hip0] });
    const result = compareNormalized(ordered, reversed);
    expect(result.exactCurveData).toBe(true);
    expect(result.verdict).toBe('EXACT_CURVE_DATA');
    expect(result.overallPercent).toBe(100);
    expect(result.posePercent).toBe(100);
    expect(result.timingPercent).toBe(100);
    expect(result.coveragePercent).toBe(100);
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(result.frameScores).toHaveLength(49);
  });

  it('normalizes -0 to +0 (Java appendDouble) and stays case-SENSITIVE on easing strings', () => {
    const plus = animation('100', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0.5, 0)));
    const minus = animation('200', 1, keyframe(-0, pose('Root/Hip', -0, 0)), keyframe(1, pose('Root/Hip', 0.5, 0)));
    expect(compareNormalized(plus, minus).exactCurveData).toBe(true);

    const upper = animation('300', 1, keyframe(0, pose('Root/Hip', 0, 0, { easingStyle: 'LINEAR' })), keyframe(1, pose('Root/Hip', 0.5, 0, { easingStyle: 'LINEAR' })));
    expect(compareNormalized(plus, upper).exactCurveData).toBe(false);
  });
});

describe('pose delta kernels (hand-computed)', () => {
  it('scores a pure position offset with the exponential position kernel', () => {
    // Same rotation, position differs by exactly 1.0 at every sample:
    // positionPercent = 100*exp(-2.25*1) = 10.5399...; rotationPercent = 100; weightPercent = 100
    // posePercent per sample = 0.42*10.5399 + 0.50*100 + 0.08*100 = 62.4268
    // jointPercent = 62.4268*0.96 + 100*0.04 = 63.9297 -> posePercent (rounded 2) = 63.93
    const source = animation('100', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 0)));
    const candidate = animation('200', 1, keyframe(0, pose('Root/Hip', 1, 0)), keyframe(1, pose('Root/Hip', 1, 0)));
    const result = compareNormalized(source, candidate);
    expect(result.posePercent).toBeCloseTo(63.93, 2);
    expect(result.jointScores[0].meanPositionDelta).toBeCloseTo(1, 6);
    expect(result.jointScores[0].maxPositionDelta).toBeCloseTo(1, 6);
  });

  it('scores a pure rotation offset with the exponential rotation kernel', () => {
    // 90° yaw difference at every sample: rotationDelta = pi/2
    // rotationPercent = 100*exp(-1.8*pi/2) = 5.9165...; positionPercent = 100; weight = 100
    // posePercent = 0.42*100 + 0.50*5.9165 + 0.08*100 = 52.9582
    // jointPercent = 52.9582*0.96 + 4 = 54.8399 -> 54.84
    const source = animation('100', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 0)));
    const candidate = animation('200', 1, keyframe(0, pose('Root/Hip', 0, 90)), keyframe(1, pose('Root/Hip', 0, 90)));
    const result = compareNormalized(source, candidate);
    expect(result.posePercent).toBeCloseTo(54.84, 2);
    expect(result.jointScores[0].meanRotationDeltaDegrees).toBeCloseTo(90, 3);
    expect(result.jointScores[0].maxRotationDeltaDegrees).toBeCloseTo(90, 3);
  });

  it('scores a weight difference linearly', () => {
    // weight 1 vs 0.4: weightPercent = 100*(1-0.6) = 40
    // posePercent = 0.42*100 + 0.50*100 + 0.08*40 = 95.2; jointPercent = 95.2*0.96 + 4 = 95.392 -> 95.39
    const source = animation('100', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 0)));
    const candidate = animation('200', 1, keyframe(0, pose('Root/Hip', 0, 0, { weight: 0.4 })), keyframe(1, pose('Root/Hip', 0, 0, { weight: 0.4 })));
    expect(compareNormalized(source, candidate).posePercent).toBeCloseTo(95.39, 2);
  });
});

describe('quaternion from rotation matrix — all four branches agree with the rotation angle', () => {
  // For each rotation R, compare(R vs identity) must report exactly the rotation's angle.
  const cases: Array<[string, number[], number]> = [
    ['trace>0 small yaw', rotationYaw(30), 30],
    ['m00-dominant 180 about x', [1, 0, 0, 0, -1, 0, 0, 0, -1], 180],
    ['m11-dominant 180 about y', [-1, 0, 0, 0, 1, 0, 0, 0, -1], 180],
    ['else-branch 180 about z', [-1, 0, 0, 0, -1, 0, 0, 0, 1], 180],
  ];
  function rotationYaw(deg: number): number[] {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  }
  it.each(cases)('%s', (_name, rotation, expectedDegrees) => {
    const withRotation: NormalizedPoseJson = { jointPath: 'Root/Hip', transform: [0, 0, 0, ...rotation], weight: 1, easingStyle: 'Linear', easingDirection: 'InOut' };
    const identity: NormalizedPoseJson = { jointPath: 'Root/Hip', transform: [0, 0, 0, ...IDENTITY_ROTATION], weight: 1, easingStyle: 'Linear', easingDirection: 'InOut' };
    const source = animation('100', 1, keyframe(0, identity), keyframe(1, identity));
    const candidate = animation('200', 1, keyframe(0, withRotation), keyframe(1, withRotation));
    const result = compareNormalized(source, candidate);
    expect(result.jointScores[0].meanRotationDeltaDegrees).toBeCloseTo(expectedDegrees, 3);
  });
});

describe('timing, coverage, verdict plumbing', () => {
  it('handles the zero-duration edges of timingPercent', () => {
    const zero = animation('100', 0, keyframe(0, pose('Root/Hip', 0, 0)));
    const zero2 = animation('200', 0, keyframe(0, pose('Root/Hip', 0.4, 10)));
    const nonzero = animation('300', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 0)));
    // both zero: durationPercent=100, patternPercent=100 (all times normalize to 0), countPercent varies
    const bothZero = compareNormalized(zero, zero2);
    expect(bothZero.timingPercent).toBeCloseTo(0.45 * 100 + 0.4 * 100 + 0.15 * 100, 2);
    // one zero: durationPercent=0
    const oneZero = compareNormalized(zero, nonzero);
    // durationPercent=0; source times [0], candidate [0,1] -> samples=2, quantile pairs (0,0),(0,1): meanDiff=0.5
    // patternPercent = 100*max(0, 1-0.5*2.5) = 0; countPercent = 100*1/2 = 50
    expect(oneZero.timingPercent).toBeCloseTo(0 * 0.45 + 0 * 0.4 + 50 * 0.15, 2);
  });

  it('computes coverage from the sorted union of joints and zero-fills missing-joint scores', () => {
    const source = animation('100', 1,
      keyframe(0, pose('Root/Hip', 0, 0), pose('Root/Hip/Arm', 0, 0)),
      keyframe(1, pose('Root/Hip', 0, 10), pose('Root/Hip/Arm', 0, 10)));
    const candidate = animation('200', 1,
      keyframe(0, pose('Root/Hip', 0, 0), pose('Root/Leg', 0, 0)),
      keyframe(1, pose('Root/Hip', 0, 10), pose('Root/Leg', 0, 10)));
    const result = compareNormalized(source, candidate);
    expect(result.coveragePercent).toBeCloseTo((100 * 1) / 3, 2);
    expect(result.jointScores.map((score) => score.jointPath)).toEqual(['Root/Hip', 'Root/Hip/Arm', 'Root/Leg']);
    const armScore = result.jointScores[1];
    expect(armScore.presentInSource).toBe(true);
    expect(armScore.presentInCandidate).toBe(false);
    expect(armScore.posePercent).toBe(0);
  });

  it('maps overall percent to the 90/70 verdict bands', () => {
    const base = animation('100', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 40)));
    const near = animation('200', 1, keyframe(0, pose('Root/Hip', 0, 2)), keyframe(1, pose('Root/Hip', 0, 42)));
    const far = animation('300', 1, keyframe(0, pose('Root/Hip', 3, 170)), keyframe(1, pose('Root/Hip', 3, 130)));
    expect(compareNormalized(base, near).verdict).toBe('HIGH_SIMILARITY');
    expect(compareNormalized(base, far).verdict).toBe('LOW_SIMILARITY');
  });

  it('uses the quantile index for mismatched keyframe counts (metadata + timing)', () => {
    // 2 keys vs 3 keys with matching easing: countPercent(metadata) = 100*2/3
    // metadataPercent = 100*0.8 + (200/3)*0.2 = 93.3333 -> jointPercent = poseMean*0.96 + 93.3333*0.04
    const source = animation('100', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 0)));
    const candidate = animation('200', 1, keyframe(0, pose('Root/Hip', 0, 0)), keyframe(0.5, pose('Root/Hip', 0, 0)), keyframe(1, pose('Root/Hip', 0, 0)));
    const result = compareNormalized(source, candidate);
    // poseMean = 100 (identical sampled poses) -> jointPercent = 96 + 3.7333 = 99.7333 -> 99.73
    expect(result.posePercent).toBeCloseTo(99.73, 2);
  });
});
