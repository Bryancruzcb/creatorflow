/**
 * loop/root mode coverage — previously zero (HANDOFF finding #1). Pins:
 *  1. analyzeMotionClips's mode dispatch for 'loop'/'root' (primaryValue tracks the
 *     documented source field, not something that could silently swap).
 *  2. loopContinuity's own shape: poseClosure vs velocityContinuity are independent
 *     signals, and rootPath/rootComparison's shape: displacement/pathLength/drift vs
 *     similarity.
 *  3. Parity: the ported pose-distance component that now backs loop's poseClosure and
 *     root's similarity agrees with motionEngineCore.poseDelta on synthetic cases —
 *     computed dynamically from the same primitive (never hand-copied magic numbers),
 *     the same spirit as parity/motionParity.test.ts.
 * Do not weaken these to "just check a number changed" — the whole point of the parity
 * tests is that the loop/root kernel cannot silently drift from poseDelta again.
 */
import { describe, expect, it } from 'vitest';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { analyzeMotionClips } from './motionAnalysis';
import { poseDelta } from './motionEngineCore';

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

describe('analyzeMotionClips mode dispatch', () => {
  it('routes loop mode primaryValue/overall from loop.candidate.continuity, not a v2 field', () => {
    const clip = new AnimationClip('Loop', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
    const result = analyzeMotionClips(clip, clip.clone(), { mode: 'loop' });

    expect(result.mode).toBe('loop');
    expect(result.primaryValue).toBe(result.loop?.candidate.continuity);
    expect(result.overall).toBe(result.primaryValue);
    expect(result.primaryLabel).toBe('Candidate loop continuity');
    // loop stays a distinct intra-clip signal, never presented as a pose/shape verdict.
    expect(result.verdict).not.toMatch(/relationship|resemblance/i);
  });

  it('routes root mode primaryValue/overall from root.similarity, not a v2 field', () => {
    const makeClip = (name: string) => new AnimationClip(name, 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
    const result = analyzeMotionClips(makeClip('Source'), makeClip('Candidate'), { mode: 'root' });

    expect(result.mode).toBe('root');
    expect(result.primaryValue).toBe(result.root?.similarity);
    expect(result.overall).toBe(result.primaryValue);
    expect(result.primaryLabel).toBe('Root-path match');
  });

  it('still computes loop and root signals for every mode (shape/timing keep their own headline)', () => {
    const clip = new AnimationClip('Body', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
    const result = analyzeMotionClips(clip, clip.clone(), { mode: 'shape' });

    expect(result.loop?.candidate.available).toBe(true);
    expect(result.root?.available).toBe(true);
    expect(result.primaryLabel).not.toBe('Candidate loop continuity');
    expect(result.primaryLabel).not.toBe('Root-path match');
  });
});

describe('loopContinuity (via analyzeMotionClips mode: loop)', () => {
  it('scores a clean position loop (identical start/end pose) at full continuity', () => {
    const clean = new AnimationClip('CleanLoop', 1, [new VectorKeyframeTrack(
      'Body.position',
      [0, 0.5, 1],
      [0, 0, 0, 1, 0, 0, 0, 0, 0],
    )]);
    const result = analyzeMotionClips(clean, clean.clone(), { mode: 'loop' });

    expect(result.loop?.candidate.poseClosure).toBe(100);
    expect(result.loop?.candidate.tracksAnalyzed).toBe(1);
  });

  it('keeps pose-closure and velocity-continuity as independent signals', () => {
    // Start and end pose match exactly (closure=100), but the clip reverses direction
    // right at the seam, so incoming/outgoing velocity disagrees sharply.
    const reversingAtSeam = new AnimationClip('ReversingSeam', 1, [new VectorKeyframeTrack(
      'Body.position',
      [0, 0.5, 1],
      [0, 0, 0, 1, 0, 0, 0, 0, 0],
    )]);
    const result = analyzeMotionClips(reversingAtSeam, reversingAtSeam.clone(), { mode: 'loop' });

    expect(result.loop?.candidate.poseClosure).toBe(100);
    expect(result.loop?.candidate.velocityContinuity).toBeLessThan(100);
    expect(result.loop?.candidate.continuity).toBeLessThan(100);
  });

  it('scores a rotation-track loop using the quaternion branch', () => {
    // 90 degree turn between the clip's start pose and its end pose.
    const rotated = new AnimationClip('RotatedLoop', 1, [new QuaternionKeyframeTrack(
      'Head.quaternion',
      [0, 1],
      [0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2],
    )]);
    const result = analyzeMotionClips(rotated, rotated.clone(), { mode: 'loop' });

    expect(result.loop?.candidate.poseClosure).toBeLessThan(100);
    expect(result.loop?.candidate.rotationGapDegrees).toBeCloseTo(90, 3);
  });

  it('reports unavailable for an empty joint scope instead of a fabricated 100', () => {
    const clip = new AnimationClip('LowerOnly', 1, [new VectorKeyframeTrack('Foot.position', [0, 1], [0, 0, 0, 0, 0, 0])]);
    const result = analyzeMotionClips(clip, clip.clone(), { mode: 'loop', jointScope: 'upper' });

    expect(result.loop?.candidate.available).toBe(false);
    expect(result.loop?.candidate.poseClosure).toBeNull();
  });
});

describe('rootPath / rootComparison (via analyzeMotionClips mode: root)', () => {
  it('scores an identical root path at full similarity with zero drift', () => {
    // A 2-keyframe track is a straight line by construction, so every sampled point along
    // it lies exactly on the line connecting the track's own start/end — drift is 0 for
    // any straight path, independent of the source/candidate comparison.
    const makeClip = (name: string) => new AnimationClip(name, 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 2, 1, 0.5])]);
    const result = analyzeMotionClips(makeClip('Source'), makeClip('Candidate'), { mode: 'root' });

    expect(result.root?.similarity).toBe(100);
    expect(result.root?.candidate.drift).toBeCloseTo(0, 5);
  });

  it('drops similarity and reports positive drift for an offset candidate path', () => {
    // A 3-keyframe path with a lateral bump at the midpoint is not a straight line, so the
    // candidate's own path reports nonzero drift; the lateral offset also lowers similarity.
    const makeClip = (name: string, lateral: number) => new AnimationClip(name, 1, [new VectorKeyframeTrack(
      'Body.position',
      [0, 0.5, 1],
      [0, 0, 0, 1, 0.25, lateral, 2, 0, lateral],
    )]);
    const result = analyzeMotionClips(makeClip('Source', 0), makeClip('Candidate', 1), { mode: 'root' });

    expect(result.root?.similarity).toBeLessThan(100);
    expect(result.root?.candidate.drift).toBeGreaterThan(0);
  });

  it('reports an honest unavailable state when neither clip has a root-pattern track', () => {
    const clip = new AnimationClip('NoRoot', 1, [new QuaternionKeyframeTrack('Head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
    const result = analyzeMotionClips(clip, clip.clone(), { mode: 'root' });

    expect(result.root?.available).toBe(false);
    expect(result.primaryValue).toBeNull();
  });
});

describe('parity: ported pose component agrees with motionEngineCore.poseDelta', () => {
  it('loop poseClosure matches poseDelta on a pure position offset (not the old linear/self-normalized decay)', () => {
    // Start pose (0,0,0), end pose (1,0,0): a distance-1 position offset at the seam.
    const clip = new AnimationClip('OffsetLoop', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 1, 0, 0])]);
    const result = analyzeMotionClips(clip, clip.clone(), { mode: 'loop' });

    const expected = poseDelta(
      { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, weight: 0 },
      { position: { x: 1, y: 0, z: 0 }, rotation: IDENTITY, weight: 0 },
      { position: 1, rotation: 0, weight: 0 },
    ).posePercent;

    expect(result.loop?.candidate.poseClosure).toBe(Math.round(expected));
    // Sanity anchor: v2's exponential decay (POSITION_DECAY=2.25) scores a distance-1 gap
    // far more harshly than the old self-normalized vectorSimilarity ever would have —
    // this pins that the *curve*, not just a coincidental number, changed.
    expect(result.loop?.candidate.poseClosure).toBeLessThan(15);
  });

  it('loop poseClosure matches poseDelta on a pure rotation offset', () => {
    const clip = new AnimationClip('RotatedLoop', 1, [new QuaternionKeyframeTrack(
      'Head.quaternion',
      [0, 1],
      [0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2],
    )]);
    const result = analyzeMotionClips(clip, clip.clone(), { mode: 'loop' });

    const expected = poseDelta(
      { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, weight: 0 },
      { position: { x: 0, y: 0, z: 0 }, rotation: { w: Math.SQRT1_2, x: 0, y: Math.SQRT1_2, z: 0 }, weight: 0 },
      { position: 0, rotation: 1, weight: 0 },
    ).posePercent;

    expect(result.loop?.candidate.poseClosure).toBe(Math.round(expected));
  });

  it('root similarity matches a per-sample poseDelta average, not the old path-size-normalized decay', () => {
    const sampleCount = 12;
    const source = new AnimationClip('Source', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 2, 0, 0])]);
    const candidate = new AnimationClip('Candidate', 1, [new VectorKeyframeTrack('Body.position', [0, 1], [0, 0, 0, 2, 1, 0])]);

    const result = analyzeMotionClips(source, candidate, { mode: 'root', sampleCount });

    // rootPath samples sampleCount points at progress = index/(sampleCount-1) along each
    // clip's own normalized time, relative to each clip's own frame-0 origin. Both tracks
    // here are 2-keyframe linear, so at progress p: source=(2p,0,0), candidate=(2p,p,0).
    const expectedFractions = Array.from({ length: sampleCount }, (_, index) => {
      const progress = index / (sampleCount - 1);
      return poseDelta(
        { position: { x: 2 * progress, y: 0, z: 0 }, rotation: IDENTITY, weight: 0 },
        { position: { x: 2 * progress, y: progress, z: 0 }, rotation: IDENTITY, weight: 0 },
        { position: 1, rotation: 0, weight: 0 },
      ).posePercent / 100;
    });
    const expectedSimilarity = Math.round((expectedFractions.reduce((sum, value) => sum + value, 0) / sampleCount) * 100);

    expect(result.root?.similarity).toBe(expectedSimilarity);
    // Sanity anchor: the old self-normalized-by-path-size decay (dividing by ~2 units of
    // path length) would have scored this drift far more leniently than the fixed v2
    // decay does — pins the kernel swap, not just "some number moved."
    expect(result.root?.similarity).toBeLessThan(90);
  });
});
