import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, sec } from '../theme';
import { Footage } from '../Footage';
import { Heading, Kicker, Root, useEnter, useExit } from '../primitives';

/**
 * Scene 3 — a match arrives.
 *
 * The whole video turns here. The evidence is now the product's own investigation workbench,
 * recorded as a person opens it from a ledger match link: the side-by-side models, the matching
 * source records and the itemised differences are the ones the tool shows, not a redrawing of them.
 * The point survives the change — a creator can SEE why the tool flagged something instead of being
 * handed a number to trust. The caveat still lands on its own beat, after the evidence, at full
 * contrast.
 */
export const Finding: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const exit = useExit(durationInFrames);
  /**
   * The line the product lives or dies on. It gets its own entrance and full ink — a caveat
   * set fainter than the finding it qualifies is a caveat designed not to be read.
   */
  const caveat = useEnter(sec(4.4));

  return (
    <AbsoluteFill style={{ opacity: exit }}>
      {/* Only just above the shared default. The caveat's second clause is set muted on purpose and
          runs across the difference register's own rows; anything darker would flatten the side-by-side
          models, which are the evidence this scene is pointing at. */}
      <Footage scene="finding" durationInFrames={durationInFrames} dim={0.62} />
      <Root transparent>
        <div style={{ position: 'relative' }}>
          <Kicker delay={sec(0.1)}>Step two</Kicker>
          {/* Not "two animations look alike" — the side-by-side models on screen are already
              showing the difference, and a heading that fights its own picture makes a viewer
              distrust both. This frames what the workbench is showing as the explanation it is. */}
          <Heading delay={sec(0.3)} size={64}>
            Something matched. Here is why.
          </Heading>

          <div
            style={{
              ...caveat,
              marginTop: 40,
              fontSize: 38,
              fontWeight: 500,
              letterSpacing: '-0.02em',
            }}
          >
            Similar is not stolen.{' '}
            <span style={{ color: c.inkMuted, fontWeight: 400 }}>CreatorFlow never decides that.</span>
          </div>
        </div>
      </Root>
    </AbsoluteFill>
  );
};
