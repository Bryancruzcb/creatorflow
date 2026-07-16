// frontend/src/motion/testset/derivations.ts
/**
 * Labeled copy-detection derivations. Every function is pure and deterministic —
 * the derived clip IS the label, so a transform that cannot be produced honestly
 * must throw rather than emit a dubious "positive".
 *
 * Mirror math: reflection across the YZ plane (x → −x). For positions negate x;
 * for quaternions (three order x,y,z,w) the conjugated rotation is (x, −y, −z, w).
 * Left/right joints swap names so the mirrored performance lands on the opposite
 * limbs, exactly as a human-mirrored copy would.
 */
import type { MotionCurveTrack, MotionCurves } from '../motionCurves';
import { trackToThree } from '../motionCurves';

const cloneTrack = (track: MotionCurveTrack): MotionCurveTrack => ({
  ...track, times: track.times.slice(), values: track.values.slice(),
});

// −0 would break exact involution and JSON round-trips; keep zeros positive.
const negate = (value: number) => (value === 0 ? 0 : -value);

export function reupload(clip: MotionCurves): MotionCurves {
  return { ...clip, name: `${clip.name} (reupload)`, tracks: clip.tracks.map(cloneTrack) };
}

export function retimeUniform(clip: MotionCurves, factor: number): MotionCurves {
  return {
    ...clip,
    name: `${clip.name} (retimed x${factor})`,
    duration: clip.duration * factor,
    tracks: clip.tracks.map((track) => ({ ...cloneTrack(track), times: track.times.map((time) => time * factor) })),
  };
}

export function insertHold(clip: MotionCurves, atFraction: number, holdFraction: number): MotionCurves {
  const holdStart = clip.duration * atFraction;
  const hold = clip.duration * holdFraction;
  return {
    ...clip,
    name: `${clip.name} (hold)`,
    duration: clip.duration + hold,
    tracks: clip.tracks.map((track) => {
      const three = trackToThree(track);
      const size = three.getValueSize();
      const interpolant = (three as unknown as { createInterpolant: () => { evaluate: (t: number) => ArrayLike<number> } }).createInterpolant();
      const first = track.times[0] ?? 0;
      const last = track.times[track.times.length - 1] ?? first;
      const plateau = Array.from(interpolant.evaluate(Math.max(first, Math.min(last, holdStart)))).slice(0, size);
      const times: number[] = [];
      const values: number[] = [];
      track.times.forEach((time, index) => {
        if (time < holdStart) { times.push(time); values.push(...track.values.slice(index * size, (index + 1) * size)); }
      });
      times.push(holdStart, holdStart + hold);
      values.push(...plateau, ...plateau);
      track.times.forEach((time, index) => {
        if (time > holdStart) { times.push(time + hold); values.push(...track.values.slice(index * size, (index + 1) * size)); }
      });
      return { ...track, times, values };
    }),
  };
}

export function rescalePositions(clip: MotionCurves, scale: number): MotionCurves {
  return {
    ...clip,
    name: `${clip.name} (rescaled x${scale})`,
    tracks: clip.tracks.map((track) => (
      track.type === 'vector' && /\.position$/.test(track.name)
        ? { ...cloneTrack(track), values: track.values.map((value) => value * scale) }
        : cloneTrack(track)
    )),
  };
}

export function relocateRoot(clip: MotionCurves, rootJoint: string, offset: [number, number, number]): MotionCurves {
  const rootName = `${rootJoint}.position`;
  if (!clip.tracks.some((track) => track.name === rootName)) {
    throw new Error(`relocateRoot: ${clip.name} has no ${rootName} track`);
  }
  return {
    ...clip,
    name: `${clip.name} (relocated)`,
    tracks: clip.tracks.map((track) => (
      track.name === rootName
        ? { ...cloneTrack(track), values: track.values.map((value, index) => value + offset[index % 3]) }
        : cloneTrack(track)
    )),
  };
}

export function buildMirrorNameSwapper(nodes: string[]): (trackName: string) => string {
  const nodeSet = new Set(nodes);
  const map = new Map<string, string>();
  const core = (name: string) => name.replace(/_\d+$/, '');
  for (const node of nodes) {
    // Style A (robot, three-sanitized ".L"/".R"): trailing capital L/R with an existing counterpart.
    const trailing = node.match(/^(.*)([LR])$/);
    if (trailing) {
      const swapped = trailing[1] + (trailing[2] === 'L' ? 'R' : 'L');
      if (nodeSet.has(swapped)) { map.set(node, swapped); continue; }
    }
    // Style B (fox): Left/Right inside the name; the numeric suffix differs per side, so pair by core.
    if (/Left|Right/.test(node)) {
      const targetCore = core(node).replace(/Left|Right/, (side) => (side === 'Left' ? 'Right' : 'Left'));
      const matches = nodes.filter((other) => other !== node && core(other) === targetCore);
      if (matches.length === 1) map.set(node, matches[0]);
    }
  }
  for (const [from, to] of map) {
    if (map.get(to) !== from) {
      throw new Error(`mirror map is not an involution: ${from} -> ${to} -> ${map.get(to) ?? '(unmapped)'}`);
    }
  }
  return (trackName: string) => {
    const dot = trackName.lastIndexOf('.');
    return (map.get(trackName.slice(0, dot)) ?? trackName.slice(0, dot)) + trackName.slice(dot);
  };
}

export function mirrorClip(clip: MotionCurves, swapName: (trackName: string) => string): MotionCurves {
  return {
    ...clip,
    name: `${clip.name} (mirrored)`,
    tracks: clip.tracks.map((track) => {
      const renamed = { ...cloneTrack(track), name: swapName(track.name) };
      if (track.type === 'vector' && /\.position$/.test(track.name)) {
        for (let i = 0; i < renamed.values.length; i += 3) renamed.values[i] = negate(renamed.values[i]);
      } else if (track.type === 'quaternion') {
        for (let i = 0; i < renamed.values.length; i += 4) {
          renamed.values[i + 1] = negate(renamed.values[i + 1]);
          renamed.values[i + 2] = negate(renamed.values[i + 2]);
        }
      }
      return renamed;
    }),
  };
}
