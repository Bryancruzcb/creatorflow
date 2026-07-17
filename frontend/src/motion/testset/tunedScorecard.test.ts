// frontend/src/motion/testset/tunedScorecard.test.ts
/**
 * Grades the Phase 1b v2 engine on the labeled case list. Regenerated DELIBERATELY
 * at each graded stage (composition -> de-weight -> DTW) so the baseline diff is
 * the per-stage measurement:
 *   UPDATE_MOTION_TUNED_BASELINE=1 npm test
 *   # PowerShell: $env:UPDATE_MOTION_TUNED_BASELINE = '1'; npm test; Remove-Item Env:UPDATE_MOTION_TUNED_BASELINE
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnimationClip, NumberKeyframeTrack } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCases } from './copyDetectionCases';
import { loadRigFixture } from './fixtureLoader';
import { formatScorecard, runScorecard, tunedEngineAdapter } from './scorecard';

const ENGINE_TITLE = 'v2 web engine (DTW)';
const baselinePath = fileURLToPath(new URL('./scorecard.tuned.baseline.json', import.meta.url));

describe('v2-engine copy-detection scorecard', () => {
  const cases = buildCases([loadRigFixture('robot'), loadRigFixture('fox')]);
  const scorecard = runScorecard(cases, tunedEngineAdapter());

  afterAll(() => {
    process.stdout.write(`\n${formatScorecard(scorecard, ENGINE_TITLE)}\n\n`);
  });

  it('covers the full labeled set with finite-or-null scores', () => {
    expect(scorecard.recall.overall.total).toBe(119);
    expect(scorecard.falsePositives.overall.total).toBe(97);
    expect(scorecard.variants).toHaveLength(1);
    for (const row of scorecard.rows) {
      expect(row.score === null || Number.isFinite(row.score), `${row.id} produced a non-finite score`).toBe(true);
    }
  });

  it('always catches exact re-uploads', () => {
    expect(scorecard.recall.byClass.reupload).toMatchObject({ total: 17, hit: 17 });
    for (const row of scorecard.rows.filter((entry) => entry.caseClass === 'reupload')) {
      expect(row.exact, `${row.id} lost exact-match`).toBe(true);
    }
  });

  it('never flags a partial-coverage negative (false-accusation tripwire)', () => {
    for (const row of scorecard.rows.filter((entry) => entry.caseClass === 'partial-coverage')) {
      expect(row.flagged, `${row.id} flagged a partial-coverage negative`).toBe(false);
    }
  });

  it('treats clips with no surviving joint tracks as no-evidence, never exact', () => {
    const morphOnly = () => new AnimationClip('Face', 1, [
      new NumberKeyframeTrack('Head.morphTargetInfluences', [0, 1], [0, 1]),
    ]);
    const outcome = tunedEngineAdapter()(morphOnly(), morphOnly());
    expect(outcome.exact).toBe(false);
    expect(outcome.flagged).toBe(false);
    expect(outcome.score).toBeNull();
  });

  it('matches the committed tuned baseline (UPDATE_MOTION_TUNED_BASELINE=1 to regenerate deliberately)', () => {
    const snapshot = {
      engine: ENGINE_TITLE,
      flaggedByCase: Object.fromEntries(scorecard.rows.map((row) => [row.id, row.flagged])),
      recall: { hit: scorecard.recall.overall.hit, total: scorecard.recall.overall.total },
      falsePositives: { hit: scorecard.falsePositives.overall.hit, total: scorecard.falsePositives.overall.total },
    };
    if (process.env.UPDATE_MOTION_TUNED_BASELINE) {
      const reuploadRows = scorecard.rows.filter((row) => row.caseClass === 'reupload');
      const anchorHolds = reuploadRows.length === 17 && reuploadRows.every((row) => row.flagged && row.exact);
      if (!anchorHolds) throw new Error('refusing to write tuned baseline: reupload anchor failing');
      writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
    expect(existsSync(baselinePath), 'tuned baseline missing — run UPDATE_MOTION_TUNED_BASELINE=1 npm test once and commit it').toBe(true);
    expect(snapshot).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')));
  });
});
