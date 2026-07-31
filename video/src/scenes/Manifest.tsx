import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, sec } from '../theme';
import { Footage } from '../Footage';
import { Heading, Kicker, Root, useEnter, useExit } from '../primitives';

/**
 * Scene 5 — the thing you actually keep.
 *
 * Behind the text is the release gate doing the whole job: it opens blocked on decisions that are
 * still open, a person records each one, and only then does the export become available. That
 * sequence is the claim — a gate that never blocks would be a gate nobody should believe — so the
 * scene shows it happening rather than asserting it in a drawn file.
 */
export const Manifest: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const exit = useExit(durationInFrames);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* A touch darker than the shared default: the caption list runs down the left over the
          ledger's own rows, which are text at the same size. */}
      <Footage scene="manifest" durationInFrames={durationInFrames} dim={0.66} />
      <Root transparent>
        <div style={{ position: 'relative' }}>
          <Kicker delay={sec(0.1)}>What you keep</Kicker>
          <Heading delay={sec(0.3)} size={64}>
            One file that says what you checked.
          </Heading>

          <div style={{ display: 'grid', gap: 30, marginTop: 46, maxWidth: 860 }}>
            {[
              ['Ships with the release', 'Attach it to a handoff, a claim, or a teammate.'],
              ['Reproducible', 'Same files in, same hashes out — anyone can re-run it.'],
              ['Honest about gaps', 'Unresolved items stay unresolved. Nothing is rounded up.'],
            ].map(([title, body], i) => (
              <Claim key={title} title={title} body={body} delay={sec(1.6 + i * 0.6)} />
            ))}
          </div>
        </div>
      </Root>
    </AbsoluteFill>
  );
};

/**
 * One claim, as its own component so the entrance hook is called at a component's top level rather
 * than inside a map callback — the same fix the Evidence chain rows already carry.
 */
const Claim: React.FC<{ title: string; body: string; delay: number }> = ({ title, body, delay }) => (
  <div style={useEnter(delay)}>
    <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.01em' }}>{title}</div>
    <div style={{ marginTop: 8, fontSize: 24, lineHeight: 1.4, color: c.inkMuted }}>{body}</div>
  </div>
);
