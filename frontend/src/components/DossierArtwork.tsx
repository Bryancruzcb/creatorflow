import { useEffect, useState } from 'react';

/**
 * The two artefacts on the landing dossier.
 *
 * Third attempt, and the first two failed the same way. A grid of stick figures illustrated the
 * CATEGORY of thing being checked and nothing about the checking. A dope sheet and a 256-cell bit
 * grid replaced it with something accurate but unreadable: the dope sheet only parses if you
 * already know what a dope sheet is, and there is nothing a person can do with 256 squares even
 * once they know it is a hash. Both were clever. Neither communicated.
 *
 * These show the two moments a creator actually has — a match arrives, and a record closes it.
 */

/**
 * Real rotation curves, read out of `public/assets/robot-expressive.glb`.
 *
 * Angular distance of the left foot from each clip's own first keyframe, in degrees, one value per
 * authored key. Distance-from-start rather than a raw quaternion component, because a component's
 * value depends on which axis the animator happened to use and would be meaningless to plot.
 *
 * Regenerate: for the rotation channel on Foot.L, take q0 = first keyframe, then
 * value[i] = 2 * acos(|dot(q0, q[i])|), in degrees.
 *
 * Walking is 24 keys over 0.958 s, WalkJump 21 over 0.833 s. That difference is the picture: the
 * two hold the same shape, then WalkJump leaves for the jump and comes back.
 */
const WALKING = [0, 14.7, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 40.4, 49.9, 53.5, 53.5, 53.5, 53.5, 53.5, 51.2, 45.2, 35.9, 24, 10.4, 0];
const WALKJUMP = [0, 0, 0, 0, 0, 0, 30, 110.9, 147.9, 154.7, 155.6, 145, 106.9, 48.7, 10.7, 0, 0, 0, 0, 0, 0];

const PLOT_W = 300;
const PLOT_H = 96;
const CEILING = 180;

/** Both clips span the full width: this compares SHAPE, not authored seconds. */
function toPath(values: number[]) {
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * PLOT_W;
      const y = PLOT_H - Math.min(1, value / CEILING) * PLOT_H;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * Where the two stop agreeing — computed from the curves, not chosen by eye.
 *
 * First normalized position where they differ by more than a fifth of the plotted range. Sampling
 * both at the same fraction of their own length is the same normalization the comparison engine
 * uses, so the marker lands where the divergence actually is.
 */
function divergenceAt(a: number[], b: number[]) {
  const steps = 200;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const av = a[Math.round(t * (a.length - 1))];
    const bv = b[Math.round(t * (b.length - 1))];
    if (Math.abs(av - bv) > CEILING * 0.2) return t;
  }
  return null;
}

const DIVERGENCE = divergenceAt(WALKING, WALKJUMP);

export function MatchFinding() {
  return (
    <figure className="mf">
      <header className="mf-head">
        <strong>Two animations, same rig</strong>
        <small>Left foot, rotation from the start pose</small>
      </header>

      <div className="mf-plot">
        <svg viewBox={`0 0 ${PLOT_W} ${PLOT_H}`} preserveAspectRatio="none" aria-hidden="true">
          {/* Drawn behind the curves so it never breaks a line. */}
          {DIVERGENCE === null ? null : (
            <line className="mf-split" x1={DIVERGENCE * PLOT_W} y1="0" x2={DIVERGENCE * PLOT_W} y2={PLOT_H} />
          )}
          <path className="mf-curve mf-source" d={toPath(WALKING)} />
          <path className="mf-curve mf-candidate" d={toPath(WALKJUMP)} />
        </svg>
      </div>

      <ul className="mf-key">
        <li><i className="mf-swatch mf-source" />Guide.Walking</li>
        <li><i className="mf-swatch mf-candidate" />Guide.WalkJump</li>
      </ul>

      {/**
        * The sentence this panel exists for. A match is a reason to look, not a finding of theft,
        * and the landing page is where a tool like this earns or loses that.
        */}
      {/* "Same shape until X" would overclaim: the curves differ before the threshold trips, just
          by less than it. They PART at X, which is the only thing the computation supports. */}
      <figcaption>
        They part {DIVERGENCE === null ? 'nowhere' : `${Math.round(DIVERGENCE * 100)}% in`}, where one jumps.
        <b>Similar is not stolen. A person decides.</b>
      </figcaption>
    </figure>
  );
}

/**
 * The four records that have to line up before anything ships, in the order a person collects
 * them. These are the Wave clip's real fixture values — the one asset in the sample project that
 * is a locally edited derivative, so the record ends on an open review rather than a pass.
 */
const CHAIN = [
  { label: 'File', value: 'Guide.Wave' },
  { label: 'Source', value: 'Licensed fixture' },
  { label: 'Permission', value: 'CC0 1.0' },
  { label: 'Decision', value: 'Animator review open', open: true },
];

const CHAIN_TEXT = CHAIN.map((row) => `${row.label}:${row.value}`).join('\n');

async function digest(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function SourceRecordSheet() {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void digest(CHAIN_TEXT).then((next) => { if (live) setHash(next); });
    return () => { live = false; };
  }, []);

  return (
    <figure className="sr">
      <header className="sr-head">
        <strong>What ships with it</strong>
        <small>Four records, one fingerprint</small>
      </header>

      <ol className="sr-chain">
        {CHAIN.map((row) => (
          <li key={row.label} data-open={row.open ? 'true' : undefined}>
            <span className="sr-label">{row.label}</span>
            <span className="sr-value">{row.value}</span>
          </li>
        ))}
      </ol>

      {/**
        * The hash as a hash. This was 256 cells, one per bit — honest, and unreadable: there is
        * nothing a person can do with a picture of a number. Truncated because that is how a hash
        * is quoted everywhere, and the label says which hash rather than implying this is all of it.
        */}
      <div className="sr-digest">
        <code>{hash ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : '········'}</code>
        <small>SHA-256 of these four records</small>
      </div>
    </figure>
  );
}
