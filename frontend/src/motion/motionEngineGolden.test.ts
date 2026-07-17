/**
 * Golden vectors for the v2 web engine. Once Phase 1b's graded changes landed,
 * v2's behavior is pinned HERE (the Java parity test pins only compareNormalized).
 * Regenerate deliberately, with the scorecard deltas reported:
 *   UPDATE_MOTION_GOLDEN=1 npx vitest run src/motion/motionEngineGolden.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NormalizedAnimationJson } from './normalizedMotion';
import { compareMotion, type MotionComparisonV2 } from './motionEngine';

const oraclePath = new URL('./parity/motion-parity-oracle.json', import.meta.url);
const goldenPath = fileURLToPath(new URL('./motion-engine-golden.json', import.meta.url));

const oracle = JSON.parse(readFileSync(oraclePath, 'utf8')) as {
  cases: Array<{ id: string; source: NormalizedAnimationJson; candidate: NormalizedAnimationJson }>;
};

type GoldenEntry = Pick<MotionComparisonV2,
  'overallPercent' | 'posePercent' | 'timingPercent' | 'coveragePercent' | 'durationPercent' | 'warpScore' | 'exactCurveData' | 'verdict'>;

const pick = (result: MotionComparisonV2): GoldenEntry => ({
  overallPercent: result.overallPercent,
  posePercent: result.posePercent,
  timingPercent: result.timingPercent,
  coveragePercent: result.coveragePercent,
  durationPercent: result.durationPercent,
  warpScore: result.warpScore,
  exactCurveData: result.exactCurveData,
  verdict: result.verdict,
});

describe('v2 engine golden vectors', () => {
  const actual: Record<string, GoldenEntry> = {};
  for (const oracleCase of oracle.cases) {
    actual[oracleCase.id] = pick(compareMotion(oracleCase.source, oracleCase.candidate));
  }

  it('pins v2 behavior over every oracle input pair', () => {
    if (process.env.UPDATE_MOTION_GOLDEN === '1') {
      writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(existsSync(goldenPath), 'golden file missing — UPDATE_MOTION_GOLDEN=1 to create').toBe(true);
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, GoldenEntry>;
    expect(Object.keys(golden).length).toBe(oracle.cases.length);
    for (const [id, entry] of Object.entries(actual)) {
      expect(golden[id], `case ${id} missing from golden`).toBeDefined();
      expect(entry.exactCurveData).toBe(golden[id].exactCurveData);
      expect(entry.verdict).toBe(golden[id].verdict);
      for (const field of ['overallPercent', 'posePercent', 'timingPercent', 'coveragePercent', 'durationPercent', 'warpScore'] as const) {
        expect(Math.abs(entry[field] - golden[id][field]), `${id}.${field}: ${entry[field]} vs ${golden[id][field]}`).toBeLessThanOrEqual(0.0105);
      }
    }
  });

  it('spot-pins the composition guard: identical curves exact, disjoint joints near zero', () => {
    expect(actual['identical-curves'].verdict).toBe('EXACT_CURVE_DATA');
    expect(actual['zero-coverage'].overallPercent).toBe(0);
  });
});
