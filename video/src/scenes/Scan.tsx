import React from 'react';
import { c, font, sec } from '../theme';
import { Heading, Kicker, Panel, Root, useEnter, useExit, useProgress } from '../primitives';

const ROWS = [
  { path: 'animations/hero-idle.rbxm', kind: 'rbxm' },
  { path: 'animations/hero-walk.rbxm', kind: 'rbxm' },
  { path: 'audio/ambience/wind-loop.ogg', kind: 'ogg' },
  { path: 'meshes/props/lantern.rbxm', kind: 'rbxm' },
  { path: 'textures/environment/rock_01.png', kind: 'png' },
];

/**
 * Scene 2 — the scan, and the promise that makes it safe to run.
 *
 * The "stays on this machine" line is the load-bearing claim of the whole product, so it gets its
 * own beat rather than being a footnote. It is also worded exactly as the app words it: files stay
 * local, fingerprints are what travel. Widening that to "nothing leaves your machine" would be the
 * overclaim the copy review already caught once.
 */
export const Scan: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const opacity = useExit(durationInFrames);
  const sweep = useProgress(sec(1.2), sec(4.6));

  return (
    <Root opacity={opacity}>
      <Kicker delay={sec(0.1)}>Step one</Kicker>
      <Heading delay={sec(0.35)} size={64}>
        Point it at the folder.
      </Heading>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 40, marginTop: 52 }}>
        <Panel label="Scanning project" delay={sec(0.9)}>
          <div style={{ display: 'grid', gap: 14 }}>
            {ROWS.map((row, i) => {
              // Rows resolve one after another as the sweep passes them.
              const done = sweep > (i + 1) / (ROWS.length + 1);
              return (
                <div
                  key={row.path}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 0',
                    borderBottom: i === ROWS.length - 1 ? 'none' : `1px solid ${c.hairline}`,
                    opacity: done ? 1 : 0.38,
                  }}
                >
                  <span style={{ fontFamily: font.mono, fontSize: 21, color: done ? c.ink : c.inkDim }}>
                    {row.path}
                  </span>
                  <span style={{ fontFamily: font.mono, fontSize: 18, color: done ? c.clear : c.inkDim }}>
                    {done ? 'read' : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 26, height: 3, background: c.hairline }}>
            <div style={{ width: `${sweep * 100}%`, height: '100%', background: c.blueAccent }} />
          </div>
        </Panel>

        <div style={{ ...useEnter(sec(1.6)), alignSelf: 'center' }}>
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
  );
};
