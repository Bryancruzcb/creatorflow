import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, font, sec } from '../theme';
import { Heading, Kicker, Root, Sub, useEnter, useExit, useProgress } from '../primitives';

/**
 * Scene 1 — the question the creator already has.
 *
 * Opens on their problem rather than on the product. A creator about to publish is not looking for
 * "an originality platform"; they are looking at a folder they did not entirely build themselves.
 */
export const Open: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const opacity = useExit(durationInFrames);

  // Files stream in behind the type: the project filling up over a development cycle.
  const fill = useProgress(sec(0.6), sec(4.2));
  const total = 248;
  const shown = Math.round(fill * total);

  return (
    <Root opacity={opacity}>
      {/* The grid sits behind everything at low contrast — it is texture with a referent (a file
          list), not an abstract pattern. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(31, 1fr)',
          gap: 6,
          padding: 60,
          alignContent: 'center',
          opacity: 0.22,
        }}
      >
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            style={{
              height: 22,
              background: i < shown ? c.hairlineStrong : 'transparent',
              border: `1px solid ${i < shown ? 'transparent' : c.hairline}`,
              transition: 'none',
            }}
          />
        ))}
      </div>

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

        <div
          style={{
            ...useEnter(sec(2.6)),
            marginTop: 44,
            fontFamily: font.mono,
            fontSize: 26,
            color: c.inkDim,
          }}
        >
          {shown} files{frame > sec(4.2) ? ' · 1 place file' : ''}
        </div>
      </div>
    </Root>
  );
};
