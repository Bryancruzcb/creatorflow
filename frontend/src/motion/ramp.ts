/**
 * The one place that decides how "how different" and "how alike" are coloured.
 *
 * Four incompatible ramps used to encode the same idea. The 3D heatmap ran a jet-family
 * blue -> amber -> coral, whose relative luminance is 0.2549 -> 0.4618 -> 0.2187: NOT monotonic.
 * "No deviation" and "maximum deviation" landed within 0.036 luminance of each other while the
 * midpoint was the brightest thing on the model, so in greyscale — or for a viewer with severe
 * colour deficiency — the two ends of the scale were indistinguishable and the middle shouted.
 *
 * Both ramps below are monotonic in luminance, so lightness alone carries the ordering and hue is
 * only reinforcement. That is what makes them safe.
 */

export interface RampStop {
  at: number;
  hex: string;
}

/**
 * DEVIATION — 0 is identical, 1 is the largest measured difference.
 *
 * Cool and dark where nothing is happening, warm and bright where it is, so attention is drawn to
 * difference rather than to the middle of the scale.
 */
export const DEVIATION_RAMP: RampStop[] = [
  { at: 0.0, hex: '#1a222c' },
  { at: 0.35, hex: '#3d5c72' },
  { at: 0.65, hex: '#8a7f5e' },
  { at: 0.85, hex: '#d29a3f' },
  { at: 1.0, hex: '#f6d089' },
];

/**
 * NO DATA is deliberately off-ramp.
 *
 * The heatmap used to paint any vertex whose neighbour search found nothing at the ramp maximum,
 * so "we could not measure this" and "this is maximally different" were the same colour — the
 * single most misleading thing the view could do. A flat desaturated grey belongs to neither end.
 */
export const NO_DATA_HEX = '#3a3a38';

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function toLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. Used by the test that guards monotonicity. */
export function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Sample a ramp at t in [0,1]. Returns 0-255 channels. */
export function sampleRamp(stops: RampStop[], t: number) {
  const clamped = Math.min(1, Math.max(0, t));
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (clamped >= stops[i].at && clamped <= stops[i + 1].at) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const span = upper.at - lower.at;
  const local = span <= 0 ? 0 : (clamped - lower.at) / span;
  const a = hexToRgb(lower.hex);
  const b = hexToRgb(upper.hex);
  return {
    r: a.r + (b.r - a.r) * local,
    g: a.g + (b.g - a.g) * local,
    b: a.b + (b.b - a.b) * local,
  };
}

export function sampleRampCss(stops: RampStop[], t: number) {
  const { r, g, b } = sampleRamp(stops, t);
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}

/** A CSS gradient of the whole ramp, for legends. Always drawn from the same source as the data. */
export function rampGradientCss(stops: RampStop[], angle = '90deg') {
  const parts = stops.map((stop) => `${stop.hex} ${(stop.at * 100).toFixed(0)}%`);
  return `linear-gradient(${angle}, ${parts.join(', ')})`;
}

/**
 * SIMILARITY — 0 is unrelated, 1 is near-identical.
 *
 * This one had its meaning inverted. The old ramp ran hue 32 (orange) at 0% to hue 117 (green) at
 * 100%, so a high similarity score rendered green — and green reads as "pass". For a provenance
 * tool a high score is the *review* case: it is the reading that needs a human, not the one that
 * clears the asset. The product's own scenario pills already got this right, labelling an exact
 * curve match in red while this readout congratulated it.
 *
 * So: low similarity is quiet and neutral, high similarity moves toward --review amber. It never
 * reaches red, because similarity is not a verdict and must not look like one.
 */
export const SIMILARITY_RAMP: RampStop[] = [
  { at: 0.0, hex: '#2a3038' },
  { at: 0.45, hex: '#5a5f63' },
  { at: 0.75, hex: '#9b8858' },
  { at: 1.0, hex: '#e0ab52' },
];
