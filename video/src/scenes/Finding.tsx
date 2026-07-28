import React from 'react';
import { c, font, sec } from '../theme';
import { Heading, Kicker, Panel, Root, useEnter, useExit, useProgress } from '../primitives';

/**
 * The same two curves the landing page draws, from the same source.
 *
 * Angular distance of the left foot from each clip's own first keyframe, in degrees, one value per
 * authored key, read out of `frontend/public/assets/robot-expressive.glb`. Kept in sync with
 * `frontend/src/components/DossierArtwork.tsx` — a video that invented prettier curves would be
 * showing evidence the product never produced.
 */
const WALKING = [0, 14.7, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 26.9, 40.4, 49.9, 53.5, 53.5, 53.5, 53.5, 53.5, 51.2, 45.2, 35.9, 24, 10.4, 0];
const WALKJUMP = [0, 0, 0, 0, 0, 0, 30, 110.9, 147.9, 154.7, 155.6, 145, 106.9, 48.7, 10.7, 0, 0, 0, 0, 0, 0];

const W = 900;
const H = 260;
const CEILING = 180;

function toPath(values: number[]) {
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - Math.min(1, v / CEILING) * H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Same computation as the landing panel: first point past a fifth of the plotted range. */
function divergence() {
  for (let i = 0; i <= 200; i += 1) {
    const t = i / 200;
    const a = WALKING[Math.round(t * (WALKING.length - 1))];
    const b = WALKJUMP[Math.round(t * (WALKJUMP.length - 1))];
    if (Math.abs(a - b) > CEILING * 0.2) return t;
  }
  return 1;
}
const SPLIT = divergence();

/**
 * Scene 3 — a match arrives.
 *
 * The whole video turns here. The curves are drawn rather than stated, because the point is that a
 * creator can SEE why the tool flagged something instead of being handed a number to trust. The
 * caveat lands on its own beat, after the evidence, at full contrast.
 */
export const Finding: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const opacity = useExit(durationInFrames);
  const draw = useProgress(sec(1.0), sec(3.4));
  const splitIn = useProgress(sec(3.4), sec(4.0));

  // Dash-offset line drawing. A generous path length is fine — it only has to exceed the real one.
  const LEN = 4000;

  return (
    <Root opacity={opacity}>
      <Kicker delay={sec(0.1)}>Step two</Kicker>
      {/* Not "two animations look alike" — the curves on screen visibly diverge, and a heading
          that fights its own picture makes a viewer distrust both. This frames the plot as the
          explanation it is. */}
      <Heading delay={sec(0.3)} size={64}>
        Something matched. Here is why.
      </Heading>

      <Panel label="Left foot · rotation from the start pose" delay={sec(0.7)} style={{ marginTop: 44 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          {/* The split marker arrives after both curves are drawn, so the eye reads the shapes
              first and the measurement second. */}
          <line
            x1={SPLIT * W}
            y1={0}
            x2={SPLIT * W}
            y2={H}
            stroke={c.hairlineStrong}
            strokeWidth={2}
            strokeDasharray="6 8"
            opacity={splitIn}
          />
          <path
            d={toPath(WALKING)}
            fill="none"
            stroke={c.source}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={LEN}
            strokeDashoffset={LEN * (1 - draw)}
          />
          <path
            d={toPath(WALKJUMP)}
            fill="none"
            stroke={c.candidate}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={LEN}
            strokeDashoffset={LEN * (1 - draw)}
          />
        </svg>

        <div style={{ display: 'flex', gap: 40, marginTop: 22, fontFamily: font.mono, fontSize: 21 }}>
          <span style={{ color: c.source }}>— Guide.Walking</span>
          <span style={{ color: c.candidate }}>— Guide.WalkJump</span>
          <span style={{ marginLeft: 'auto', color: c.inkDim, opacity: splitIn }}>
            they part {Math.round(SPLIT * 100)}% in
          </span>
        </div>
      </Panel>

      {/**
        * The line the product lives or dies on. It gets its own entrance and full ink — a caveat
        * set fainter than the finding it qualifies is a caveat designed not to be read.
        */}
      <div
        style={{
          ...useEnter(sec(4.4)),
          marginTop: 40,
          fontSize: 38,
          fontWeight: 500,
          letterSpacing: '-0.02em',
        }}
      >
        Similar is not stolen.{' '}
        <span style={{ color: c.inkMuted, fontWeight: 400 }}>CreatorFlow never decides that.</span>
      </div>
    </Root>
  );
};
