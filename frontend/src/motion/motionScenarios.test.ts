import { describe, expect, it } from 'vitest';
import { similarityBand } from './motionScenarios';

describe('similarity band', () => {
  it('maps a live outcome to the engine\'s bands', () => {
    expect(similarityBand(true, 100)).toEqual({ label: 'Exact curve data', tone: 'exact' });
    expect(similarityBand(false, 94).tone).toBe('high');
    expect(similarityBand(false, 78).tone).toBe('moderate');
    expect(similarityBand(false, 40).tone).toBe('low');
    expect(similarityBand(false, null).tone).toBe('none');
  });
});
