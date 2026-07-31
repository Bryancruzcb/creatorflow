import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Footage } from '../Footage';
import { Heading, Kicker, Root, Sub, useExit } from '../primitives';
import { sec } from '../theme';

/**
 * Scene 1 — the question the creator already has.
 *
 * Opens on their problem rather than on the product. A creator about to publish is not looking for
 * "an originality platform"; they are looking at a folder they did not entirely build themselves.
 *
 * The backdrop is the real landing page, recorded by the capture harness, so the first thing a
 * viewer sees is software that exists rather than a drawing of it.
 */
export const Open: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const exit = useExit(durationInFrames);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Footage scene="open" durationInFrames={durationInFrames} pushIn />
      <Root transparent>
        <div style={{ position: 'relative' }}>
          <Kicker delay={sec(0.2)}>Before you publish</Kicker>
          <Heading delay={sec(0.5)}>
            Is everything in this
            <br />
            place yours to ship?
          </Heading>
          <Sub delay={sec(1.3)}>
            A Roblox project collects assets from a lot of places. Some you made. Some a teammate
            added. Some arrived from a free model two years ago.
          </Sub>
        </div>
      </Root>
    </AbsoluteFill>
  );
};
