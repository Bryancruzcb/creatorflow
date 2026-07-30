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

/**
 * What the shipped operating point may cost, stated directly.
 *
 * This replaces `precision > recall`, which was a proxy for "the operating point favours precision"
 * and stopped meaning that once mirror canonicalization (#16) took recall on this set to 1.000.
 * Precision at the shipped threshold went UP in that change (0.992 -> 0.993) and the gate failed
 * anyway, purely because recall hit the ceiling — a gate that fails on an improvement is not
 * guarding anything.
 *
 * The constraint it was standing in for is that a false accusation is the worst output this product
 * can produce, so it is now written as what that means: a hard cap on flagged negatives, and a
 * precision floor. Both are ratchets. Raise them when the engine earns it; lowering either is a
 * product decision that has to be made in the open rather than absorbed into an average.
 */
const MAX_SHIPPED_FALSE_POSITIVES = 1;
const MIN_SHIPPED_PRECISION = 0.99;

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
    expect(shipped!.falsePositives).toBeLessThanOrEqual(MAX_SHIPPED_FALSE_POSITIVES);
    expect(shipped!.precision).toBeGreaterThanOrEqual(MIN_SHIPPED_PRECISION);
  });

  it('reports whether the positives still discriminate at the shipped threshold', () => {
    const shipped = sweep.find((point) => point.threshold === SHIPPED_THRESHOLD)!;
    // Not a pass/fail bar — a standing note in the output. Recall is 1.000 at every threshold up to
    // and including the shipped one, so on THIS set the positives no longer separate a good engine
    // from a better one; only a regression can move them. Read it as the set having been outgrown,
    // not as the problem being solved: the positives are programmatic derivations, and the mirror
    // ones are inverted by the same reflection model that generated them. Harder derivations or
    // real Roblox animations are what would make this number mean something again.
    if (shipped.recall === 1) {
      // eslint-disable-next-line no-console
      console.log(
        `\nNOTE: recall is saturated (${shipped.truePositives}/${shipped.truePositives} positives `
        + `flagged at ${SHIPPED_THRESHOLD}). Further engine gains cannot show up here; the remaining `
        + `signal on this set is the ${shipped.falsePositives} flagged negative(s).\n`,
      );
    }
    expect(shipped.recall).toBeLessThanOrEqual(1);
  });

  it('matches the committed curve (UPDATE_MOTION_SWEEP_BASELINE=1 npm test to regenerate)', () => {
    if (process.env.UPDATE_MOTION_SWEEP_BASELINE === '1') {
      writeFileSync(baselinePath, `${JSON.stringify(sweep, null, 2)}\n`);
    }
    expect(existsSync(baselinePath), 'sweep baseline missing — regenerate once and commit it').toBe(true);
    expect(sweep).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')));
  });
});
