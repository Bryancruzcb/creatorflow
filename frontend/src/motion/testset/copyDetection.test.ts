// frontend/src/motion/testset/copyDetection.test.ts
/**
 * THE Phase 0 gate. Runs the current engine over the labeled copy-detection set,
 * prints the scorecard, and pins per-case flag outcomes to a committed baseline.
 * Any engine change that moves a case across the flag threshold fails here until
 * the baseline is intentionally regenerated and the before/after is reported:
 *   UPDATE_MOTION_BASELINE=1 npm test   (then commit the diff)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCases } from './copyDetectionCases';
import { loadRigFixture } from './fixtureLoader';
import { currentEngineAdapter, formatScorecard, runScorecard } from './scorecard';

const ENGINE_TITLE = 'current TS engine (shape / full / 48 samples / threshold 85)';
const baselinePath = fileURLToPath(new URL('./scorecard.baseline.json', import.meta.url));

describe('copy-detection scorecard', () => {
  const cases = buildCases([loadRigFixture('robot'), loadRigFixture('fox')]);
  const scorecard = runScorecard(cases, currentEngineAdapter());

  // vitest 4.1.10's default reporter drops console output emitted during the
  // collection phase (i.e. directly in the describe body) on passing runs.
  // A raw stdout write from afterAll bypasses that capture and always prints.
  afterAll(() => {
    process.stdout.write(`\n${formatScorecard(scorecard, ENGINE_TITLE)}\n\n`);
  });

  it('covers the full labeled set', () => {
    expect(scorecard.recall.overall.total).toBe(119);
    expect(scorecard.falsePositives.overall.total).toBe(93);
    expect(scorecard.variants).toHaveLength(1);
    for (const row of scorecard.rows) {
      expect(row.score === null || Number.isFinite(row.score), `${row.id} produced no score`).toBe(true);
    }
  });

  it('always catches exact re-uploads (anchor: if this fails, fixtures or engine are broken)', () => {
    expect(scorecard.recall.byClass.reupload).toMatchObject({ total: 17, hit: 17 });
    for (const row of scorecard.rows.filter((entry) => entry.caseClass === 'reupload')) {
      expect(row.exact, `${row.id} lost exact-match`).toBe(true);
    }
  });

  it('matches the committed baseline (UPDATE_MOTION_BASELINE=1 npm test to regenerate deliberately)', () => {
    const snapshot = {
      engine: ENGINE_TITLE,
      flaggedByCase: Object.fromEntries(scorecard.rows.map((row) => [row.id, row.flagged])),
      recall: { hit: scorecard.recall.overall.hit, total: scorecard.recall.overall.total },
      falsePositives: { hit: scorecard.falsePositives.overall.hit, total: scorecard.falsePositives.overall.total },
    };
    if (process.env.UPDATE_MOTION_BASELINE) {
      writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
    expect(existsSync(baselinePath), 'baseline missing — run UPDATE_MOTION_BASELINE=1 npm test once and commit it').toBe(true);
    expect(snapshot).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')));
  });
});
