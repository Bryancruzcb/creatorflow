// frontend/src/motion/clipToNormalized.ts
/**
 * Lossy adapter: three.js AnimationClip -> the normalized shape the ported engine
 * compares. This layer has NO Java counterpart and is deliberately not held to
 * parity — it is graded on the Phase 0 copy-detection scorecard instead.
 * Losses (documented, accepted for the current engine): morph-target tracks are
 * dropped (Roblox KeyframeSequences have no blendshape concept), scale tracks are
 * dropped, weight/easing are synthesized as 1.0/Linear/InOut, and jointPath is the
 * three node name (no hierarchy path) — consistent on both sides of every web
 * comparison because both clips pass through this same adapter.
 */
import type { AnimationClip, KeyframeTrack } from 'three';
import type { NormalizedAnimationJson, NormalizedKeyframeJson, NormalizedPoseJson } from './normalizedMotion';

interface ChannelPair {
  position?: KeyframeTrack;
  quaternion?: KeyframeTrack;
}

type Interpolant = { evaluate: (time: number) => ArrayLike<number> };

const createInterpolant = (track: KeyframeTrack): Interpolant =>
  (track as KeyframeTrack & { createInterpolant: () => Interpolant }).createInterpolant();

function clampedEvaluate(track: KeyframeTrack, interpolant: Interpolant, time: number, size: number): number[] {
  const first = track.times[0] ?? 0;
  const last = track.times[track.times.length - 1] ?? first;
  const clamped = Math.max(first, Math.min(last, time));
  return Array.from(interpolant.evaluate(clamped)).slice(0, size);
}

/** Row-major 3x3 rotation from a normalized quaternion in three's (x,y,z,w) order. */
function rotationRowMajor(x: number, y: number, z: number, w: number): number[] {
  const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  const qx = x / length;
  const qy = y / length;
  const qz = z / length;
  const qw = w / length;
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy),
  ];
}

export function clipToNormalized(clip: AnimationClip, assetId?: string): NormalizedAnimationJson {
  const channels = new Map<string, ChannelPair>();
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot <= 0) continue;
    const node = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    if (property !== 'position' && property !== 'quaternion') continue;
    const pair = channels.get(node) ?? {};
    pair[property] = track;
    channels.set(node, pair);
  }

  const posesByTime = new Map<number, NormalizedPoseJson[]>();
  const nodes = [...channels.keys()].sort();
  for (const node of nodes) {
    const pair = channels.get(node)!;
    const times = [...new Set([
      ...(pair.position ? Array.from(pair.position.times) : []),
      ...(pair.quaternion ? Array.from(pair.quaternion.times) : []),
    ])].sort((left, right) => left - right);
    const positionInterpolant = pair.position ? createInterpolant(pair.position) : null;
    const quaternionInterpolant = pair.quaternion ? createInterpolant(pair.quaternion) : null;
    for (const time of times) {
      const position = pair.position && positionInterpolant
        ? clampedEvaluate(pair.position, positionInterpolant, time, 3)
        : [0, 0, 0];
      const quaternion = pair.quaternion && quaternionInterpolant
        ? clampedEvaluate(pair.quaternion, quaternionInterpolant, time, 4)
        : [0, 0, 0, 1];
      const pose: NormalizedPoseJson = {
        jointPath: node,
        transform: [position[0], position[1], position[2], ...rotationRowMajor(quaternion[0], quaternion[1], quaternion[2], quaternion[3])],
        weight: 1,
        easingStyle: 'Linear',
        easingDirection: 'InOut',
      };
      const bucket = posesByTime.get(time);
      if (bucket) bucket.push(pose);
      else posesByTime.set(time, [pose]);
    }
  }

  const keyframes: NormalizedKeyframeJson[] = [...posesByTime.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([time, poses]) => ({ time, poses }));

  return {
    assetId: assetId ?? clip.name,
    name: clip.name,
    duration: clip.duration,
    looped: false,
    priority: 'Unknown',
    keyframes,
  };
}
