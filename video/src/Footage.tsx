import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { FPS } from './theme';
import { useProgress } from './primitives';
import timings from '../public/captures/timings.json';

type SceneName = keyof typeof timings;

/**
 * A real-UI clip behind a scene's text. Trims to the moment the scripted beat
 * started (timings.json, written by the capture harness), covers the frame, and
 * lays a left-weighted scrim so captions read over arbitrary UI pixels.
 */
export const Footage: React.FC<{
  scene: SceneName;
  durationInFrames: number;
  pushIn?: boolean;
  dim?: number;
}> = ({ scene, durationInFrames, pushIn = false, dim = 0.55 }) => {
  // The hook runs unconditionally — `pushIn` only decides how much of it is used.
  const progress = useProgress(0, durationInFrames);
  const zoom = 1 + (pushIn ? 0.05 * progress : 0);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo
          muted
          src={staticFile(`captures/${scene}.webm`)}
          trimBefore={Math.round((timings[scene].beatStartMs / 1000) * FPS)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, rgba(17,18,16,${Math.min(dim + 0.3, 0.95)}) 0%, rgba(17,18,16,${dim}) 45%, rgba(17,18,16,0.12) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
