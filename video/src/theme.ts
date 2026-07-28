/**
 * The product's own tokens, resolved to hex.
 *
 * Converted from the oklch values in `frontend/src/styles/01-base.css`'s `:root`, so the video and
 * the app are the same colours rather than a designer's memory of them. If the app's palette moves,
 * this file has to move with it — that is the standing cost of a video that recreates the UI, and
 * it is cheaper than screen captures that go stale silently and without warning.
 */
export const c = {
  desk: '#111210',
  graphite: '#191a17',
  raised: '#22231f',
  hairline: '#34352f',
  hairlineStrong: '#4a4b44',

  ink: '#f1f0ea',
  inkMuted: '#a7a69e',
  // Raised with --ink-dim when that token was corrected for WCAG AA; on --desk this measures
  // 4.74:1 before and 6.02:1 after. The drift guard in DossierArtwork.drift.test.ts is what
  // caught that the video had not followed the app.
  inkDim: '#93928b',

  /**
   * Two blues, because the app has two. `blueSolid` is a filled control with `ink` on top;
   * `blueAccent` is text or a mark on a dark surface. They cannot be one value — the requirement
   * pulls in opposite directions, which is what the single `--blue` failed at in both.
   */
  blueSolid: '#426080',
  blueAccent: '#7599bf',

  /**
   * Verdict colours, and they are not decoration. Amber means a human needs to look; green means
   * something passed. Using either for anything else is the mistake the workspace banner made.
   */
  clear: '#84a98c',
  review: '#c89a43',
  blocked: '#d66b54',

  /** The comparison pair, matching the motion lab's darkroom skin. */
  source: '#e0ab52',
  candidate: '#6fc7ff',
} as const;

export const font = {
  sans: 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
} as const;

/** 30fps throughout. Seconds are easier to reason about than frame counts when timing a script. */
export const FPS = 30;
export const sec = (n: number) => Math.round(n * FPS);
