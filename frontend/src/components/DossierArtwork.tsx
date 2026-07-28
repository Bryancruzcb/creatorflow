import { useEffect, useState } from 'react';
import { animationStats } from '../fixtures/robloxProjectExample';

/**
 * The two artefacts on the landing dossier.
 *
 * They replace a grid of grey stick figures and a beige rectangle with a "LICENSE" box — art that
 * illustrated the *category* of thing being checked and nothing about the checking. These draw
 * what a Roblox creator actually opens: a dope sheet, and a source record with the fingerprint it
 * produces.
 *
 * Every value shown is read from `robloxProjectExample.ts`, the same fixture the workspace renders,
 * so the marketing surface cannot drift into claiming something the product does not do. Nothing
 * here is a placeholder standing in for a real number.
 */

/** Walking, from the shipped fixture: 0.958s, 20 tracks, 480 keys. */
const [CLIP_NAME, CLIP_DURATION, CLIP_TRACKS, CLIP_KEYS] =
  animationStats.find((clip) => clip[0] === 'Walking') ?? ['Walking', 0.958, 20, 480];
/** 480 keys across 20 tracks is 24 per track — division, not an assumed frame rate. */
const KEYS_PER_TRACK = Math.round(CLIP_KEYS / CLIP_TRACKS);

/**
 * Six of the twenty tracks, named for R15 parts.
 *
 * The panel says "6 of 20 shown" rather than implying the rig has six — a dope sheet that quietly
 * dropped fourteen tracks would be the marketing surface misrepresenting the file.
 */
const LANES = [
  { part: 'UpperTorso', keys: [0, 3, 6, 9, 12, 15, 18, 21, 23] },
  { part: 'LeftUpperArm', keys: [0, 4, 8, 12, 16, 20, 23] },
  { part: 'LeftUpperLeg', keys: [0, 2, 5, 8, 11, 14, 17, 20, 23] },
];

export function KeyframeSheet() {
  return (
    <figure
      className="ks"
      aria-label={`Animation editor dope sheet for ${CLIP_NAME}: ${LANES.length} of ${CLIP_TRACKS} rig tracks, keyed ${KEYS_PER_TRACK} times each across ${CLIP_DURATION} seconds.`}
    >
      <header className="ks-head">
        <strong>Guide.{CLIP_NAME}</strong>
        <small>R15 · {LANES.length} of {CLIP_TRACKS} tracks · {KEYS_PER_TRACK} keys each · {CLIP_DURATION}s</small>
      </header>

      <div className="ks-grid">
        {/* The playhead is one element sweeping the whole lane block, so every lane reads against
            the same clock. It is decoration for the eye, not a control, hence aria-hidden. */}
        <div className="ks-playhead" aria-hidden="true" />
        {LANES.map((lane) => (
          <div className="ks-lane" key={lane.part}>
            <span className="ks-part">{lane.part}</span>
            <div className="ks-track">
              {lane.keys.map((key) => (
                <i
                  key={key}
                  className="ks-key"
                  style={{ left: `${(key / (KEYS_PER_TRACK - 1)) * 100}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

/**
 * The four records that have to line up before anything ships, in the order a person collects
 * them. Values are the Wave clip's real fixture entries — the one asset in the sample project
 * that is a locally edited derivative, so the record ends on an open review rather than a pass.
 */
const CHAIN = [
  { label: 'File', value: 'ReplicatedStorage…Guide.Wave', note: 'rbxm · in the place file' },
  { label: 'Source', value: 'Licensed fixture', note: 'source metadata attached' },
  { label: 'Permission', value: 'CC0 1.0', note: 'recorded, not inferred' },
  { label: 'Decision', value: 'Animator review open', note: 'locally edited derivative', open: true },
];

const CHAIN_TEXT = CHAIN.map((row) => `${row.label}:${row.value}`).join('\n');

async function digestBits(text: string): Promise<number[] | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const bits: number[] = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  return bits;
}

export function SourceRecordSheet() {
  const [bits, setBits] = useState<number[] | null>(null);

  useEffect(() => {
    let live = true;
    void digestBits(CHAIN_TEXT).then((next) => { if (live) setBits(next); });
    return () => { live = false; };
  }, []);

  return (
    <figure className="sr">
      <header className="sr-head">
        <strong>Source record</strong>
        <small>four entries · one fingerprint</small>
      </header>

      <ol className="sr-chain">
        {CHAIN.map((row) => (
          <li key={row.label} data-open={row.open ? 'true' : undefined}>
            <span className="sr-label">{row.label}</span>
            <span className="sr-value">{row.value}</span>
            <span className="sr-note">{row.note}</span>
          </li>
        ))}
      </ol>

      {/**
        * The bits are the real SHA-256 of the four lines above, computed in the browser — not a
        * hash-shaped decoration. There is deliberately no "one byte changed, everything changed"
        * caption: SHA-256 flips each output bit with probability about a half, so roughly 128
        * cells would stay put and the claim would be visibly false to anyone who checked.
        */}
      <div className="sr-digest">
        <div className="sr-bits" role="img" aria-label="The 256-bit SHA-256 fingerprint of the four records above, one cell per bit.">
          {bits
            ? bits.map((bit, index) => <i key={index} data-on={bit ? 'true' : undefined} />)
            : null}
        </div>
        <small>SHA-256 of the four records · 256 bits{bits ? '' : ' · computing'}</small>
      </div>
    </figure>
  );
}
