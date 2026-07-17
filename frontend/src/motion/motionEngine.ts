// frontend/src/motion/motionEngine.ts
/**
 * The web's ONE user-facing motion engine (v2): the parity-proven Java kernel
 * (motionEngineCore primitives) with three deliberate, separately-graded
 * divergences, each pinned by the scorecard + golden vectors:
 *   1. overall = (pose*0.65 + timing*0.20 + coverage*0.15) * coverage/100  — guards
 *      tiny-overlap false accusations without the old harmonic mean's full-coverage inflation.
 *   2. (Task 4) position de-weighted 0.42 -> 0.25 toward rotation (handoff finding 7).
 *   3. (Task 5) banded DTW replaces lockstep sampling; warp-aware timing composite.
 * compareNormalized in motionEngineCore stays parity-locked to Java — v2 composes
 * its exported primitives and NEVER changes them.
 */
import type { NormalizedAnimationJson } from './normalizedMotion';
import {
  type NormalizedJointScore, type NormalizedVerdict, type PoseBlendWeights,
  canonicalCurvesEqual, poseDelta, round, sample, trackMetadataPercent, tracks,
  timingPercent as javaTimingPercent,
} from './motionEngineCore';

export const ENGINE_V2_VERSION = 'creatorflow.motion-comparison/v2-web';

/** Finding 7: absolute position partly measures rig identity; de-weight toward rotation. */
export const V2_POSE_WEIGHTS: PoseBlendWeights = { position: 0.25, rotation: 0.65, weight: 0.1 };

export interface MotionEngineOptions {
  sampleCount?: number;
  poseWeights?: PoseBlendWeights;
}

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
}

function durationPercentOf(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson): number {
  if (source.duration === 0 && candidate.duration === 0) return 100;
  if (source.duration === 0 || candidate.duration === 0) return 0;
  return (100 * Math.min(source.duration, candidate.duration)) / Math.max(source.duration, candidate.duration);
}

function verdictFor(exact: boolean, overallPercent: number): NormalizedVerdict {
  if (exact) return 'EXACT_CURVE_DATA';
  if (overallPercent >= 90) return 'HIGH_SIMILARITY';
  if (overallPercent >= 70) return 'MODERATE_SIMILARITY';
  return 'LOW_SIMILARITY';
}

export function compareMotion(
  source: NormalizedAnimationJson,
  candidate: NormalizedAnimationJson,
  options: MotionEngineOptions = {},
): MotionComparisonV2 {
  const sampleCount = Math.max(13, Math.round(options.sampleCount ?? 49));
  const weights = options.poseWeights ?? V2_POSE_WEIGHTS;
  const exact = canonicalCurvesEqual(source, candidate);

  const sourceTracks = tracks(source);
  const candidateTracks = tracks(candidate);
  const allJoints = [...new Set([...sourceTracks.keys(), ...candidateTracks.keys()])].sort();
  const commonJoints = [...sourceTracks.keys()].filter((joint) => candidateTracks.has(joint)).sort();
  let coveragePercent = allJoints.length === 0 ? 0 : (100 * commonJoints.length) / allJoints.length;

  // Composition stage: lockstep (i,i) sampling, exactly as the parity core does.
  const perJoint = new Map<string, { poseTotal: number; positionTotal: number; rotationTotal: number; maxPosition: number; maxRotation: number }>();
  for (const joint of commonJoints) perJoint.set(joint, { poseTotal: 0, positionTotal: 0, rotationTotal: 0, maxPosition: 0, maxRotation: 0 });
  const frameScores: Array<{ sampleIndex: number; posePercent: number }> = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const normalizedTime = sampleIndex / (sampleCount - 1);
    const sourceTime = normalizedTime * source.duration;
    const candidateTime = normalizedTime * candidate.duration;
    let frameTotal = 0;
    for (const joint of commonJoints) {
      const delta = poseDelta(sample(sourceTracks.get(joint)!, sourceTime), sample(candidateTracks.get(joint)!, candidateTime), weights);
      const acc = perJoint.get(joint)!;
      acc.poseTotal += delta.posePercent;
      acc.positionTotal += delta.positionDelta;
      acc.rotationTotal += delta.rotationDelta;
      acc.maxPosition = Math.max(acc.maxPosition, delta.positionDelta);
      acc.maxRotation = Math.max(acc.maxRotation, delta.rotationDelta);
      frameTotal += delta.posePercent;
    }
    frameScores.push({ sampleIndex, posePercent: round(commonJoints.length === 0 ? 0 : frameTotal / commonJoints.length, 2) });
  }

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
    const jointPercent = (acc.poseTotal / sampleCount) * 0.96 + metadataPercent * 0.04;
    poseTotal += jointPercent;
    jointScores.push({
      jointPath: joint,
      presentInSource: true,
      presentInCandidate: true,
      posePercent: round(jointPercent, 2),
      meanPositionDelta: round(acc.positionTotal / sampleCount, 6),
      maxPositionDelta: round(acc.maxPosition, 6),
      meanRotationDeltaDegrees: round((acc.rotationTotal / sampleCount) * (180 / Math.PI), 3),
      maxRotationDeltaDegrees: round(acc.maxRotation * (180 / Math.PI), 3),
    });
  }

  let posePercent = commonJoints.length === 0 ? 0 : poseTotal / commonJoints.length;
  const durationPercent = durationPercentOf(source, candidate);
  // Composition stage keeps the Java timing heuristic verbatim via the core export.
  let timing = javaTimingPercent(source, candidate);
  const warpScore = 100; // no warp measured until the DTW stage (Task 5)

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
  };
}
