/**
 * Compact JSON form of a three.js AnimationClip's curves. This is both the Phase 0 fixture
 * format and the Phase 2 registry wire format — keep it stable and versioned.
 * Values are float32-exact (three stores Float32Array; JSON doubles hold them losslessly).
 */
import { AnimationClip, type KeyframeTrack, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';

export type MotionCurveTrackType = 'vector' | 'quaternion' | 'number';

export interface MotionCurveTrack {
  name: string;
  type: MotionCurveTrackType;
  times: number[];
  values: number[];
}

export interface MotionCurves {
  formatVersion: 1;
  name: string;
  duration: number;
  tracks: MotionCurveTrack[];
}

const TRACK_CLASSES: Record<MotionCurveTrackType, new (name: string, times: number[], values: number[]) => KeyframeTrack> = {
  vector: VectorKeyframeTrack,
  quaternion: QuaternionKeyframeTrack,
  number: NumberKeyframeTrack,
};

export function serializeClip(clip: AnimationClip): MotionCurves {
  return {
    formatVersion: 1,
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map((track) => {
      const type = (track as KeyframeTrack & { ValueTypeName: string }).ValueTypeName;
      if (type !== 'vector' && type !== 'quaternion' && type !== 'number') {
        throw new Error(`unsupported track type "${type}" on ${track.name}`);
      }
      return { name: track.name, type, times: Array.from(track.times), values: Array.from(track.values) };
    }),
  };
}

export function trackToThree(track: MotionCurveTrack): KeyframeTrack {
  const TrackClass = TRACK_CLASSES[track.type];
  if (!TrackClass) throw new Error(`unsupported track type "${track.type}" on ${track.name}`);
  return new TrackClass(track.name, track.times.slice(), track.values.slice());
}

export function deserializeClip(data: MotionCurves): AnimationClip {
  return new AnimationClip(data.name, data.duration, data.tracks.map(trackToThree));
}
