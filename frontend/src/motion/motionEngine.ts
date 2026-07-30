// frontend/src/motion/motionEngine.ts
/**
 * The web's ONE user-facing motion engine (v2): the parity-proven Java kernel
 * (motionEngineCore primitives) with three deliberate, separately-graded
 * divergences, each pinned by the scorecard + golden vectors:
 *   1. overall = (pose*0.65 + timing*0.20 + coverage*0.15) * coverage/100  — guards
 *      tiny-overlap false accusations without the old harmonic mean's full-coverage inflation.
 *   2. (Task 4) position de-weighted 0.42 -> 0.25 toward rotation (handoff finding 7).
 *   3. (Task 5) banded DTW replaces lockstep sampling; warp-aware timing composite.
 *   4. (Issue #16) mirror canonicalization: the pair is scored in both orientations and the
 *      better one kept, because a mirrored copy moves the performance across joints and every
 *      score here is computed per joint by name. Reported via `mirrored` on the result.
 * compareNormalized in motionEngineCore stays parity-locked to Java — v2 composes
 * its exported primitives and NEVER changes them.
 */
import type { NormalizedAnimationJson } from './normalizedMotion';
import {
  type NormalizedJointScore, type NormalizedVerdict, type PoseBlendWeights, type PoseSample, type PoseDelta,
  canonicalCurvesEqual, poseDelta, round, sample, trackMetadataPercent, tracks,
} from './motionEngineCore';
import { mirrorNormalized } from './mirrorCanonical';

export const ENGINE_V2_VERSION = 'creatorflow.motion-comparison/v2-web';

/** Finding 7: absolute position partly measures rig identity; de-weight toward rotation. */
export const V2_POSE_WEIGHTS: PoseBlendWeights = { position: 0.25, rotation: 0.65, weight: 0.1 };

export interface MotionEngineOptions {
  sampleCount?: number;
  poseWeights?: PoseBlendWeights;
  /** Off disables the mirrored second orientation (divergence 4). Default on. */
  mirrorAware?: boolean;
}

/** The band `verdictFor` calls HIGH_SIMILARITY, named because mirror short-circuiting reads it. */
const HIGH_SIMILARITY_PERCENT = 90;

export interface MotionComparisonV2 {
  engineVersion: string;
  overallPercent: number;
  posePercent: number;
  timingPercent: number;
  coveragePercent: number;
  durationPercent: number;
  warpScore: number;
  exactCurveData: boolean;
  verdict: NormalizedVerdict;
  jointScores: NormalizedJointScore[];
  frameScores: Array<{ sampleIndex: number; posePercent: number }>;
  commonJointCount: number;
  allJointCount: number;
  /**
   * True when these numbers come from comparing the candidate MIRRORED.
   *
   * Carried out of the engine rather than kept internal because the product's output is evidence
   * shown to a person, and "these two match" and "these two match once you mirror one of them" are
   * different claims. A caller that ignores this reports the first when it means the second.
   */
  mirrored: boolean;
}

function durationPercentOf(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson): number {
  if (source.duration === 0 && candidate.duration === 0) return 100;
  if (source.duration === 0 || candidate.duration === 0) return 0;
  return (100 * Math.min(source.duration, candidate.duration)) / Math.max(source.duration, candidate.duration);
}

function verdictFor(exact: boolean, overallPercent: number): NormalizedVerdict {
  if (exact) return 'EXACT_CURVE_DATA';
  if (overallPercent >= HIGH_SIMILARITY_PERCENT) return 'HIGH_SIMILARITY';
  if (overallPercent >= 70) return 'MODERATE_SIMILARITY';
  return 'LOW_SIMILARITY';
}

/**
 * Divergence 4 (issue #16): score the pair in both orientations and keep the better.
 *
 * A mirrored copy moves the left limb's performance onto the right limb's joints, and every score
 * below is computed per joint by NAME — so the direct comparison lines the mirrored right arm up
 * against the original right arm and the pose score collapses. It was undetectable on three of the
 * four graded rigs. Neither DTW nor coverage can help: the misalignment is across joints, not time.
 *
 * Taking a maximum over two comparisons can only RAISE scores, so it can only add false positives,
 * never remove one — which runs straight at this product's standing constraint that a false
 * accusation is the worst output it can produce. Three things hold that down:
 *
 *   1. `mirrorNormalized` returns null unless the clip has real left/right joint pairs, so an
 *      unmirrorable clip gets one comparison, not a free second draw at the maximum.
 *   2. An already-decided pair short-circuits. Exact curve data, or a direct score already in the
 *      HIGH band, needs no second orientation — the verdict cannot improve, so the extra work and
 *      the extra draw are both skipped. The number reported is then the direct one.
 *   3. It is graded. The cost of this change is the negatives' false-positive rate in
 *      `scorecard.baseline.json`, not the mirror recall it recovers.
 *
 * The mirror model itself is approximate (see `mirrorCanonical.ts`) — it inverts the same
 * simplified reflection the fixtures are generated from, so treat the recovered mirror recall as
 * partly self-fulfilling and the false-positive number as the real result.
 */
export function compareMotion(
  source: NormalizedAnimationJson,
  candidate: NormalizedAnimationJson,
  options: MotionEngineOptions = {},
): MotionComparisonV2 {
  const direct = compareOriented(source, candidate, options);
  if (options.mirrorAware === false) return direct;
  // Band by verdict, not by re-comparing the ROUNDED overall against 90: verdictFor saw the
  // unrounded value, and an 89.996 that rounds to 90.00 must not skip the orientation that could
  // genuinely decide it.
  if (direct.exactCurveData || direct.verdict === 'HIGH_SIMILARITY') return direct;
  const mirroredCandidate = mirrorNormalized(candidate, source);
  if (!mirroredCandidate) return direct;
  const mirrored = compareOriented(source, mirroredCandidate, options);
  if (mirrored.overallPercent <= direct.overallPercent) return direct;
  /**
   * A perfect mirror is NOT exact curve data.
   *
   * The canonical-equality check inside the mirrored comparison sees source vs mirror(candidate) —
   * and because the reflection is a bitwise-exact inverse of the mirroring transform, a cleanly
   * mirrored copy comes back canonically EQUAL there. Passing that through as
   * exactCurveData/EXACT_CURVE_DATA would be a byte-identity claim about a pair whose bytes are
   * not identical: 14 of the 19 mirror fixtures did exactly that before this guard. Exactness is a
   * statement about what was submitted, so it can only ever come from the direct orientation
   * (which short-circuited above). The scores stand — they are real measurements of the mirrored
   * orientation — but the claim is downgraded to what it is: the strongest possible similarity,
   * found in the mirror.
   */
  return {
    ...mirrored,
    mirrored: true,
    exactCurveData: false,
    verdict: mirrored.exactCurveData ? 'HIGH_SIMILARITY' : mirrored.verdict,
  };
}

function compareOriented(
  source: NormalizedAnimationJson,
  candidate: NormalizedAnimationJson,
  options: MotionEngineOptions,
): MotionComparisonV2 {
  const sampleCount = Math.max(13, Math.round(options.sampleCount ?? 49));
  const weights = options.poseWeights ?? V2_POSE_WEIGHTS;
  const exact = canonicalCurvesEqual(source, candidate);

  const sourceTracks = tracks(source);
  const candidateTracks = tracks(candidate);
  const allJoints = [...new Set([...sourceTracks.keys(), ...candidateTracks.keys()])].sort();
  const commonJoints = [...sourceTracks.keys()].filter((joint) => candidateTracks.has(joint)).sort();
  let coveragePercent = allJoints.length === 0 ? 0 : (100 * commonJoints.length) / allJoints.length;

  // --- Banded DTW over lockstep sample grids (handoff finding 6) ---
  // Cost cell = DISTANCE (1 - posePercent/100), never similarity: DTW minimizes.
  // Duration-aware band: a duration mismatch of fraction f shifts alignment by up to
  // f*(N-1) samples (a 30% inserted hold needs ~23% of the timeline), so the band
  // floors at 12.5% but grows to cover that shift, capped at 35%. Same-duration
  // pairs (all our negatives) keep the tight 12.5% corridor.
  const maxDuration = Math.max(source.duration, candidate.duration);
  const durationShift = maxDuration === 0 ? 0 : Math.abs(source.duration - candidate.duration) / maxDuration;
  const band = Math.min(
    Math.round(0.35 * (sampleCount - 1)),
    Math.max(2, Math.round(0.125 * (sampleCount - 1)), Math.ceil(durationShift * (sampleCount - 1)) + 2),
  );
  const sourceSamples: PoseSample[][] = [];
  const candidateSamples: PoseSample[][] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const normalizedTime = i / (sampleCount - 1);
    sourceSamples.push(commonJoints.map((joint) => sample(sourceTracks.get(joint)!, normalizedTime * source.duration)));
    candidateSamples.push(commonJoints.map((joint) => sample(candidateTracks.get(joint)!, normalizedTime * candidate.duration)));
  }
  const jointCount = commonJoints.length;
  const cellDeltas = (i: number, j: number): PoseDelta[] =>
    sourceSamples[i].map((sourcePose, jointIndex) => poseDelta(sourcePose, candidateSamples[j][jointIndex], weights));
  const cellCost = (deltas: PoseDelta[]): number =>
    jointCount === 0 ? 1 : 1 - deltas.reduce((total, delta) => total + delta.posePercent, 0) / jointCount / 100;

  // DP within the Sakoe-Chiba band.
  // STEP_PENALTY: a small per-transition cost on non-diagonal (up/left) moves. Without it,
  // unweighted DTW is prone to the classic "trivial expansion" pathology: a tiny CONSTANT
  // pose offset (no real timing difference at all) can still look pointwise-cheaper a few
  // samples off the diagonal purely from sampling-grid quantization, so unconstrained DTW
  // drifts the whole path off it for a fraction-of-a-percent gain. STEP_PENALTY prices that
  // drift out (it costs strictly more than the trivial per-cell saving accumulates to) while
  // staying far below the large, sustained per-cell savings a genuine inserted hold produces
  // (see motionEngine.test.ts's 'reports zero warp' vs 'aligns an inserted hold' cases).
  // Measured window (Task 5 review): nearCopy needs >= ~0.05; the synthetic held-sweep
  // gate erodes above ~0.15; real hold fixtures hold to ~0.5. Re-derive if sampleCount,
  // pose weights, or the cost-cell scale change — the constant is coupled to all three.
  const STEP_PENALTY = 0.1;
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(INF));
  const accumulated: number[][] = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(INF));
  for (let i = 0; i < sampleCount; i += 1) {
    for (let j = Math.max(0, i - band); j <= Math.min(sampleCount - 1, i + band); j += 1) {
      cost[i][j] = cellCost(cellDeltas(i, j));
    }
  }
  accumulated[0][0] = cost[0][0];
  for (let i = 0; i < sampleCount; i += 1) {
    for (let j = Math.max(0, i - band); j <= Math.min(sampleCount - 1, i + band); j += 1) {
      if (i === 0 && j === 0) continue;
      const diag = i > 0 && j > 0 ? accumulated[i - 1][j - 1] : INF;
      const up = i > 0 ? accumulated[i - 1][j] + STEP_PENALTY : INF;
      const left = j > 0 ? accumulated[i][j - 1] + STEP_PENALTY : INF;
      accumulated[i][j] = cost[i][j] + Math.min(diag, up, left);
    }
  }
  // Backtrack (diag preferred on ties -> deterministic), collecting the path.
  const path: Array<[number, number]> = [];
  let pi = sampleCount - 1;
  let pj = sampleCount - 1;
  while (pi > 0 || pj > 0) {
    path.push([pi, pj]);
    const diag = pi > 0 && pj > 0 ? accumulated[pi - 1][pj - 1] : INF;
    const up = pi > 0 ? accumulated[pi - 1][pj] + STEP_PENALTY : INF;
    const left = pj > 0 ? accumulated[pi][pj - 1] + STEP_PENALTY : INF;
    if (diag <= up && diag <= left) { pi -= 1; pj -= 1; }
    else if (up <= left) { pi -= 1; }
    else { pj -= 1; }
  }
  path.push([0, 0]);
  path.reverse();
  const pathLength = path.length;
  const meanWarp = path.reduce((total, [i, j]) => total + Math.abs(i - j), 0) / pathLength;
  const warpScoreRaw = 100 * Math.max(0, 1 - meanWarp / band);

  // Per-joint + per-frame aggregation along the ALIGNED path.
  const perJoint = new Map<string, { poseTotal: number; positionTotal: number; rotationTotal: number; maxPosition: number; maxRotation: number }>();
  for (const joint of commonJoints) perJoint.set(joint, { poseTotal: 0, positionTotal: 0, rotationTotal: 0, maxPosition: 0, maxRotation: 0 });
  const frameTotals = Array(sampleCount).fill(0);
  const frameCounts = Array(sampleCount).fill(0);
  for (const [i, j] of path) {
    const deltas = cellDeltas(i, j);
    let cellTotal = 0;
    deltas.forEach((delta, jointIndex) => {
      const acc = perJoint.get(commonJoints[jointIndex])!;
      acc.poseTotal += delta.posePercent;
      acc.positionTotal += delta.positionDelta;
      acc.rotationTotal += delta.rotationDelta;
      acc.maxPosition = Math.max(acc.maxPosition, delta.positionDelta);
      acc.maxRotation = Math.max(acc.maxRotation, delta.rotationDelta);
      cellTotal += delta.posePercent;
    });
    frameTotals[i] += jointCount === 0 ? 0 : cellTotal / jointCount;
    frameCounts[i] += 1;
  }
  const frameScores = frameTotals.map((total, index) => ({
    sampleIndex: index,
    posePercent: round(frameCounts[index] ? total / frameCounts[index] : 0, 2),
  }));

  const jointScores: NormalizedJointScore[] = [];
  let poseTotal = 0;
  for (const joint of allJoints) {
    const inSource = sourceTracks.has(joint);
    const inCandidate = candidateTracks.has(joint);
    if (!inSource || !inCandidate) {
      jointScores.push({ jointPath: joint, presentInSource: inSource, presentInCandidate: inCandidate, posePercent: 0, meanPositionDelta: 0, maxPositionDelta: 0, meanRotationDeltaDegrees: 0, maxRotationDeltaDegrees: 0 });
      continue;
    }
    const acc = perJoint.get(joint)!;
    const metadataPercent = trackMetadataPercent(sourceTracks.get(joint)!, candidateTracks.get(joint)!);
    const jointPercent = (acc.poseTotal / pathLength) * 0.96 + metadataPercent * 0.04;
    poseTotal += jointPercent;
    jointScores.push({
      jointPath: joint,
      presentInSource: true,
      presentInCandidate: true,
      posePercent: round(jointPercent, 2),
      meanPositionDelta: round(acc.positionTotal / pathLength, 6),
      maxPositionDelta: round(acc.maxPosition, 6),
      meanRotationDeltaDegrees: round((acc.rotationTotal / pathLength) * (180 / Math.PI), 3),
      maxRotationDeltaDegrees: round(acc.maxRotation * (180 / Math.PI), 3),
    });
  }

  let posePercent = commonJoints.length === 0 ? 0 : poseTotal / commonJoints.length;
  const durationPercent = durationPercentOf(source, candidate);
  const warpScore = warpScoreRaw;
  let timing = durationPercent * 0.5 + warpScore * 0.5;

  let overallPercent = ((posePercent * 0.65 + timing * 0.2 + coveragePercent * 0.15) * coveragePercent) / 100;
  if (exact) {
    posePercent = 100;
    timing = 100;
    coveragePercent = 100;
    overallPercent = 100;
  }

  return {
    engineVersion: ENGINE_V2_VERSION,
    overallPercent: round(overallPercent, 2),
    posePercent: round(posePercent, 2),
    timingPercent: round(timing, 2),
    coveragePercent: round(coveragePercent, 2),
    durationPercent: round(durationPercent, 2),
    warpScore: round(warpScore, 2),
    exactCurveData: exact,
    verdict: verdictFor(exact, overallPercent),
    jointScores,
    frameScores,
    commonJointCount: commonJoints.length,
    allJointCount: allJoints.length,
    mirrored: false,
  };
}
