import React from 'react';
import { c, font, sec } from '../theme';
import { Heading, Kicker, Panel, Root, useEnter, useExit, useProgress } from '../primitives';

const LINES = [
  '{',
  '  "release": "winter-event-rc4",',
  '  "files": 248,',
  '  "checked": 248,',
  '  "decisions": 12,',
  '  "open": 1,',
  '  "sha256": "a9aac84a…2d4e421f"',
  '}',
];

/**
 * Scene 5 — the thing you actually keep.
 *
 * The counters run up rather than appearing, because the number arriving is what makes it read as
 * a produced artefact rather than a mockup. `open: 1` stays visible and amber: a manifest that
 * always shows zero problems would be a manifest nobody should believe.
 */
export const Manifest: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const opacity = useExit(durationInFrames);
  const type = useProgress(sec(1.0), sec(4.0));
  const shown = Math.round(type * LINES.length);

  return (
    <Root opacity={opacity}>
      <Kicker delay={sec(0.1)}>What you keep</Kicker>
      <Heading delay={sec(0.3)} size={64}>
        One file that says what you checked.
      </Heading>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.9fr', gap: 46, marginTop: 48 }}>
        <Panel label="release-manifest.json" delay={sec(0.7)}>
          <pre
            style={{
              margin: 0,
              fontFamily: font.mono,
              fontSize: 25,
              lineHeight: 1.65,
              color: c.inkMuted,
              minHeight: 300,
            }}
          >
            {LINES.slice(0, shown).map((line) => {
              const open = line.includes('"open"');
              return (
                <div key={line} style={{ color: open ? c.review : undefined }}>
                  {line}
                </div>
              );
            })}
          </pre>
        </Panel>

        <div style={{ alignSelf: 'center', display: 'grid', gap: 30 }}>
          {[
            ['Ships with the release', 'Attach it to a handoff, a claim, or a teammate.'],
            ['Reproducible', 'Same files in, same hashes out — anyone can re-run it.'],
            ['Honest about gaps', 'Unresolved items stay unresolved. Nothing is rounded up.'],
          ].map(([title, body], i) => (
            <div key={title} style={useEnter(sec(1.6 + i * 0.6))}>
              <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.01em' }}>{title}</div>
              <div style={{ marginTop: 8, fontSize: 24, lineHeight: 1.4, color: c.inkMuted }}>{body}</div>
            </div>
          ))}
        </div>
      </div>
    </Root>
  );
};
