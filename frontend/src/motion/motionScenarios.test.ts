import { describe, expect, it } from 'vitest';
import { motionScenarios, robloxFactsFor, similarityBand } from './motionScenarios';

describe('motion scenarios', () => {
  it('maps a live outcome to the engine\'s similarity bands', () => {
    expect(similarityBand(true, 100)).toEqual({ label: 'Exact curve data', tone: 'exact' });
    expect(similarityBand(false, 94).tone).toBe('high');
    expect(similarityBand(false, 78).tone).toBe('moderate');
    expect(similarityBand(false, 40).tone).toBe('low');
    expect(similarityBand(false, null).tone).toBe('none');
  });

  it('orders scenarios most-similar first, starting with an exact re-upload of one clip', () => {
    expect(motionScenarios[0].source).toBe(motionScenarios[0].candidate);
    expect(motionScenarios.at(-1)?.id).toBe('unrelated');
  });

  it('gives every scenario clip real Studio facts', () => {
    for (const scenario of motionScenarios) {
      for (const clip of [scenario.source, scenario.candidate]) {
        const facts = robloxFactsFor(clip);
        expect(facts.animationId).toMatch(/^rbxassetid:\/\//);
        expect(['Core', 'Idle', 'Movement', 'Action']).toContain(facts.priority);
      }
    }
  });
});
