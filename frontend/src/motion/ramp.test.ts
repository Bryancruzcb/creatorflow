import { describe, expect, it } from 'vitest';
import {
  DEVIATION_RAMP,
  NO_DATA_HEX,
  SIMILARITY_RAMP,
  relativeLuminance,
  sampleRamp,
} from './ramp';

/**
 * These guard the property that makes the ramps safe rather than the specific colours.
 * The old jet ramp passed every visual review it ever got; what it failed was this.
 */

function luminanceAt(stops: typeof DEVIATION_RAMP, t: number) {
  const { r, g, b } = sampleRamp(stops, t);
  const toHex = (c: number) => Math.round(c).toString(16).padStart(2, '0');
  return relativeLuminance(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
}

describe.each([
  ['deviation', DEVIATION_RAMP],
  ['similarity', SIMILARITY_RAMP],
])('%s ramp', (_name, stops) => {
  it('increases in luminance at every step, so lightness alone carries the order', () => {
    const samples = Array.from({ length: 21 }, (_, i) => luminanceAt(stops, i / 20));
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  it('separates its endpoints far enough to survive greyscale', () => {
    // The jet ramp it replaces put its two ends within 0.036 of each other.
    const start = luminanceAt(stops, 0);
    const end = luminanceAt(stops, 1);
    expect(end - start).toBeGreaterThan(0.3);
  });

  it('does not peak in the middle', () => {
    const mid = luminanceAt(stops, 0.5);
    expect(luminanceAt(stops, 1)).toBeGreaterThan(mid);
  });
});

describe('no-data colour', () => {
  it('is not confusable with either end of the deviation ramp', () => {
    const noData = relativeLuminance(NO_DATA_HEX);
    // Previously "could not measure" was painted at the ramp maximum, i.e. identical to
    // "maximally different". It must sit clear of both ends.
    expect(Math.abs(noData - luminanceAt(DEVIATION_RAMP, 1))).toBeGreaterThan(0.1);
    expect(noData).not.toBeCloseTo(luminanceAt(DEVIATION_RAMP, 0), 2);
  });
});
