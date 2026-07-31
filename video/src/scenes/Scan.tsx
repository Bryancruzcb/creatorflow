import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, sec } from '../theme';
import { Footage } from '../Footage';
import { Heading, Kicker, Root, useEnter, useExit } from '../primitives';

/**
 * Scene 2 — the scan, and the promise that makes it safe to run.
 *
 * The backdrop is the app's own sample preflight, recorded start to finish. It is the bundled
 * walkthrough rather than a live hash run, and the recording says so on screen in the app's own
 * words — but it is the product's surface rather than a drawing of five plausible file paths.
 *
 * The "stays on this machine" line is the load-bearing claim of the whole product, so it gets its
 * own beat rather than being a footnote. It is also worded exactly as the app words it: files stay
 * local, fingerprints are what travel. Widening that to "nothing leaves your machine" would be the
 * overclaim the copy review already caught once.
 */
export const Scan: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const exit = useExit(durationInFrames);
  const promise = useEnter(sec(1.6));

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Darker than the shared default: the walkthrough's own step headline ("Checking license
          records") lands at the same size and baseline as this scene's heading. */}
      <Footage scene="scan" durationInFrames={durationInFrames} dim={0.68} />
      <Root transparent>
        <div style={{ position: 'relative' }}>
          <Kicker delay={sec(0.1)}>Step one</Kicker>
          <Heading delay={sec(0.35)} size={64}>
            Point it at the folder.
          </Heading>

          <div style={{ ...promise, marginTop: 46, maxWidth: 900 }}>
            <div style={{ fontSize: 40, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
              Your files stay
              <br />
              on your machine.
            </div>
            <p style={{ marginTop: 22, fontSize: 26, lineHeight: 1.45, color: c.inkMuted }}>
              Only fingerprints — short mathematical summaries — are ever compared against anything
              else.
            </p>
          </div>
        </div>
      </Root>
    </AbsoluteFill>
  );
};
