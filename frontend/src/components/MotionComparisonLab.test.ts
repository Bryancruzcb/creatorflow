import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { compareClips, trailProgress } from './MotionComparisonLab';

function rotationTrack(name: string, middleY = 0.3826834, endY = 0.7071068) {
  return new QuaternionKeyframeTrack(
    name,
    [0, 0.5, 1],
    [
      0, 0, 0, 1,
      0, middleY, 0, Math.sqrt(Math.max(0, 1 - middleY ** 2)),
      0, endY, 0, Math.sqrt(Math.max(0, 1 - endY ** 2)),
    ],
  );
}

function walkClip(name = 'Walk') {
  return new AnimationClip(name, 1, [rotationTrack('bones[Head].quaternion')]);
}

describe('motion comparison', () => {
  it('clamps a previous-pose outline instead of wrapping a one-shot clip to its end', () => {
    expect(trailProgress('shape', 0.02)).toBe(0);
    expect(trailProgress('shape', 0.5)).toBeCloseTo(0.425, 6);
    expect(trailProgress('loop', 1)).toBe(0);
  });

  it('recognizes unchanged canonical curves as an exact motion-shape match', () => {
    const result = compareClips(walkClip(), walkClip('Renamed export'), { mode: 'shape' });

    expect(result.exactCurveData).toBe(true);
    expect(result.primaryValue).toBe(100);
    expect(result.pose).toBe(100);
    expect(result.coverage).toBe(100);
  });

  it('keeps normalized motion shape separate from authored-time drift', () => {
    const source = walkClip();
    const faster = source.clone();
    faster.tracks[0].times = new Float32Array([0, 0.25, 0.5]);
    faster.resetDuration();

    const shape = compareClips(source, faster, { mode: 'shape', sampleCount: 48 });
    const timing = compareClips(source, faster, { mode: 'timing', sampleCount: 48 });

    expect(shape.pose).toBe(100);
    expect(timing.timing).toBeLessThan(shape.pose);
    expect(timing.durationDeltaSeconds).toBeCloseTo(-0.5, 6);
    // v2 cutover: v2's phase-normalized frameScores are uniform 100 for a pure
    // uniform retime, so there IS no within-clip divergence point (the old > 0
    // came from seconds-domain sampling artifacts).
    expect(timing.largestDifferenceTimeSeconds).toBe(0);
  });

  it('filters comparison tracks by joint scope', () => {
    const source = new AnimationClip('Source', 1, [
      rotationTrack('bones[Head].quaternion'),
      rotationTrack('bones[Foot.L].quaternion'),
    ]);
    const candidate = new AnimationClip('Candidate', 1, [
      rotationTrack('bones[Head].quaternion'),
      rotationTrack('bones[Foot.L].quaternion', -0.3826834, -0.7071068),
    ]);

    const full = compareClips(source, candidate, { mode: 'shape', jointScope: 'full' });
    const upper = compareClips(source, candidate, { mode: 'shape', jointScope: 'upper' });

    expect(upper.pose).toBe(100);
    expect(upper.commonTracks).toBe(1);
    expect(upper.sourceKeys).toBe(3);
    expect(upper.candidateKeys).toBe(3);
    expect(full.pose).toBeLessThan(upper.pose);
    expect(full.commonTracks).toBe(2);
    expect(full.sourceKeys).toBe(6);
  });

  it('measures loop continuity as quality instead of a provenance threshold', () => {
    const clean = new AnimationClip('Clean loop', 1, [new VectorKeyframeTrack(
      'Body.position',
      [0, 0.25, 0.5, 0.75, 1],
      [0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0],
    )]);
    const reversingAtSeam = new AnimationClip('Reversing seam', 1, [new VectorKeyframeTrack(
      'Body.position',
      [0, 0.5, 1],
      [0, 0, 0, 1, 0, 0, 0, 0, 0],
    )]);

    const cleanResult = compareClips(clean, clean.clone(), { mode: 'loop', reviewThreshold: 50 });
    const seamResult = compareClips(clean, reversingAtSeam, { mode: 'loop', reviewThreshold: 100 });

    expect(cleanResult.loop?.candidate.continuity).toBe(100);
    expect(cleanResult.tone).not.toBe('blocked');
    expect(seamResult.loop?.candidate.poseClosure).toBe(100);
    expect(seamResult.loop?.candidate.velocityContinuity).toBeLessThan(100);
    expect(seamResult.loop?.candidate.continuity).toBeLessThan(100);
    expect(seamResult.primaryLabel).toBe('Candidate loop continuity');
  });

  it('does not promote a tiny shared-track overlap into a strong relationship', () => {
    const shared = rotationTrack('bones[Head].quaternion');
    const source = new AnimationClip('Source', 1, [shared, ...Array.from({ length: 20 }, (_, index) => rotationTrack(`SourceOnly${index}.quaternion`))]);
    const candidate = new AnimationClip('Candidate', 1, [shared.clone(), ...Array.from({ length: 20 }, (_, index) => rotationTrack(`CandidateOnly${index}.quaternion`))]);

    const result = compareClips(source, candidate, { mode: 'shape', reviewThreshold: 85 });

    expect(result.pose).toBe(100);
    expect(result.coverage).toBeLessThan(5);
    expect(result.primaryValue).toBeLessThan(10);
    expect(result.tone).toBe('neutral');
  });

  it('compares root translation as a separate path signal', () => {
    const makeRootClip = (name: string, lateral = 0) => new AnimationClip(name, 1, [new VectorKeyframeTrack(
      'Body.position',
      [0, 0.5, 1],
      [0, 0, 0, 1, 0.25, lateral, 2, 0, lateral],
    )]);

    const exact = compareClips(makeRootClip('Source'), makeRootClip('Candidate'), { mode: 'root', sampleCount: 24 });
    const drifted = compareClips(makeRootClip('Source'), makeRootClip('Candidate', 1), { mode: 'root', sampleCount: 24 });

    expect(exact.root?.available).toBe(true);
    expect(exact.root?.similarity).toBe(100);
    expect(exact.root?.candidate.displacement).toBeCloseTo(2, 5);
    expect(drifted.root?.similarity).toBeLessThan(100);
    expect(drifted.root?.candidate.drift).toBeGreaterThan(0);
  });

  it('returns an honest unavailable state when root translation is missing', () => {
    const result = compareClips(walkClip(), walkClip('Candidate'), { mode: 'root' });

    expect(result.root?.available).toBe(false);
    expect(result.primaryValue).toBeNull();
    expect(result.verdict).toContain('unavailable');
  });

  it('never mutates either authored clip while analyzing it', () => {
    const source = walkClip();
    const candidate = walkClip('Candidate');
    const before = [
      Array.from(source.tracks[0].times),
      Array.from(source.tracks[0].values),
      Array.from(candidate.tracks[0].times),
      Array.from(candidate.tracks[0].values),
    ];

    compareClips(source, candidate, { mode: 'timing', jointScope: 'upper', sampleCount: 96 });

    expect(Array.from(source.tracks[0].times)).toEqual(before[0]);
    expect(Array.from(source.tracks[0].values)).toEqual(before[1]);
    expect(Array.from(candidate.tracks[0].times)).toEqual(before[2]);
    expect(Array.from(candidate.tracks[0].values)).toEqual(before[3]);
  });
});
