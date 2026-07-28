import React from 'react';
import { c, font, sec } from '../theme';
import { Root, useEnter, useProgress } from '../primitives';

/**
 * Scene 6 — the close.
 *
 * Ends on the product's own line rather than a new one, and on a claim it can keep: knowing what
 * can ship is a statement about your own records, not a promise that nothing is stolen.
 */
export const Close: React.FC<{ durationInFrames: number }> = () => {
  const rule = useProgress(sec(0.4), sec(1.6));

  return (
    <Root>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <div
          style={{
            ...useEnter(sec(0.2)),
            fontSize: 96,
            fontWeight: 500,
            letterSpacing: '-0.035em',
            lineHeight: 1.05,
          }}
        >
          Know what can ship.
        </div>

        <div style={{ width: `${rule * 640}px`, height: 1, background: c.hairlineStrong, margin: '46px 0 34px' }} />

        <div style={{ ...useEnter(sec(1.5)), display: 'flex', gap: 46, fontFamily: font.mono, fontSize: 25, color: c.inkMuted }}>
          <span>Runs on your machine</span>
          <span>Roblox-first</span>
          <span>Open source</span>
        </div>

        <div style={{ ...useEnter(sec(2.2)), marginTop: 54, fontFamily: font.mono, fontSize: 27, color: c.blueHover }}>
          github.com/Bryancruzcb/creatorflow
        </div>
      </div>
    </Root>
  );
};
