import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, font, sec } from '../theme';
import { Footage } from '../Footage';
import { Heading, Kicker, Root, useEnter, useExit } from '../primitives';

/**
 * The four records, in the order a person collects them. Same chain as the landing dossier and the
 * workspace's ownership panel — one story told the same way in three places.
 *
 * `basis` is the distinction the whole product turns on: who says so. "Checked" means the software
 * looked; "declared" means a person typed it in. Collapsing those two into one confident word is
 * exactly the failure this tool exists to avoid, so the words stay on screen even though the panel
 * that used to frame them is now the real decision panel playing behind them.
 */
const CHAIN = [
  { label: 'File', value: 'Guide.Wave', basis: 'checked', note: 'hashed on this machine' },
  { label: 'Source', value: 'Licensed fixture', basis: 'declared', note: 'you recorded where it came from' },
  { label: 'Permission', value: 'CC0 1.0', basis: 'declared', note: 'the licence you hold' },
  { label: 'Decision', value: 'Animator review open', basis: 'human', note: 'a person, on the record' },
] as const;

/**
 * Scene 4 — from a match to something you can stand behind.
 *
 * Behind the text, the product's own evidence panel for a selected asset. The chain still arrives
 * one link at a time, because these are not four separate facts, they are one line of reasoning,
 * and the product's job is keeping them attached to the file.
 */
export const Evidence: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const exit = useExit(durationInFrames);

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Darker than the shared default: the decision panel behind this scene is dense text, and
          the caption list is dense text, so 0.55 left the two competing for the same pixels. */}
      <Footage scene="evidence" durationInFrames={durationInFrames} dim={0.8} />
      <Root transparent>
        <div style={{ position: 'relative' }}>
          <Kicker delay={sec(0.1)}>Step three</Kicker>
          <Heading delay={sec(0.3)} size={64}>
            Answer it once, on the record.
          </Heading>

          <div style={{ display: 'grid', gap: 30, marginTop: 46 }}>
            {CHAIN.map((row, i) => (
              <ChainRow key={row.label} row={row} delay={sec(1.0 + i * 0.85)} />
            ))}
          </div>
        </div>
      </Root>
    </AbsoluteFill>
  );
};

/**
 * A link, as its own component so the entrance hook is called at a component's top level rather
 * than inside a map callback. It happened to work — CHAIN never changes length — but a hook whose
 * call count depends on an array is one edit away from being a real bug.
 */
const ChainRow: React.FC<{ row: (typeof CHAIN)[number]; delay: number }> = ({ row, delay }) => {
  const enter = useEnter(delay);
  return (
    <div style={enter}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 19,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: c.inkDim,
            width: 168,
          }}
        >
          {row.label}
        </span>
        <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.01em' }}>{row.value}</span>
        {/* Checked vs declared vs your call. The framing is gone with the panel chrome; the
            distinction has to survive in the words, so it is said rather than drawn. */}
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 17,
            color: row.basis === 'checked' ? c.inkMuted : c.inkDim,
          }}
        >
          {row.basis === 'checked' ? 'checked' : row.basis === 'human' ? 'your call' : 'you declared'}
        </span>
      </div>
      <div style={{ marginTop: 6, marginLeft: 188, fontSize: 24, color: c.inkMuted }}>{row.note}</div>
    </div>
  );
};
