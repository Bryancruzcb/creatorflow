// frontend/src/motion/testset/scorecard.test.ts
import { describe, expect, it } from 'vitest';
import { deserializeClip } from '../motionCurves';
import type { MotionCurves } from '../motionCurves';
import type { CopyDetectionCase } from './copyDetectionCases';
import { currentEngineAdapter, formatScorecard, runScorecard } from './scorecard';

const clip = (name: string, y = 0): MotionCurves => ({
  formatVersion: 1,
  name,
  duration: 1,
  tracks: [{ name: 'Body.position', type: 'vector', times: [0, 1], values: [0, y, 0, 1, y, 0] }],
});

const makeCase = (id: string, kind: CopyDetectionCase['kind'], caseClass: CopyDetectionCase['caseClass'], candidateY: number): CopyDetectionCase => ({
  id, rigId: 'robot', kind, caseClass, sourceName: 'A', candidateName: 'B', source: clip('A'), candidate: clip('B', candidateY),
});

describe('scorecard metrics', () => {
  const cases = [
    makeCase('p1', 'positive', 'reupload', 0),   // identical → flagged by the fake adapter
    makeCase('p2', 'positive', 'mirror', 9),     // different → missed
    makeCase('n1', 'negative', 'unrelated', 9),  // different → correctly unflagged
    makeCase('n2', 'negative', 'family', 0),     // identical → wrongly flagged
    makeCase('v1', 'variant', 'variant', 0),     // must not touch recall or FPR
  ];
  const fakeAdapter = (source: import('three').AnimationClip, candidate: import('three').AnimationClip) => {
    const same = JSON.stringify(source.tracks[0].values) === JSON.stringify(candidate.tracks[0].values);
    return { score: same ? 100 : 10, flagged: same, exact: same };
  };
  const scorecard = runScorecard(cases, fakeAdapter);

  it('computes recall over positives only', () => {
    expect(scorecard.recall.overall).toEqual({ total: 2, hit: 1, percent: 50 });
    expect(scorecard.recall.byClass.reupload).toEqual({ total: 1, hit: 1, percent: 100 });
    expect(scorecard.recall.byClass.mirror).toEqual({ total: 1, hit: 0, percent: 0 });
  });

  it('computes false positives over negatives only, variant excluded', () => {
    expect(scorecard.falsePositives.overall).toEqual({ total: 2, hit: 1, percent: 50 });
    expect(scorecard.falsePositives.byClass.family).toEqual({ total: 1, hit: 1, percent: 100 });
    expect(scorecard.variants).toHaveLength(1);
  });

  it('formats a printable table naming every class', () => {
    const text = formatScorecard(scorecard, 'fake engine');
    for (const label of ['fake engine', 'reupload', 'mirror', 'unrelated', 'family', 'recall', 'false', 'variant']) {
      expect(text.toLowerCase()).toContain(label.toLowerCase());
    }
  });
});

describe('current engine adapter', () => {
  it('flags an exact copy and passes the app defaults through', () => {
    const adapter = currentEngineAdapter();
    const testCase = makeCase('x', 'positive', 'reupload', 0);
    const outcome = adapter(deserializeClip(testCase.source), deserializeClip(testCase.candidate));
    expect(outcome.exact).toBe(true);
    expect(outcome.flagged).toBe(true);
    expect(outcome.score).toBe(100);
  });
});
