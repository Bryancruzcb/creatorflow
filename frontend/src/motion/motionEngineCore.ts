/**
 * Faithful TypeScript port of core/src/main/java/creatorflow/motion/MotionComparisonEngine.java.
 * PORT CONTRACT: match Java line-for-line — same constants, same iteration order (TreeMap =
 * code-unit-sorted keys), same rounding (floor(x+0.5), identical in Java and JS), same branch
 * structure. Do NOT improve the algorithm here; Phase 1b changes are separately graded.
 * Exact-match detection replaces Java's SHA fingerprint with canonical deep equality carrying
 * the same semantics (frames sorted by time, poses sorted by jointPath, -0 normalized to +0,
 * easing strings case-SENSITIVE). Parity is proven by parity/motionParity.test.ts.
 */
import type { NormalizedAnimationJson, NormalizedKeyframeJson, NormalizedPoseJson } from './normalizedMotion';

export const ALGORITHM_VERSION = 'creatorflow.motion-comparison/v1';

const SAMPLE_COUNT = 49;
const POSITION_DECAY = 2.25;
const ROTATION_DECAY = 1.8;

export type NormalizedVerdict = 'EXACT_CURVE_DATA' | 'HIGH_SIMILARITY' | 'MODERATE_SIMILARITY' | 'LOW_SIMILARITY';

export interface NormalizedJointScore {
  jointPath: string;
  presentInSource: boolean;
  presentInCandidate: boolean;
  posePercent: number;
  meanPositionDelta: number;
  maxPositionDelta: number;
  meanRotationDeltaDegrees: number;
  maxRotationDeltaDegrees: number;
}

export interface NormalizedFrameScore {
  sampleIndex: number;
  normalizedTime: number;
  sourceTime: number;
  candidateTime: number;
  posePercent: number;
  comparedJointCount: number;
}

export interface NormalizedComparisonResult {
  algorithmVersion: string;
  sourceAssetId: string;
  candidateAssetId: string;
  overallPercent: number;
  posePercent: number;
  timingPercent: number;
  coveragePercent: number;
  exactCurveData: boolean;
  verdict: NormalizedVerdict;
  jointScores: NormalizedJointScore[];
  frameScores: NormalizedFrameScore[];
  limitations: string[];
}

interface Vector3 { x: number; y: number; z: number }
interface Quaternion { w: number; x: number; y: number; z: number }
interface TrackKey {
  time: number;
  position: Vector3;
  rotation: Quaternion;
  weight: number;
  easingStyle: string;
  easingDirection: string;
}
interface PoseSample { position: Vector3; rotation: Quaternion; weight: number }
interface PoseDelta { posePercent: number; positionDelta: number; rotationDelta: number }

const canonicalZero = (value: number) => (value === 0 ? 0 : value);

function sortedFrames(animation: NormalizedAnimationJson): NormalizedKeyframeJson[] {
  return [...animation.keyframes].sort((left, right) => left.time - right.time);
}

function sortedPoses(frame: NormalizedKeyframeJson): NormalizedPoseJson[] {
  return [...frame.poses].sort((left, right) => (left.jointPath < right.jointPath ? -1 : left.jointPath > right.jointPath ? 1 : 0));
}

/** Java fingerprint equality without the SHA: same canonicalization, structural compare. */
function canonicalCurvesEqual(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson): boolean {
  if (canonicalZero(source.duration) !== canonicalZero(candidate.duration)) return false;
  const sourceFrames = sortedFrames(source);
  const candidateFrames = sortedFrames(candidate);
  if (sourceFrames.length !== candidateFrames.length) return false;
  for (let i = 0; i < sourceFrames.length; i += 1) {
    if (canonicalZero(sourceFrames[i].time) !== canonicalZero(candidateFrames[i].time)) return false;
    const sourcePoses = sortedPoses(sourceFrames[i]);
    const candidatePoses = sortedPoses(candidateFrames[i]);
    if (sourcePoses.length !== candidatePoses.length) return false;
    for (let j = 0; j < sourcePoses.length; j += 1) {
      const a = sourcePoses[j];
      const b = candidatePoses[j];
      if (a.jointPath !== b.jointPath) return false;
      for (let k = 0; k < 12; k += 1) {
        if (canonicalZero(a.transform[k]) !== canonicalZero(b.transform[k])) return false;
      }
      if (canonicalZero(a.weight) !== canonicalZero(b.weight)) return false;
      if (a.easingStyle !== b.easingStyle || a.easingDirection !== b.easingDirection) return false;
    }
  }
  return true;
}

function quatNormalized(q: Quaternion): Quaternion {
  const length = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  return { w: q.w / length, x: q.x / length, y: q.y / length, z: q.z / length };
}

function quatFromRotationMatrix(values: number[]): Quaternion {
  const m00 = values[3];
  const m01 = values[4];
  const m02 = values[5];
  const m10 = values[6];
  const m11 = values[7];
  const m12 = values[8];
  const m20 = values[9];
  const m21 = values[10];
  const m22 = values[11];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return quatNormalized({ w, x, y, z });
}

function quatDot(a: Quaternion, b: Quaternion): number {
  return a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
}

function quatSlerp(a: Quaternion, b: Quaternion, fraction: number): Quaternion {
  let dot = quatDot(a, b);
  let end = b;
  if (dot < 0) {
    dot = -dot;
    end = { w: -b.w, x: -b.x, y: -b.y, z: -b.z };
  }
  dot = Math.max(-1, Math.min(1, dot));
  if (dot > 0.9995) {
    return quatNormalized({
      w: a.w + (end.w - a.w) * fraction,
      x: a.x + (end.x - a.x) * fraction,
      y: a.y + (end.y - a.y) * fraction,
      z: a.z + (end.z - a.z) * fraction,
    });
  }
  const angle = Math.acos(dot);
  const sinAngle = Math.sin(angle);
  const leftWeight = Math.sin((1 - fraction) * angle) / sinAngle;
  const rightWeight = Math.sin(fraction * angle) / sinAngle;
  return quatNormalized({
    w: a.w * leftWeight + end.w * rightWeight,
    x: a.x * leftWeight + end.x * rightWeight,
    y: a.y * leftWeight + end.y * rightWeight,
    z: a.z * leftWeight + end.z * rightWeight,
  });
}

function quatAngleTo(a: Quaternion, b: Quaternion): number {
  const dot = Math.abs(quatDot(a, b));
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function vectorLerp(a: Vector3, b: Vector3, fraction: number): Vector3 {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction };
}

function vectorDistance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Java tracks(): TreeMap<jointPath, TrackKey[]> built from time-sorted frames. */
function tracks(animation: NormalizedAnimationJson): Map<string, TrackKey[]> {
  const byJoint = new Map<string, TrackKey[]>();
  for (const frame of sortedFrames(animation)) {
    for (const pose of frame.poses) {
      const key: TrackKey = {
        time: frame.time,
        position: { x: pose.transform[0], y: pose.transform[1], z: pose.transform[2] },
        rotation: quatFromRotationMatrix(pose.transform),
        weight: pose.weight,
        easingStyle: pose.easingStyle,
        easingDirection: pose.easingDirection,
      };
      const list = byJoint.get(pose.jointPath);
      if (list) list.push(key);
      else byJoint.set(pose.jointPath, [key]);
    }
  }
  // TreeMap iteration order = code-unit-sorted keys.
  return new Map([...byJoint.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)));
}

function toSample(key: TrackKey): PoseSample {
  return { position: key.position, rotation: key.rotation, weight: key.weight };
}

function sample(track: TrackKey[], time: number): PoseSample {
  if (track.length === 1 || time <= track[0].time) return toSample(track[0]);
  if (time >= track[track.length - 1].time) return toSample(track[track.length - 1]);
  let high = 1;
  while (track[high].time < time) high += 1;
  const left = track[high - 1];
  const right = track[high];
  const span = right.time - left.time;
  const fraction = span === 0 ? 0 : (time - left.time) / span;
  return {
    position: vectorLerp(left.position, right.position, fraction),
    rotation: quatSlerp(left.rotation, right.rotation, fraction),
    weight: left.weight + (right.weight - left.weight) * fraction,
  };
}

function poseDelta(source: PoseSample, candidate: PoseSample): PoseDelta {
  const positionDelta = vectorDistance(source.position, candidate.position);
  const rotationDelta = quatAngleTo(source.rotation, candidate.rotation);
  const weightDelta = Math.abs(source.weight - candidate.weight);
  const positionPercent = 100 * Math.exp(-POSITION_DECAY * positionDelta);
  const rotationPercent = 100 * Math.exp(-ROTATION_DECAY * rotationDelta);
  const weightPercent = 100 * Math.max(0, 1 - weightDelta);
  const posePercent = positionPercent * 0.42 + rotationPercent * 0.5 + weightPercent * 0.08;
  return { posePercent, positionDelta, rotationDelta };
}

function quantileIndex(sampleIdx: number, sampleCount: number, valueCount: number): number {
  if (sampleCount <= 1 || valueCount <= 1) return 0;
  return Math.round((sampleIdx * (valueCount - 1)) / (sampleCount - 1));
}

function trackMetadataPercent(source: TrackKey[], candidate: TrackKey[]): number {
  const samples = Math.max(source.length, candidate.length);
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const left = source[quantileIndex(i, samples, source.length)];
    const right = candidate[quantileIndex(i, samples, candidate.length)];
    const style = left.easingStyle.toLowerCase() === right.easingStyle.toLowerCase() ? 100 : 0;
    const direction = left.easingDirection.toLowerCase() === right.easingDirection.toLowerCase() ? 100 : 0;
    total += (style + direction) / 2;
  }
  const countPercent = (100 * Math.min(source.length, candidate.length)) / Math.max(source.length, candidate.length);
  return (total / samples) * 0.8 + countPercent * 0.2;
}

function normalizedFrameTimes(animation: NormalizedAnimationJson): number[] {
  if (animation.duration === 0) return sortedFrames(animation).map(() => 0);
  return sortedFrames(animation).map((frame) => frame.time / animation.duration);
}

function timingPercent(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson): number {
  let durationPercent: number;
  if (source.duration === 0 && candidate.duration === 0) durationPercent = 100;
  else if (source.duration === 0 || candidate.duration === 0) durationPercent = 0;
  else durationPercent = (100 * Math.min(source.duration, candidate.duration)) / Math.max(source.duration, candidate.duration);

  const sourceTimes = normalizedFrameTimes(source);
  const candidateTimes = normalizedFrameTimes(candidate);
  const samples = Math.max(sourceTimes.length, candidateTimes.length);
  let difference = 0;
  for (let i = 0; i < samples; i += 1) {
    const left = sourceTimes[quantileIndex(i, samples, sourceTimes.length)];
    const right = candidateTimes[quantileIndex(i, samples, candidateTimes.length)];
    difference += Math.abs(left - right);
  }
  const meanDifference = difference / samples;
  const patternPercent = 100 * Math.max(0, 1 - meanDifference * 2.5);
  const countPercent = (100 * Math.min(sourceTimes.length, candidateTimes.length)) / Math.max(sourceTimes.length, candidateTimes.length);
  return durationPercent * 0.45 + patternPercent * 0.4 + countPercent * 0.15;
}

function round(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function verdictFor(exact: boolean, overallPercent: number): NormalizedVerdict {
  if (exact) return 'EXACT_CURVE_DATA';
  if (overallPercent >= 90) return 'HIGH_SIMILARITY';
  if (overallPercent >= 70) return 'MODERATE_SIMILARITY';
  return 'LOW_SIMILARITY';
}

class JointAccumulator {
  private poseTotal = 0;
  private positionTotal = 0;
  private rotationTotal = 0;
  maxPositionDelta = 0;
  maxRotationDelta = 0;
  private count = 0;

  add(delta: PoseDelta): void {
    this.poseTotal += delta.posePercent;
    this.positionTotal += delta.positionDelta;
    this.rotationTotal += delta.rotationDelta;
    this.maxPositionDelta = Math.max(this.maxPositionDelta, delta.positionDelta);
    this.maxRotationDelta = Math.max(this.maxRotationDelta, delta.rotationDelta);
    this.count += 1;
  }

  meanPosePercent(): number { return this.count === 0 ? 0 : this.poseTotal / this.count; }
  meanPositionDelta(): number { return this.count === 0 ? 0 : this.positionTotal / this.count; }
  meanRotationDelta(): number { return this.count === 0 ? 0 : this.rotationTotal / this.count; }
}

export function compareNormalized(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson): NormalizedComparisonResult {
  const exact = canonicalCurvesEqual(source, candidate);

  const sourceTracks = tracks(source);
  const candidateTracks = tracks(candidate);
  const allJoints = [...new Set([...sourceTracks.keys(), ...candidateTracks.keys()])].sort();
  const commonJoints = [...sourceTracks.keys()].filter((joint) => candidateTracks.has(joint)).sort();

  let coveragePercent = allJoints.length === 0 ? 0 : (100 * commonJoints.length) / allJoints.length;

  const accumulators = new Map<string, JointAccumulator>();
  for (const joint of commonJoints) accumulators.set(joint, new JointAccumulator());

  const frameScores: NormalizedFrameScore[] = [];
  for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
    const normalizedTime = sampleIndex / (SAMPLE_COUNT - 1);
    const sourceTime = normalizedTime * source.duration;
    const candidateTime = normalizedTime * candidate.duration;
    let frameTotal = 0;
    for (const joint of commonJoints) {
      const delta = poseDelta(
        sample(sourceTracks.get(joint)!, sourceTime),
        sample(candidateTracks.get(joint)!, candidateTime),
      );
      accumulators.get(joint)!.add(delta);
      frameTotal += delta.posePercent;
    }
    const framePercent = commonJoints.length === 0 ? 0 : frameTotal / commonJoints.length;
    frameScores.push({
      sampleIndex,
      normalizedTime: round(normalizedTime, 6),
      sourceTime: round(sourceTime, 6),
      candidateTime: round(candidateTime, 6),
      posePercent: round(framePercent, 2),
      comparedJointCount: commonJoints.length,
    });
  }

  const jointScores: NormalizedJointScore[] = [];
  let poseTotal = 0;
  for (const joint of allJoints) {
    const inSource = sourceTracks.has(joint);
    const inCandidate = candidateTracks.has(joint);
    if (!inSource || !inCandidate) {
      jointScores.push({
        jointPath: joint,
        presentInSource: inSource,
        presentInCandidate: inCandidate,
        posePercent: 0,
        meanPositionDelta: 0,
        maxPositionDelta: 0,
        meanRotationDeltaDegrees: 0,
        maxRotationDeltaDegrees: 0,
      });
      continue;
    }
    const accumulator = accumulators.get(joint)!;
    const metadataPercent = trackMetadataPercent(sourceTracks.get(joint)!, candidateTracks.get(joint)!);
    const jointPercent = accumulator.meanPosePercent() * 0.96 + metadataPercent * 0.04;
    poseTotal += jointPercent;
    jointScores.push({
      jointPath: joint,
      presentInSource: true,
      presentInCandidate: true,
      posePercent: round(jointPercent, 2),
      meanPositionDelta: round(accumulator.meanPositionDelta(), 6),
      maxPositionDelta: round(accumulator.maxPositionDelta, 6),
      meanRotationDeltaDegrees: round((accumulator.meanRotationDelta() * 180) / Math.PI, 3),
      maxRotationDeltaDegrees: round((accumulator.maxRotationDelta * 180) / Math.PI, 3),
    });
  }

  let posePercent = commonJoints.length === 0 ? 0 : poseTotal / commonJoints.length;
  let timing = timingPercent(source, candidate);
  let overallPercent = posePercent * 0.65 + timing * 0.2 + coveragePercent * 0.15;

  if (exact) {
    posePercent = 100;
    timing = 100;
    coveragePercent = 100;
    overallPercent = 100;
  }

  return {
    algorithmVersion: ALGORITHM_VERSION,
    sourceAssetId: source.assetId,
    candidateAssetId: candidate.assetId,
    overallPercent: round(overallPercent, 2),
    posePercent: round(posePercent, 2),
    timingPercent: round(timing, 2),
    coveragePercent: round(coveragePercent, 2),
    exactCurveData: exact,
    verdict: verdictFor(exact, overallPercent),
    jointScores,
    frameScores,
    limitations: [
      'Similarity is evidence, not a determination of ownership or infringement.',
      'Transforms are compared in local joint space; rig retargeting is not inferred.',
      'Easing metadata is fingerprinted and lightly scored; interpolation uses linear position and quaternion slerp.',
    ],
  };
}
