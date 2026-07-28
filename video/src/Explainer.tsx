import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { c, sec } from './theme';
import { Open } from './scenes/Open';
import { Scan } from './scenes/Scan';
import { Finding } from './scenes/Finding';
import { Evidence } from './scenes/Evidence';
import { Manifest } from './scenes/Manifest';
import { Close } from './scenes/Close';

/**
 * The script, as timings.
 *
 * Six beats, no transitions beyond each scene fading its own tail, so cuts never land hard.
 * Durations are generous on the two scenes that carry a claim — Finding and Evidence — because a
 * viewer needs longer to read a caveat than a headline, and those are the two places this video
 * could mislead someone if it rushed them.
 */
export const SCENES = [
  { id: 'open', Component: Open, seconds: 8 },
  { id: 'scan', Component: Scan, seconds: 12 },
  { id: 'finding', Component: Finding, seconds: 17 },
  { id: 'evidence', Component: Evidence, seconds: 18 },
  { id: 'manifest', Component: Manifest, seconds: 15 },
  { id: 'close', Component: Close, seconds: 8 },
] as const;

export const TOTAL_FRAMES = SCENES.reduce((sum, s) => sum + sec(s.seconds), 0);

export const Explainer: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: c.desk }}>
      {SCENES.map(({ id, Component, seconds }) => {
        const from = at;
        const durationInFrames = sec(seconds);
        at += durationInFrames;
        return (
          <Sequence key={id} from={from} durationInFrames={durationInFrames} name={id}>
            <Component durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
