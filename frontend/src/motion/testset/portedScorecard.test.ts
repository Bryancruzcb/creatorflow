// frontend/src/motion/testset/portedScorecard.test.ts
/**
 * Grades the Phase 1a ported engine (clipToNormalized -> compareNormalized) on
 * the same labeled case list as the current engine. Its baseline is pinned
 * separately in scorecard.ported.baseline.json (booleans only, anchor-gated,
 * regenerate deliberately):
 *   UPDATE_MOTION_PORTED_BASELINE=1 npm test
 *   # PowerShell: $env:UPDATE_MOTION_PORTED_BASELINE = '1'; npm test; Remove-Item Env:UPDATE_MOTION_PORTED_BASELINE
 * The CURRENT engine's scorecard.baseline.json is untouched by this file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnimationClip, NumberKeyframeTrack } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCases, isGradableRig } from './copyDetectionCases';
import { loadRigFixture, loadAllRigFixtures } from './fixtureLoader';
import { formatScorecard, portedEngineAdapter, runScorecard } from './scorecard';

// Derived from the fixtures rather than hardcoded: every clip yields one positive per
// derivation class, so adding a rig widens these automatically instead of failing on a
// number someone then edits without checking.
const CLIP_COUNT = loadAllRigFixtures().filter(isGradableRig).reduce((sum, rig) => sum + rig.clips.length, 0);
const POSITIVE_CLASSES = 7;
const EXPECTED_POSITIVES = CLIP_COUNT * POSITIVE_CLASSES;


const ENGINE_TITLE = 'ported Java-parity engine (49 samples / flags at >=90 or exact)';
const baselinePath = fileURLToPath(new URL('./scorecard.ported.baseline.json', import.meta.url));

describe('ported-engine copy-detection scorecard', () => {
  const cases = buildCases(loadAllRigFixtures());
  const scorecard = runScorecard(cases, portedEngineAdapter());

  afterAll(() => {
    process.stdout.write(`\n${formatScorecard(scorecard, ENGINE_TITLE)}\n\n`);
  });

  it('covers the full labeled set', () => {
    expect(scorecard.recall.overall.total).toBe(EXPECTED_POSITIVES);
    expect(scorecard.falsePositives.overall.total).toBe(97);
    expect(scorecard.variants).toHaveLength(1);
    for (const row of scorecard.rows) {
      expect(row.score === null || Number.isFinite(row.score), `${row.id} produced a non-finite score`).toBe(true);
    }
  });

  it('always catches exact re-uploads through the adapter + ported core', () => {
    expect(scorecard.recall.byClass.reupload).toMatchObject({ total: CLIP_COUNT, hit: CLIP_COUNT });
    for (const row of scorecard.rows.filter((entry) => entry.caseClass === 'reupload')) {
      expect(row.exact, `${row.id} lost exact-match through the ported path`).toBe(true);
    }
  });

  it('treats clips with no surviving joint tracks as no-evidence, never exact', () => {
    // Guard from the Task 4 review: morph-only clips normalize to zero keyframes;
    // without this, any two of them would compare EXACT at 100% — a false accusation.
    const morphOnly = () => new AnimationClip('Face', 1, [
      new NumberKeyframeTrack('Head.morphTargetInfluences', [0, 1], [0, 1]),
    ]);
    const outcome = portedEngineAdapter()(morphOnly(), morphOnly());
    expect(outcome.exact).toBe(false);
    expect(outcome.flagged).toBe(false);
    expect(outcome.score).toBeNull();
  });

  it('matches the committed ported baseline (UPDATE_MOTION_PORTED_BASELINE=1 npm test to regenerate deliberately)', () => {
    const snapshot = {
      engine: ENGINE_TITLE,
      flaggedByCase: Object.fromEntries(scorecard.rows.map((row) => [row.id, row.flagged])),
      recall: { hit: scorecard.recall.overall.hit, total: scorecard.recall.overall.total },
      falsePositives: { hit: scorecard.falsePositives.overall.hit, total: scorecard.falsePositives.overall.total },
    };
    if (process.env.UPDATE_MOTION_PORTED_BASELINE === '1') {
      const reuploadRows = scorecard.rows.filter((row) => row.caseClass === 'reupload');
      const anchorHolds = reuploadRows.length === CLIP_COUNT && reuploadRows.every((row) => row.flagged && row.exact);
      if (!anchorHolds) throw new Error('refusing to write ported baseline: reupload anchor failing');
      writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
    expect(existsSync(baselinePath), 'ported baseline missing — run UPDATE_MOTION_PORTED_BASELINE=1 npm test once and commit it').toBe(true);
    expect(snapshot).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')));
  });
});
