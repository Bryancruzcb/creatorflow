import { AnimationClip, type KeyframeTrack } from 'three';

import { clipToNormalized } from './clipToNormalized';
import { compareMotion } from './motionEngine';
import { poseDelta, type PoseBlendWeights, type PoseSample } from './motionEngineCore';

export type MotionAnalysisMode = 'shape' | 'timing' | 'loop' | 'root';
export type MotionJointScope = 'full' | 'upper' | 'lower' | 'root';

export interface MotionAnalysisOptions {
  mode?: MotionAnalysisMode;
  jointScope?: MotionJointScope;
  sampleCount?: number;
  reviewThreshold?: number;
}

export interface MotionTrackScore {
  name: string;
  rawName: string;
  score: number;
  worstScore: number;
  worstProgress: number;
}

export interface LoopContinuityResult {
  available: boolean;
  continuity: number | null;
  poseClosure: number | null;
  velocityContinuity: number | null;
  rotationGapDegrees: number;
  positionGap: number;
  tracksAnalyzed: number;
  worstJoints: MotionTrackScore[];
}

export interface RootPathPoint {
  progress: number;
  timeSeconds: number;
  x: number;
  y: number;
  z: number;
}

export interface RootPathClipResult {
  available: boolean;
  trackName: string | null;
  points: RootPathPoint[];
  displacement: number;
  pathLength: number;
  drift: number;
  verticalTravel: number;
}

export interface MotionAnalysisResult {
  mode: MotionAnalysisMode;
  jointScope: MotionJointScope;
  sampleCount: number;
  overall: number;
  pose: number;
  timing: number;
  durationSimilarity: number;
  coverage: number;
  exactCurveData: boolean;
  commonTracks: number;
  sourceTracks: number;
  candidateTracks: number;
  sourceKeys: number;
  candidateKeys: number;
  sourceDuration: number;
  candidateDuration: number;
  durationDeltaSeconds: number;
  frameScores: number[];
  trackScores: MotionTrackScore[];
  largestDifferenceProgress: number;
  largestDifferenceTimeSeconds: number;
  largestDifferenceJoint: string | null;
  primaryLabel: string;
  primaryValue: number | null;
  verdict: string;
  tone: 'blocked' | 'review' | 'neutral';
  loop: {
    source: LoopContinuityResult;
    candidate: LoopContinuityResult;
  } | null;
  root: {
    available: boolean;
    similarity: number | null;
    source: RootPathClipResult;
    candidate: RootPathClipResult;
  } | null;
}

interface PreparedTrack {
  track: KeyframeTrack;
  sample: (time: number) => number[];
}

const ROOT_PATTERN = /(?:^|[\[\]./_-])(humanoidrootpart|root|body|hips?|pelvis)(?:$|[\[\]./_-])/i;
const UPPER_PATTERN = /(?:head|neck|spine|torso|chest|body|shoulder|clavicle|arm|elbow|wrist|hand|thumb|index|middle|ring|finger)/i;
const LOWER_PATTERN = /(?:hip|pelvis|leg|thigh|knee|ankle|foot|toe|pole)/i;

export function motionTrackLabel(name: string) {
  const clean = name
    .replace(/^.*(?:bones\[|\/)/, '')
    .replace(/\].*$/, '')
    .replace(/\.(?:position|translation|quaternion|rotation|scale|morphTargetInfluences|weights).*$/i, '')
    .replace(/^b_/, '')
    .replace(/_\d+$/, '')
    .replaceAll('_', ' ');
  return clean || name;
}

export function trackMatchesJointScope(name: string, scope: MotionJointScope) {
  if (scope === 'full') return true;
  if (scope === 'root') return ROOT_PATTERN.test(name);
  if (scope === 'upper') return UPPER_PATTERN.test(name) && !LOWER_PATTERN.test(name);
  return LOWER_PATTERN.test(name);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function distance(left: ArrayLike<number>, right: ArrayLike<number>, size = Math.min(left.length, right.length)) {
  let total = 0;
  for (let index = 0; index < size; index += 1) total += (left[index] - right[index]) ** 2;
  return Math.sqrt(total);
}

function quaternionAngle(left: ArrayLike<number>, right: ArrayLike<number>) {
  const dot = Math.abs(left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3]);
  return 2 * Math.acos(clamp01(dot));
}

// Velocity continuity has no v2 analog (v2 has no velocity concept) — kept bespoke,
// intra-clip only. Pose-closure similarity (below) has been ported off this curve.
function vectorSimilarity(left: ArrayLike<number>, right: ArrayLike<number>, size: number) {
  let magnitude = 0;
  for (let index = 0; index < size; index += 1) {
    magnitude += Math.max(Math.abs(left[index]), Math.abs(right[index])) ** 2;
  }
  return Math.exp(-distance(left, right, size) / Math.max(0.2, Math.sqrt(magnitude)));
}

// --- Shared v2 pose-distance kernel, reused (never redefined) -------------------------
// loop's pose-closure term and root's per-point score both need "how far apart are these
// two poses," on the SAME fixed-decay scale motionEngineCore.poseDelta/compareMotion use
// for shape/timing — not the old linear-quaternion / self-normalized-exponential math.
// Rather than re-deriving POSITION_DECAY/ROTATION_DECAY here (which could silently drift
// from the v2 kernel over time), this calls poseDelta itself and isolates one channel per
// call via a one-hot weight vector: poseDelta's weighted blend collapses to exactly that
// channel's percent when the other two weights are zero. Parity with poseDelta is pinned
// in motionAnalysis.test.ts.
const KERNEL_POSITION_ONLY: PoseBlendWeights = { position: 1, rotation: 0, weight: 0 };
const KERNEL_ROTATION_ONLY: PoseBlendWeights = { position: 0, rotation: 1, weight: 0 };
const KERNEL_IDENTITY_ROTATION = { w: 1, x: 0, y: 0, z: 0 };
const KERNEL_ORIGIN_POSITION = { x: 0, y: 0, z: 0 };

function kernelPositionSample(values: ArrayLike<number>): PoseSample {
  return { position: { x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 }, rotation: KERNEL_IDENTITY_ROTATION, weight: 0 };
}

function kernelRotationSample(values: ArrayLike<number>): PoseSample {
  // three.js quaternion component order is (x, y, z, w).
  return { position: KERNEL_ORIGIN_POSITION, rotation: { w: values[3] ?? 1, x: values[0] ?? 0, y: values[1] ?? 0, z: values[2] ?? 0 }, weight: 0 };
}

/** Replaces the legacy linear-quaternion / self-normalized-vector pose-closure math for
 * loopContinuity: same fixed-decay kernel v2 uses, applied to one three.js track's
 * start/end sample pair. Returns a 0..1 similarity fraction. */
function kernelTrackSimilarity(name: string, left: ArrayLike<number>, right: ArrayLike<number>, size: number): number {
  if (size === 4 && /(?:quaternion|rotation)/i.test(name)) {
    return poseDelta(kernelRotationSample(left), kernelRotationSample(right), KERNEL_ROTATION_ONLY).posePercent / 100;
  }
  return poseDelta(kernelPositionSample(left), kernelPositionSample(right), KERNEL_POSITION_ONLY).posePercent / 100;
}

/** Same kernel, applied to a root-path sample pair (position-only channel). */
function kernelPointSimilarity(left: Pick<RootPathPoint, 'x' | 'y' | 'z'>, right: Pick<RootPathPoint, 'x' | 'y' | 'z'>): number {
  return poseDelta(
    { position: { x: left.x, y: left.y, z: left.z }, rotation: KERNEL_IDENTITY_ROTATION, weight: 0 },
    { position: { x: right.x, y: right.y, z: right.z }, rotation: KERNEL_IDENTITY_ROTATION, weight: 0 },
    KERNEL_POSITION_ONLY,
  ).posePercent / 100;
}

function prepareTrack(track: KeyframeTrack): PreparedTrack {
  const interpolant = (track as KeyframeTrack & {
    createInterpolant: () => { evaluate: (sampleTime: number) => ArrayLike<number> };
  }).createInterpolant();
  const first = track.times[0] ?? 0;
  const last = track.times[track.times.length - 1] ?? first;
  return {
    track,
    sample: (time) => Array.from(interpolant.evaluate(Math.max(first, Math.min(last, time)))),
  };
}

function arraysMatch(left: ArrayLike<number>, right: ArrayLike<number>, epsilon = 0.000001) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (Math.abs(left[index] - right[index]) > epsilon) return false;
  }
  return true;
}

function exactCurveMatch(source: AnimationClip, candidate: AnimationClip) {
  if (Math.abs(source.duration - candidate.duration) > 0.000001) return false;
  if (source.tracks.length !== candidate.tracks.length) return false;
  const candidateTracks = new Map(candidate.tracks.map((track) => [track.name, track]));
  return source.tracks.every((left) => {
    const right = candidateTracks.get(left.name);
    return Boolean(right && arraysMatch(left.times, right.times) && arraysMatch(left.values, right.values));
  });
}

function quaternionVelocity(start: ArrayLike<number>, end: ArrayLike<number>, deltaSeconds: number) {
  const inverse = [-start[0], -start[1], -start[2], start[3]];
  const relative = [
    inverse[3] * end[0] + inverse[0] * end[3] + inverse[1] * end[2] - inverse[2] * end[1],
    inverse[3] * end[1] - inverse[0] * end[2] + inverse[1] * end[3] + inverse[2] * end[0],
    inverse[3] * end[2] + inverse[0] * end[1] - inverse[1] * end[0] + inverse[2] * end[3],
    inverse[3] * end[3] - inverse[0] * end[0] - inverse[1] * end[1] - inverse[2] * end[2],
  ];
  if (relative[3] < 0) for (let index = 0; index < 4; index += 1) relative[index] *= -1;
  const angle = 2 * Math.acos(clamp01(relative[3]));
  const sine = Math.sqrt(Math.max(0, 1 - relative[3] ** 2));
  if (sine < 0.000001 || angle < 0.000001) return [0, 0, 0];
  const scale = angle / (sine * Math.max(0.000001, deltaSeconds));
  return [relative[0] * scale, relative[1] * scale, relative[2] * scale];
}

function linearVelocity(start: ArrayLike<number>, end: ArrayLike<number>, size: number, deltaSeconds: number) {
  return Array.from({ length: size }, (_, index) => ((end[index] ?? 0) - (start[index] ?? 0)) / Math.max(0.000001, deltaSeconds));
}

function selectedTracks(clip: AnimationClip, scope: MotionJointScope) {
  return clip.tracks.filter((track) => trackMatchesJointScope(track.name, scope));
}

function loopContinuity(clip: AnimationClip, scope: MotionJointScope): LoopContinuityResult {
  const tracks = selectedTracks(clip, scope).map(prepareTrack);
  if (!tracks.length) {
    return {
      available: false,
      continuity: null,
      poseClosure: null,
      velocityContinuity: null,
      rotationGapDegrees: 0,
      positionGap: 0,
      tracksAnalyzed: 0,
      worstJoints: [],
    };
  }

  let rotationTotal = 0;
  let rotationCount = 0;
  let positionTotal = 0;
  let positionCount = 0;
  const poseScores: number[] = [];
  const velocityScores: number[] = [];
  const scores: MotionTrackScore[] = [];
  for (const prepared of tracks) {
    const { track } = prepared;
    const size = track.getValueSize();
    const deltaSeconds = Math.max(0.001, Math.min(clip.duration * 0.04, 0.05));
    const start = prepared.sample(0);
    const afterStart = prepared.sample(deltaSeconds);
    const beforeEnd = prepared.sample(Math.max(0, clip.duration - deltaSeconds));
    const end = prepared.sample(clip.duration);
    const poseSimilarity = kernelTrackSimilarity(track.name, start, end, size);
    const startVelocity = size === 4 && /(?:quaternion|rotation)/i.test(track.name)
      ? quaternionVelocity(start, afterStart, deltaSeconds)
      : linearVelocity(start, afterStart, size, deltaSeconds);
    const endVelocity = size === 4 && /(?:quaternion|rotation)/i.test(track.name)
      ? quaternionVelocity(beforeEnd, end, deltaSeconds)
      : linearVelocity(beforeEnd, end, size, deltaSeconds);
    const velocitySimilarity = vectorSimilarity(startVelocity, endVelocity, Math.min(startVelocity.length, endVelocity.length));
    const similarity = poseSimilarity * 0.72 + velocitySimilarity * 0.28;
    poseScores.push(poseSimilarity);
    velocityScores.push(velocitySimilarity);
    if (size === 4 && /(?:quaternion|rotation)/i.test(track.name)) {
      rotationTotal += quaternionAngle(start, end) * (180 / Math.PI);
      rotationCount += 1;
    } else if (size >= 3 && /(?:position|translation)/i.test(track.name)) {
      positionTotal += distance(start, end, 3);
      positionCount += 1;
    }
    scores.push({
      name: motionTrackLabel(track.name),
      rawName: track.name,
      score: similarity,
      worstScore: similarity,
      worstProgress: 1,
    });
  }

  scores.sort((left, right) => left.score - right.score);
  return {
    available: true,
    continuity: Math.round(average(scores.map((score) => score.score)) * 100),
    poseClosure: Math.round(average(poseScores) * 100),
    velocityContinuity: Math.round(average(velocityScores) * 100),
    rotationGapDegrees: rotationCount ? rotationTotal / rotationCount : 0,
    positionGap: positionCount ? positionTotal / positionCount : 0,
    tracksAnalyzed: tracks.length,
    worstJoints: scores.slice(0, 8),
  };
}

function rootTrackRank(track: KeyframeTrack) {
  if (track.getValueSize() < 3 || !/(?:position|translation)/i.test(track.name)) return Number.POSITIVE_INFINITY;
  if (/humanoidrootpart|rootmotion/i.test(track.name)) return 0;
  if (/(?:^|[\[\]./_-])root(?:$|[\[\]./_-])/i.test(track.name)) return 1;
  if (/(?:body|hips?|pelvis)/i.test(track.name)) return 2;
  return Number.POSITIVE_INFINITY;
}

function findRootTrack(clip: AnimationClip) {
  return [...clip.tracks]
    .map((track) => ({ track, rank: rootTrackRank(track) }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((left, right) => left.rank - right.rank)[0]?.track;
}

function pointDistance(left: RootPathPoint, right: RootPathPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function rootPath(clip: AnimationClip, sampleCount: number): RootPathClipResult {
  const track = findRootTrack(clip);
  if (!track) {
    return {
      available: false,
      trackName: null,
      points: [],
      displacement: 0,
      pathLength: 0,
      drift: 0,
      verticalTravel: 0,
    };
  }

  const prepared = prepareTrack(track);
  const origin = prepared.sample(0);
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const value = prepared.sample(progress * clip.duration);
    return {
      progress,
      timeSeconds: progress * clip.duration,
      x: (value[0] ?? 0) - (origin[0] ?? 0),
      y: (value[1] ?? 0) - (origin[1] ?? 0),
      z: (value[2] ?? 0) - (origin[2] ?? 0),
    };
  });
  const first = points[0];
  const last = points[points.length - 1];
  let pathLength = 0;
  for (let index = 1; index < points.length; index += 1) pathLength += pointDistance(points[index - 1], points[index]);
  const lineLengthSquared = Math.max(0.000001, last.x ** 2 + last.y ** 2 + last.z ** 2);
  const drift = Math.max(...points.map((point) => {
    const projection = clamp01((point.x * last.x + point.y * last.y + point.z * last.z) / lineLengthSquared);
    return Math.hypot(point.x - last.x * projection, point.y - last.y * projection, point.z - last.z * projection);
  }));
  const verticalValues = points.map((point) => point.y);

  return {
    available: true,
    trackName: track.name,
    points,
    displacement: pointDistance(first, last),
    pathLength,
    drift,
    verticalTravel: Math.max(...verticalValues) - Math.min(...verticalValues),
  };
}

function rootComparison(source: RootPathClipResult, candidate: RootPathClipResult) {
  if (!source.available || !candidate.available) return { available: false, similarity: null, frameScores: [] as number[] };
  // Scored with the same fixed-decay v2 kernel as pose-closure (kernelPointSimilarity),
  // not the old self-normalized-by-this-pair's-own-path-size decay. The point sampling
  // itself (rootPath, above) is untouched — it still drives the RootPathPlot visualization
  // unchanged; only the comparison step's math changed.
  const frameScores = source.points.map((point, index) => {
    const other = candidate.points[index] ?? candidate.points[candidate.points.length - 1];
    return kernelPointSimilarity(point, other);
  });
  return { available: true, similarity: Math.round(average(frameScores) * 100), frameScores };
}

function relationshipVerdict(value: number, mode: MotionAnalysisMode, threshold: number) {
  if (mode === 'shape') {
    if (value >= threshold) return 'Strong pose-sequence relationship — review the source';
    if (value >= Math.max(65, threshold - 15)) return 'Some motion shape is shared';
    return 'Motion shapes diverge in this scope';
  }
  if (mode === 'timing') {
    if (value >= threshold) return 'Authored timing stays closely aligned';
    if (value >= Math.max(65, threshold - 15)) return 'Timing drifts through part of the clips';
    return 'Authored timing differs substantially';
  }
  if (mode === 'root') {
    if (value >= threshold) return 'Root trajectories follow a similar path';
    if (value >= Math.max(65, threshold - 15)) return 'Root paths share some travel characteristics';
    return 'Root trajectories diverge';
  }
  return '';
}

export function analyzeMotionClips(
  source: AnimationClip,
  candidate: AnimationClip,
  options: MotionAnalysisOptions = {},
): MotionAnalysisResult {
  const mode = options.mode ?? 'shape';
  const jointScope = options.jointScope ?? 'full';
  const sampleCount = Math.max(12, Math.round(options.sampleCount ?? 48));
  const reviewThreshold = Math.max(50, Math.min(100, options.reviewThreshold ?? 85));
  const scopedSource = selectedTracks(source, jointScope);
  const scopedCandidate = selectedTracks(candidate, jointScope);
  const scopedSourceClip = new AnimationClip(source.name, source.duration, scopedSource);
  const scopedCandidateClip = new AnimationClip(candidate.name, candidate.duration, scopedCandidate);
  const normalizedSource = clipToNormalized(scopedSourceClip, source.name);
  const normalizedCandidate = clipToNormalized(scopedCandidateClip, candidate.name);
  // No-evidence guard (mirrors the ported/tuned adapters): a scope or clip whose
  // tracks all normalize away carries no motion evidence — zeros, never 100/EXACT.
  const v2 = normalizedSource.keyframes.length === 0 || normalizedCandidate.keyframes.length === 0
    ? null
    : compareMotion(normalizedSource, normalizedCandidate, { sampleCount: sampleCount + 1 });
  const pose = v2 ? Math.round(v2.posePercent) : 0;
  const durationSimilarity = v2 ? Math.round(v2.durationPercent) : 0;
  const timing = v2 ? Math.round(v2.timingPercent) : 0;
  const coveragePercent = v2 ? Math.round(v2.coveragePercent) : 0;
  const shapeOverall = v2 ? Math.round(v2.overallPercent) : 0;
  const timingOverall = v2
    ? Math.round(((v2.timingPercent * 0.65 + v2.posePercent * 0.2 + v2.coveragePercent * 0.15) * v2.coveragePercent) / 100)
    : 0;
  const v2FrameScores = v2 ? v2.frameScores.map((frame) => frame.posePercent / 100) : [];
  const v2TrackScores: MotionTrackScore[] = v2
    ? v2.jointScores
      .filter((joint) => joint.presentInSource && joint.presentInCandidate)
      .map((joint) => ({
        name: motionTrackLabel(joint.jointPath),
        rawName: joint.jointPath,
        score: joint.posePercent / 100,
        worstScore: joint.posePercent / 100,
        worstProgress: 0,
      }))
      .sort((left, right) => left.score - right.score)
    : [];
  const sourceNames = new Set(scopedSource.map((track) => track.name));
  const candidateNames = new Set(scopedCandidate.map((track) => track.name));
  const commonNames = [...sourceNames].filter((name) => candidateNames.has(name));
  const exactCurveData = exactCurveMatch(source, candidate);
  const loop = {
    source: loopContinuity(source, jointScope),
    candidate: loopContinuity(candidate, jointScope),
  };
  const rootSource = rootPath(source, sampleCount);
  const rootCandidate = rootPath(candidate, sampleCount);
  const rootRelation = rootComparison(rootSource, rootCandidate);
  const root = {
    available: rootRelation.available,
    similarity: rootRelation.similarity,
    source: rootSource,
    candidate: rootCandidate,
  };

  let frameScores = v2FrameScores;
  let trackScores = v2TrackScores;
  let primaryLabel = mode === 'shape' ? 'Motion-shape relationship' : 'Authored-time relationship';
  let overall = mode === 'shape' ? shapeOverall : timingOverall;
  let primaryValue: number | null = overall;

  if (mode === 'loop') {
    frameScores = [];
    trackScores = loop.candidate.worstJoints;
    primaryLabel = 'Candidate loop continuity';
    primaryValue = loop.candidate.continuity;
    overall = primaryValue ?? 0;
  } else if (mode === 'root') {
    frameScores = rootRelation.frameScores;
    trackScores = [];
    primaryLabel = 'Root-path match';
    primaryValue = root.similarity;
    overall = primaryValue ?? 0;
  }

  let verdict: string;
  let tone: MotionAnalysisResult['tone'] = 'neutral';
  if (mode === 'loop') {
    if (primaryValue === null) verdict = 'No joint tracks are available in this scope';
    else if (primaryValue >= 96) verdict = 'Candidate start and end poses close cleanly';
    else if (primaryValue >= 85) {
      verdict = 'A small loop seam may need cleanup';
      tone = 'review';
    } else {
      verdict = 'A visible loop seam is likely';
      tone = 'review';
    }
  } else if (mode === 'root' && primaryValue === null) {
    verdict = 'Root translation is unavailable for one or both clips';
  } else {
    verdict = relationshipVerdict(primaryValue ?? 0, mode, reviewThreshold);
    if ((primaryValue ?? 0) >= reviewThreshold) tone = 'review';
  }
  if (exactCurveData && mode !== 'loop') tone = 'blocked';

  const lowestFrame = frameScores.length ? Math.min(...frameScores) : 0;
  const lowestIndex = Math.max(0, frameScores.indexOf(lowestFrame));
  const largestDifferenceProgress = frameScores.length > 1 ? lowestIndex / (frameScores.length - 1) : mode === 'loop' ? 1 : 0;
  const authoredWindow = Math.max(source.duration, candidate.duration);

  return {
    mode,
    jointScope,
    sampleCount,
    overall,
    pose,
    timing,
    durationSimilarity,
    coverage: coveragePercent,
    exactCurveData,
    commonTracks: commonNames.length,
    sourceTracks: scopedSource.length,
    candidateTracks: scopedCandidate.length,
    sourceKeys: scopedSource.reduce((total, track) => total + track.times.length, 0),
    candidateKeys: scopedCandidate.reduce((total, track) => total + track.times.length, 0),
    sourceDuration: source.duration,
    candidateDuration: candidate.duration,
    durationDeltaSeconds: candidate.duration - source.duration,
    frameScores,
    trackScores: trackScores.slice(0, 8),
    largestDifferenceProgress,
    largestDifferenceTimeSeconds: largestDifferenceProgress * (mode === 'timing' ? authoredWindow : candidate.duration),
    largestDifferenceJoint: trackScores[0]?.name ?? null,
    primaryLabel,
    primaryValue,
    verdict,
    tone,
    loop,
    root,
  };
}
