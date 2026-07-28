import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { clipFrameProgress, clipFrameTimes, frameIndexAt, frameStops, stepFrame } from './clipFrames';

/**
 * These guard that a "frame" stays something the clip actually says, rather than a rate this
 * code picked. The bundled rig is uniformly 24 fps, but that is a property of the asset — a clip
 * keyed unevenly must still step through its own authored moments.
 */

function clip(name: string, times: number[], duration = times[times.length - 1]) {
  const values: number[] = [];
  for (let i = 0; i < times.length; i += 1) values.push(0, 0, 0, 1);
  return new AnimationClip(name, duration, [new QuaternionKeyframeTrack('bones[Head].quaternion', times, values)]);
}

describe('clipFrameTimes', () => {
  it('reads the authored keyframe times rather than assuming a rate', () => {
    // 24 keys over 0.958s is what Walking actually is: 23 intervals at ~24fps.
    const times = Array.from({ length: 24 }, (_, i) => (i * 0.958) / 23);
    expect(clipFrameTimes(clip('Walking', times, 0.958))).toHaveLength(24);
  });

  it('keeps uneven keying instead of resampling it flat', () => {
    // Animated "on twos" for the first half, then on ones — a real hand-authored pattern.
    const frames = clipFrameTimes(clip('Uneven', [0, 0.2, 0.4, 0.5, 0.6, 0.7], 0.7));
    expect(frames).toEqual([0, 0.2, 0.4, 0.5, 0.6, 0.7].map((v) => expect.closeTo(v, 6)));
  });

  it('merges times across tracks, because tracks need not agree', () => {
    const a = new QuaternionKeyframeTrack('bones[Head].quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const b = new VectorKeyframeTrack('bones[Hips].position', [0, 0.25, 1], [0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const frames = clipFrameTimes(new AnimationClip('Mixed', 1, [a, b]));
    expect(frames).toEqual([0, 0.25, 0.5, 1].map((v) => expect.closeTo(v, 6)));
  });

  it('always includes the start, even when no track is keyed there', () => {
    expect(clipFrameTimes(clip('Late', [0.4, 0.8], 0.8))[0]).toBe(0);
  });

  it('never reports a frame past the clip duration', () => {
    const frames = clipFrameTimes(clip('Short', [0, 0.5, 1], 0.5));
    expect(Math.max(...frames)).toBeLessThanOrEqual(0.5);
  });

  it('survives a zero-length clip without dividing by it', () => {
    expect(clipFrameProgress(new AnimationClip('Empty', 0, []))).toEqual([0]);
  });
});

describe('stepFrame', () => {
  const frames = [0, 0.25, 0.5, 0.75, 1];

  it('moves exactly one authored frame from a frame', () => {
    expect(stepFrame(frames, 0.5, 1)).toBeCloseTo(0.75, 6);
    expect(stepFrame(frames, 0.5, -1)).toBeCloseTo(0.25, 6);
  });

  it('from between frames, both directions land one frame away', () => {
    /**
     * The asymmetry that makes this more than index arithmetic. Scrubbed to 0.60, the viewer sits
     * between frames 2 (0.5) and 3 (0.75). Forward is 0.75 and back is 0.5 — treating back the
     * same as forward would skip to 0.25 and the pose they were inspecting would never render.
     */
    expect(stepFrame(frames, 0.6, 1)).toBeCloseTo(0.75, 6);
    expect(stepFrame(frames, 0.6, -1)).toBeCloseTo(0.5, 6);
  });

  it('clamps at both ends and does not wrap', () => {
    // Wrapping would assert the clip loops. WalkJump does not.
    expect(stepFrame(frames, 1, 1)).toBe(1);
    expect(stepFrame(frames, 0, -1)).toBe(0);
  });

  it('walks the whole clip one frame at a time without stalling', () => {
    let at = 0;
    const seen = [at];
    for (let i = 0; i < 10 && at < 1; i += 1) {
      const next = stepFrame(frames, at, 1);
      expect(next).toBeGreaterThan(at);
      at = next;
      seen.push(at);
    }
    expect(seen).toHaveLength(frames.length);
  });
});

describe('frameIndexAt', () => {
  const frames = [0, 0.25, 0.5, 0.75, 1];

  it('reports the frame at or before the position', () => {
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 0.5)).toBe(2);
    expect(frameIndexAt(frames, 0.6)).toBe(2);
    expect(frameIndexAt(frames, 1)).toBe(4);
  });

  it('does not fall off the end on float drift just past the last frame', () => {
    expect(frameIndexAt(frames, 1.0000001)).toBe(4);
  });
});

describe('frameStops', () => {
  const keyed = (name: string, count: number, duration: number) => {
    const times = Array.from({ length: count }, (_, i) => (i * duration) / (count - 1));
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) values.push(0, 0, 0, 1);
    return new AnimationClip(name, duration, [new QuaternionKeyframeTrack('bones[Head].quaternion', times, values)]);
  };

  it('makes both clips authored poses reachable, not just the reference', () => {
    // Walking 24 keys / Dance 81 keys, the real counts in the bundled rig. Stepping Walking's
    // grid alone would leave most of Dance's authored poses impossible to land on exactly.
    const stops = frameStops(keyed('Walking', 24, 0.958), keyed('Dance', 81, 3.333), false);
    expect(stops.length).toBeGreaterThan(81);
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBeCloseTo(1, 6);
  });

  it('phase mode puts both clips on their own normalized clock', () => {
    const stops = frameStops(keyed('Short', 3, 1), keyed('Long', 3, 4), false);
    expect(stops).toEqual([0, 0.5, 1].map((v) => expect.closeTo(v, 6)));
  });

  it('shared-clock mode maps both onto the longer duration', () => {
    // Short ends at 1s of a 4s window, so its stops land at 0, 0.125, 0.25 — not 0, 0.5, 1.
    const stops = frameStops(keyed('Short', 3, 1), keyed('Long', 3, 4), true);
    expect(stops).toContainEqual(expect.closeTo(0.125, 6));
    expect(stops).toContainEqual(expect.closeTo(0.25, 6));
    expect(stops[stops.length - 1]).toBeCloseTo(1, 6);
  });

  it('still reaches the end of the window when the longer clip stops short', () => {
    const stops = frameStops(keyed('A', 2, 1), keyed('B', 2, 1), true);
    expect(stops[stops.length - 1]).toBeCloseTo(1, 6);
  });
});
