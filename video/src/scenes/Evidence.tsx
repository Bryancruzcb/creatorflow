import React from 'react';
import { c, font, sec } from '../theme';
import { Heading, Kicker, Root, useEnter, useExit, useProgress } from '../primitives';

/**
 * The four records, in the order a person collects them. Same chain as the landing dossier and the
 * workspace's ownership panel — one story told the same way in three places.
 *
 * `basis` is the distinction the whole product turns on: who says so. "Checked" means the software
 * looked; "declared" means a person typed it in. Collapsing those two into one confident word is
 * exactly the failure this tool exists to avoid, so the video draws them differently.
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
 * Builds the chain one link at a time. The rail down the left is the point: these are not four
 * separate facts, they are one line of reasoning, and the product's job is keeping them attached
 * to the file.
 */
export const Evidence: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const opacity = useExit(durationInFrames);
  const rail = useProgress(sec(0.8), sec(4.6));

  return (
    <Root opacity={opacity}>
      <Kicker delay={sec(0.1)}>Step three</Kicker>
      <Heading delay={sec(0.3)} size={64}>
        Answer it once, on the record.
      </Heading>

      <div style={{ position: 'relative', marginTop: 52, paddingLeft: 42 }}>
        {/* The rail draws downward as the links land, so the chain assembles rather than appears. */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 0,
            width: 2,
            height: `${rail * 100}%`,
            background: c.hairlineStrong,
          }}
        />

        <div style={{ display: 'grid', gap: 30 }}>
          {CHAIN.map((row, i) => (
            <ChainRow key={row.label} row={row} delay={sec(1.0 + i * 0.85)} />
          ))}
        </div>
      </div>
    </Root>
  );
};

/**
 * A link, as its own component so the entrance hook is called at a component's top level rather
 * than inside a map callback. It happened to work — CHAIN never changes length — but a hook whose
 * call count depends on an array is one edit away from being a real bug.
 */
const ChainRow: React.FC<{ row: (typeof CHAIN)[number]; delay: number }> = ({ row, delay }) => {
  const enter = useEnter(delay);
  const isHuman = row.basis === 'human';
  return (
    <div style={{ ...enter, position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: -48,
                    top: 12,
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: isHuman ? c.review : c.inkDim,
                  }}
                />
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
                  {/* Checked vs declared, drawn differently on purpose. */}
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 17,
                      padding: '5px 12px',
                      border: `1px solid ${row.basis === 'checked' ? c.hairlineStrong : c.hairline}`,
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
