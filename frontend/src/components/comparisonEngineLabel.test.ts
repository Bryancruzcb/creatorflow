import { describe, expect, it } from 'vitest';
import { comparisonEngineCaveat, comparisonEngineLabel } from './MotionComparisonLab';

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

describe('comparisonEngineCaveat', () => {
  it('does not warn about a discrepancy for the engine the lab itself runs', () => {
    // The plugin route scores on v2 now, so a v2 record is on the same scale as the lab. Telling
    // the reader those numbers might differ would be a false warning, not a cautious one.
    const caveat = comparisonEngineCaveat('creatorflow.motion-comparison/v2-web');
    expect(caveat).toContain('same engine');
    expect(caveat).not.toContain('score differently');
  });

  it('still warns on a v1 record, which really is a different algorithm', () => {
    // v1 records predate the route moving and cannot be rescored, so the caveat has to survive for
    // them even though new records no longer need it.
    const caveat = comparisonEngineCaveat('creatorflow.motion-comparison/v1');
    expect(caveat).toContain('score differently');
    expect(caveat).toContain('mirrored');
  });

  it('offers neither reassurance nor a specific warning for an unknown engine', () => {
    expect(comparisonEngineCaveat('creatorflow.motion-comparison/v3')).toBeNull();
  });
});
