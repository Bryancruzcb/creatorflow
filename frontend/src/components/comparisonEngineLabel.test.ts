import { describe, expect, it } from 'vitest';
import { comparisonEngineLabel } from './MotionComparisonLab';

describe('comparisonEngineLabel', () => {
  it('names both engines a stored comparison can come from', () => {
    expect(comparisonEngineLabel('creatorflow.motion-comparison/v1')).toBe('desktop v1 engine');
    expect(comparisonEngineLabel('creatorflow.motion-comparison/v2-web')).toBe('v2 web engine');
  });

  it('shows an unknown version verbatim instead of guessing', () => {
    // A future engine string must surface raw, not be silently mapped onto the nearest known
    // label — a wrong engine name on an evidence card is a provenance error, not a cosmetic one.
    expect(comparisonEngineLabel('creatorflow.motion-comparison/v3')).toBe('creatorflow.motion-comparison/v3');
  });
});
