import { describe, expect, it } from 'vitest';
import { run } from './deviation';

/**
 * These guard the honesty of the numbers rather than the search itself.
 *
 * The failure this view can actually cause is not a slow render — it is printing a confident
 * average over a sample so small it means nothing, or painting "we could not measure this" in a
 * colour the legend reserves for "maximally different".
 */

function flat(points: [number, number, number][]) {
  return new Float32Array(points.flat());
}

const CELL = 0.055;

describe('deviation search', () => {
  it('reports zero deviation for a surface compared against itself', () => {
    const points = flat([[0, 0, 0], [0.02, 0, 0], [0, 0.02, 0]]);
    const result = run({ source: points.slice(), target: points.slice(), cellSize: CELL, ceiling: 0.12 });

    expect(result.samples).toBe(3);
    expect(result.unmeasured).toBe(0);
    expect(result.mean).toBeCloseTo(0, 6);
    expect(result.maximum).toBeCloseTo(0, 6);
  });

  it('counts out-of-range points as unmeasured instead of as maximally deviant', () => {
    // One target point sits on the reference; the other is far outside any search shell.
    const source = flat([[0, 0, 0]]);
    const target = flat([[0, 0, 0], [50, 50, 50]]);
    const result = run({ source, target, cellSize: CELL, ceiling: 0.12 });

    expect(result.samples).toBe(1);
    expect(result.unmeasured).toBe(1);
    // The distant point must not be folded into the average as a large distance.
    expect(result.mean).toBeCloseTo(0, 6);
    expect(result.maximum).toBeCloseTo(0, 6);
    // NaN is what tells the colour pass to use NO_DATA rather than the ramp maximum.
    expect(Number.isNaN(result.distances[1])).toBe(true);
  });

  it('averages only over measured points, so coverage cannot be inferred from the mean', () => {
    // Nine of ten target points have no neighbour in range. The mean is spotless and meaningless:
    // this is exactly why `unmeasured` is surfaced in the legend rather than dropped.
    const source = flat([[0, 0, 0]]);
    const target = flat([
      [0, 0, 0],
      ...Array.from({ length: 9 }, (_, i) => [10 + i, 0, 0] as [number, number, number]),
    ]);
    const result = run({ source, target, cellSize: CELL, ceiling: 0.12 });

    expect(result.samples).toBe(1);
    expect(result.unmeasured).toBe(9);
    expect(result.mean).toBeCloseTo(0, 6);
  });

  it('measures a real separation between two offset surfaces', () => {
    const source = flat([[0, 0, 0]]);
    const target = flat([[0.03, 0, 0]]);
    const result = run({ source, target, cellSize: CELL, ceiling: 0.12 });

    expect(result.samples).toBe(1);
    expect(result.unmeasured).toBe(0);
    expect(result.maximum).toBeCloseTo(0.03, 5);
  });
});
