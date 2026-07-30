/**
 * Characterizes the engine across the whole decision threshold instead of at the single shipped
 * operating point, and commits the curve so a tuning change has to show its cost.
 *
 * Regenerate deliberately with: UPDATE_MOTION_SWEEP_BASELINE=1 npm test
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCases, isGradableRig } from './copyDetectionCases';
import { loadAllRigFixtures } from './fixtureLoader';
import { currentEngineAdapter, formatSweep, runScorecard, runThresholdSweep } from './scorecard';

const THRESHOLDS = [60, 65, 70, 75, 80, 85, 90, 95];
const SHIPPED_THRESHOLD = 90;

const baselinePath = fileURLToPath(new URL('./sweep.baseline.json', import.meta.url));
const scorecard = runScorecard(buildCases(loadAllRigFixtures().filter(isGradableRig)), currentEngineAdapter());
const sweep = runThresholdSweep(scorecard.rows, THRESHOLDS);

describe('decision-threshold sweep', () => {
  it('reports the full precision/recall curve', () => {
    // eslint-disable-next-line no-console
    console.log(`\n${formatSweep(sweep)}\n`);
    expect(sweep).toHaveLength(THRESHOLDS.length);
  });

  it('behaves monotonically: raising the bar cannot add flags', () => {
    for (let i = 1; i < sweep.length; i += 1) {
      expect(sweep[i].truePositives).toBeLessThanOrEqual(sweep[i - 1].truePositives);
      expect(sweep[i].falsePositives).toBeLessThanOrEqual(sweep[i - 1].falsePositives);
    }
  });

  it('keeps the shipped operating point precision-favouring', () => {
    const shipped = sweep.find((point) => point.threshold === SHIPPED_THRESHOLD);
    expect(shipped).toBeDefined();
    // The product's stated priority is precision over recall — a false accusation is the worst
    // output it can produce. If a tuning change inverts that, this fails and the decision has to
    // be made explicitly rather than absorbed into an average.
    expect(shipped!.precision).toBeGreaterThan(shipped!.recall);
  });

  it('matches the committed curve (UPDATE_MOTION_SWEEP_BASELINE=1 npm test to regenerate)', () => {
    if (process.env.UPDATE_MOTION_SWEEP_BASELINE === '1') {
      writeFileSync(baselinePath, `${JSON.stringify(sweep, null, 2)}\n`);
    }
    expect(existsSync(baselinePath), 'sweep baseline missing — regenerate once and commit it').toBe(true);
    expect(sweep).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')));
  });
});
