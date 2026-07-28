import type { AnimationClip } from 'three';

/**
 * The authored frames of a clip, read from the clip itself.
 *
 * "Step one frame" needs a definition of a frame, and a glTF AnimationClip does not carry one:
 * it holds keyframe tracks at arbitrary times, not a frame rate. The honest definition is the
 * union of the times the tracks are actually keyed at — those are moments an animator authored,
 * and they exist in the file. A fixed sampling rate would be a number this code invented and
 * then presented as the clip's own, which is the thing this project refuses to do.
 *
 * For the bundled rig the two definitions happen to coincide: every clip in RobotExpressive.glb
 * is keyed uniformly across all its tracks, and every one works out to exactly 24 fps — Walking
 * 24 keys over 0.958s, Dance 81 over 3.333s, Jump 18 over 0.708s. That is a property of this
 * asset, not a rule, so the code reads the times rather than assuming them. A clip keyed
 * unevenly, or on twos, still steps through its real authored moments.
 */

/** Times within a clip are equal if they agree to this, which is finer than any authored rate. */
const EPSILON = 1e-4;

/**
 * Sorted, de-duplicated authored times in seconds, always including 0 and the clip duration.
 *
 * The endpoints are forced because a clip whose tracks all start keying after t=0 would otherwise
 * have no frame at the pose the viewer opens on.
 */
export function clipFrameTimes(clip: AnimationClip): number[] {
  const times: number[] = [0];
  for (const track of clip.tracks) {
    for (let i = 0; i < track.times.length; i += 1) times.push(track.times[i]);
  }
  if (clip.duration > 0) times.push(clip.duration);
  times.sort((a, b) => a - b);

  const unique: number[] = [];
  for (const time of times) {
    if (time < 0 || time > clip.duration + EPSILON) continue;
    if (!unique.length || time - unique[unique.length - 1] > EPSILON) unique.push(time);
  }
  return unique;
}

/** The same frames as normalized phase in [0,1], which is what the transport is bound to. */
export function clipFrameProgress(clip: AnimationClip): number[] {
  if (clip.duration <= 0) return [0];
  return clipFrameTimes(clip).map((time) => Math.min(1, time / clip.duration));
}

/**
 * The stops the transport should snap to when comparing two clips.
 *
 * Stepping only the reference clip's grid would make the candidate's authored poses unreachable —
 * in a tool whose entire job is comparing two clips, half the evidence would be un-inspectable.
 * Walking has 24 keys and Dance 81; stepping Walking's grid alone means 57 of Dance's authored
 * poses can never be landed on exactly.
 *
 * The two clocks differ by mode, and this is where that has to be handled rather than in the
 * component:
 *  - `timing` compares against a shared authored clock, so both clips map onto the longer
 *    duration and a stop at 0.5 means the same instant in seconds for both.
 *  - every other mode normalises each clip to its own duration, so a stop is a phase and the
 *    two clips are at the same fraction of their own length, not the same second.
 */
export function frameStops(source: AnimationClip, candidate: AnimationClip, sharedClock: boolean): number[] {
  const window = sharedClock ? Math.max(source.duration, candidate.duration) : 0;
  const project = (clip: AnimationClip) => {
    const span = sharedClock ? window : clip.duration;
    if (span <= 0) return [0];
    return clipFrameTimes(clip).map((time) => Math.min(1, time / span));
  };
  const merged = [...project(source), ...project(candidate)].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const stop of merged) {
    if (!unique.length || stop - unique[unique.length - 1] > EPSILON) unique.push(stop);
  }
  // A shared clock leaves the shorter clip's stops short of 1; the transport still has to reach
  // the end of the window, so the endpoint is guaranteed rather than left to whichever clip is longer.
  if (unique.length && 1 - unique[unique.length - 1] > EPSILON) unique.push(1);
  return unique.length ? unique : [0];
}

/**
 * Index of the frame at or immediately before `progress`.
 *
 * Biased backwards on purpose: landing between two frames means the current pose is being
 * interpolated from the earlier one, so that is the frame the viewer is nearest to having seen.
 */
export function frameIndexAt(frames: number[], progress: number): number {
  if (!frames.length) return 0;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid] <= progress + EPSILON) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Step `delta` frames from `progress` and return the new progress.
 *
 * Stepping forward from between two frames goes to the next one rather than skipping it, which
 * is why this is not just `frameIndexAt + delta`. Clamps at both ends; a clip does not wrap,
 * because wrapping would assert it loops and several of these clips do not.
 */
export function stepFrame(frames: number[], progress: number, delta: number): number {
  if (frames.length < 2) return frames[0] ?? 0;
  const current = frameIndexAt(frames, progress);
  const onFrame = Math.abs(frames[current] - progress) <= EPSILON;
  /**
   * Landing between two frames is asymmetric, which is the whole reason this is not
   * `frameIndexAt + delta`. From between frame i and i+1, "next" is i+1 and "previous" is i —
   * both one authored frame away from where you are. Treating the backward case the same as the
   * forward one would skip past frame i to i-1, so a step back from a scrub would jump two
   * frames and the pose the viewer was trying to inspect would never appear.
   */
  const base = delta < 0 && !onFrame ? current + 1 : current;
  const next = Math.min(frames.length - 1, Math.max(0, base + delta));
  return frames[next];
}
