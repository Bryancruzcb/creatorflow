import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { c, font } from './theme';

/**
 * The motion vocabulary. Four helpers, used everywhere, so the whole piece moves one way.
 *
 * Everything rises a short distance and fades. Nothing scales, bounces or slides sideways: this is
 * a video about evidence, and motion that draws attention to itself is the same mistake the
 * product's own visual plan rejects on the instrument surfaces.
 */

/** Fade + 12px rise. `delay` is in frames. */
export function useEnter(delay = 0, distance = 12) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 0.6 } });
  return {
    opacity: s,
    transform: `translateY(${interpolate(s, [0, 1], [distance, 0])}px)`,
  };
}

/** Fade out over the last `frames` of a sequence, so scenes never cut on a hard edge. */
export function useExit(durationInFrames: number, frames = 12) {
  const frame = useCurrentFrame();
  return interpolate(frame, [durationInFrames - frames, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** 0 -> 1 over a window, eased. For drawing lines, filling bars, advancing counters. */
export function useProgress(from: number, to: number) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - (1 - t) ** 3,
  });
}

export const Root: React.FC<{ children: React.ReactNode; opacity?: number; transparent?: boolean }> = ({
  children,
  opacity = 1,
  transparent = false,
}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      background: transparent ? 'transparent' : c.desk,
      color: c.ink,
      fontFamily: font.sans,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '0 140px',
      opacity,
    }}
  >
    {children}
  </div>
);

/** The small mono line above a heading. Same role as `.section-index` on the site. */
export const Kicker: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <div
    style={{
      ...useEnter(delay),
      fontFamily: font.mono,
      fontSize: 22,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: c.inkDim,
      marginBottom: 20,
    }}
  >
    {children}
  </div>
);

export const Heading: React.FC<{ children: React.ReactNode; delay?: number; size?: number }> = ({
  children,
  delay = 0,
  size = 76,
}) => (
  <h1
    style={{
      ...useEnter(delay),
      margin: 0,
      fontSize: size,
      fontWeight: 500,
      letterSpacing: '-0.03em',
      lineHeight: 1.08,
      maxWidth: 1180,
    }}
  >
    {children}
  </h1>
);

export const Sub: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <p
    style={{
      ...useEnter(delay),
      margin: '28px 0 0',
      fontSize: 30,
      lineHeight: 1.45,
      color: c.inkMuted,
      maxWidth: 900,
    }}
  >
    {children}
  </p>
);

/** A framed panel, matching the app's flat-surface-plus-hairline treatment. */
export const Panel: React.FC<{
  children: React.ReactNode;
  label?: string;
  style?: React.CSSProperties;
  delay?: number;
}> = ({ children, label, style, delay = 0 }) => (
  <div
    style={{
      ...useEnter(delay),
      background: c.graphite,
      border: `1px solid ${c.hairline}`,
      ...style,
    }}
  >
    {label ? (
      <div
        style={{
          padding: '16px 22px',
          borderBottom: `1px solid ${c.hairline}`,
          fontFamily: font.mono,
          fontSize: 19,
          color: c.inkDim,
        }}
      >
        {label}
      </div>
    ) : null}
    <div style={{ padding: 26 }}>{children}</div>
  </div>
);
