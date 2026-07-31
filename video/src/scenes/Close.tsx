import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, font, sec } from '../theme';
import { Footage } from '../Footage';
import { Root, useEnter } from '../primitives';

/**
 * Scene 6 — the close.
 *
 * Ends on the product's own line rather than a new one, and on a claim it can keep: knowing what
 * can ship is a statement about your own records, not a promise that nothing is stolen. The
 * workspace sits behind it, gate cleared and reading "Ready to export", so the last thing on screen
 * is the software rather than a title card.
 *
 * No exit fade, by the original design: this is the last scene, and the repository line is the one
 * thing a viewer might pause on.
 */
export const Close: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const title = useEnter(sec(0.2));
  const tags = useEnter(sec(1.5));
  const repo = useEnter(sec(2.2));

  return (
    <AbsoluteFill>
      {/* Darker than the shared default: the closing mono lines and the repository URL are thin
          text over the ledger, and the URL is the one thing a viewer may need to read exactly. */}
      <Footage scene="close" durationInFrames={durationInFrames} dim={0.7} />
      <Root transparent>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <div
            style={{
              ...title,
              fontSize: 96,
              fontWeight: 500,
              letterSpacing: '-0.035em',
              lineHeight: 1.05,
            }}
          >
            Know what can ship.
          </div>

          <div
            style={{
              ...tags,
              marginTop: 46,
              display: 'flex',
              gap: 46,
              fontFamily: font.mono,
              fontSize: 25,
              color: c.inkMuted,
            }}
          >
            <span>Runs on your machine</span>
            <span>Roblox-first</span>
            <span>Open source</span>
          </div>

          <div style={{ ...repo, marginTop: 54, fontFamily: font.mono, fontSize: 27, color: c.blueAccent }}>
            github.com/Bryancruzcb/creatorflow
          </div>
        </div>
      </Root>
    </AbsoluteFill>
  );
};
