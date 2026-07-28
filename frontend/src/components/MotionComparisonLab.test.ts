import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { TRAIL_SPACING, compareClips, trailProgress } from './MotionComparisonLab';

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
  it('never wraps a one-shot clip to its end to manufacture history', () => {
    // Wrapping would look like motion history while asserting the clip loops — false for clips
    // like WalkJump. With no history to show, the member is simply not drawn.
    expect(trailProgress('shape', 0.02)).toBeNull();
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

describe('pose trail spacing', () => {
  it('keeps the original two-argument contract', () => {
    // The single ghost sat one spacing behind; the default must still do exactly that.
    expect(trailProgress('shape', 0.5)).toBeCloseTo(0.425, 6);
  });

  it('spaces members evenly backwards in phase', () => {
    const steps = [1, 2, 3].map((step) => trailProgress('shape', 0.9, step));
    expect(steps).toEqual([0.825, 0.75, 0.675].map((v) => expect.closeTo(v, 6)));
    // strictly receding — every member is behind the one in front of it, none null this far in
    const drawn = steps.filter((step): step is number => step !== null);
    expect(drawn).toHaveLength(3);
    expect(drawn[0]).toBeGreaterThan(drawn[1]);
    expect(drawn[1]).toBeGreaterThan(drawn[2]);
  });

  it('reports no history rather than clamping to the live pose', () => {
    /**
     * This previously asserted `toBe(0)` — it locked in the defect it was written to prevent.
     *
     * Clamping does not put the ghost "at the start": early in playback the live pose is also
     * near the start, so a clamped member lands on top of the rig and reads as "this joint has
     * not moved". With three members all three stacked there for the first 22.5% of the clip.
     * A member with no history must not be drawn at all.
     */
    expect(trailProgress('shape', 0.05, 3)).toBeNull();
    expect(trailProgress('shape', 0.05, 2)).toBeNull();
    expect(trailProgress('shape', 0, 1)).toBeNull();
  });

  it('draws a member as soon as the clip has run far enough to have history', () => {
    // Exactly one spacing in, member 1 has precisely zero history and is the boundary case.
    expect(trailProgress('shape', TRAIL_SPACING, 1)).toBeCloseTo(0, 6);
    expect(trailProgress('shape', TRAIL_SPACING * 1.5, 1)).toBeCloseTo(TRAIL_SPACING * 0.5, 6);
    // Members fill in one at a time as the clip runs, rather than appearing all at once.
    expect([1, 2, 3].map((step) => trailProgress('shape', 0.16, step) !== null)).toEqual([true, true, false]);
  });

  it('pins every member to the start pose in loop mode', () => {
    // Loop mode compares end against start; a lagging trail would answer a different question.
    expect([1, 2, 3].map((step) => trailProgress('loop', 0.6, step))).toEqual([0, 0, 0]);
  });
});
