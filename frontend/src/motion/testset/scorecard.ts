/**
 * Engine-agnostic grading over the labeled case list. The adapter is the ONLY
 * engine-specific piece, so Phase 1's ported engine (and every later change)
 * gets graded by swapping the adapter — the cases and metrics never move.
 * The current-engine adapter mirrors the live registry path exactly:
 * compareClips with mode 'shape', jointScope 'full', 48 samples, threshold 85;
 * flagged = tone !== 'neutral' (review or blocked), same as the UI.
 */
import type { AnimationClip } from 'three';
import { compareClips } from '../../components/MotionComparisonLab';
import { deserializeClip } from '../motionCurves';
import type { CaseClass, CaseKind, CopyDetectionCase } from './copyDetectionCases';

export interface EngineOutcome { score: number | null; flagged: boolean; exact: boolean }
export type EngineAdapter = (source: AnimationClip, candidate: AnimationClip) => EngineOutcome;

export interface ScorecardRow {
  id: string; rigId: string; kind: CaseKind; caseClass: CaseClass;
  score: number | null; flagged: boolean; exact: boolean;
}

export interface ClassTally { total: number; hit: number; percent: number }

export interface Scorecard {
  rows: ScorecardRow[];
  recall: { overall: ClassTally; byClass: Record<string, ClassTally> };
  falsePositives: { overall: ClassTally; byClass: Record<string, ClassTally> };
  variants: ScorecardRow[];
}

const percent = (hit: number, total: number) => (total === 0 ? 0 : Math.round((1000 * hit) / total) / 10);

function tally(rows: ScorecardRow[]): { overall: ClassTally; byClass: Record<string, ClassTally> } {
  const byClass: Record<string, ClassTally> = {};
  let hit = 0;
  for (const row of rows) {
    const bucket = (byClass[row.caseClass] ??= { total: 0, hit: 0, percent: 0 });
    bucket.total += 1;
    if (row.flagged) { bucket.hit += 1; hit += 1; }
  }
  for (const bucket of Object.values(byClass)) bucket.percent = percent(bucket.hit, bucket.total);
  return { overall: { total: rows.length, hit, percent: percent(hit, rows.length) }, byClass };
}

export function runScorecard(cases: CopyDetectionCase[], adapter: EngineAdapter): Scorecard {
  const rows: ScorecardRow[] = cases.map((entry) => {
    const outcome = adapter(deserializeClip(entry.source), deserializeClip(entry.candidate));
    return { id: entry.id, rigId: entry.rigId, kind: entry.kind, caseClass: entry.caseClass, ...outcome };
  });
  return {
    rows,
    recall: tally(rows.filter((row) => row.kind === 'positive')),
    falsePositives: tally(rows.filter((row) => row.kind === 'negative')),
    variants: rows.filter((row) => row.kind === 'variant'),
  };
}

export function currentEngineAdapter(): EngineAdapter {
  return (source, candidate) => {
    const result = compareClips(source, candidate, { mode: 'shape', jointScope: 'full', sampleCount: 48, reviewThreshold: 85 });
    return { score: result.primaryValue, flagged: result.tone !== 'neutral', exact: result.exactCurveData };
  };
}

export function formatScorecard(scorecard: Scorecard, title: string): string {
  const lines: string[] = [];
  const row = (label: string, entry: ClassTally) =>
    `  ${label.padEnd(14)} ${String(entry.hit).padStart(3)}/${String(entry.total).padEnd(3)}  ${entry.percent.toFixed(1).padStart(5)}%`;
  lines.push(`Copy-detection scorecard — ${title}`);
  lines.push('POSITIVES (recall — higher is better)');
  for (const [name, entry] of Object.entries(scorecard.recall.byClass)) lines.push(row(name, entry));
  lines.push(row('ALL', scorecard.recall.overall));
  lines.push('NEGATIVES (false-positive rate — lower is better)');
  for (const [name, entry] of Object.entries(scorecard.falsePositives.byClass)) lines.push(row(name, entry));
  lines.push(row('ALL', scorecard.falsePositives.overall));
  lines.push('VARIANT pairs (reported, ungraded)');
  for (const variant of scorecard.variants) {
    lines.push(`  ${variant.id}: score ${variant.score ?? '—'} ${variant.flagged ? '(flagged)' : '(not flagged)'}`);
  }
  return lines.join('\n');
}
