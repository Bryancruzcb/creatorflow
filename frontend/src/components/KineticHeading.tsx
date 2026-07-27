import type { ReactNode } from 'react';

/**
 * Per-character entrance for a headline.
 *
 * The visible characters are aria-hidden and the real string is exposed once via aria-label, so
 * a screen reader reads "Know what can ship." rather than spelling it out. Line breaks are given
 * as separate lines rather than a <br> inside the split, so the stagger never runs across a
 * wrap boundary in the wrong order.
 *
 * Under prefers-reduced-motion the CSS drops the animation entirely and the text is simply there.
 */
export function KineticHeading({ lines, delay = 0.18, step = 0.032 }: {
  lines: string[];
  delay?: number;
  step?: number;
}): ReactNode {
  let index = 0;

  return (
    <span className="cf-kinetic" aria-label={lines.join(' ')}>
      {lines.map((line, lineIndex) => (
        <span key={line} style={{ display: 'block' }} aria-hidden="true">
          {[...line].map((character, charIndex) => {
            const d = delay + index * step;
            index += 1;
            return (
              <span
                key={`${lineIndex}-${charIndex}`}
                className="cf-ch"
                style={{ ['--d' as string]: `${d.toFixed(3)}s` }}
              >
                {character}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}
