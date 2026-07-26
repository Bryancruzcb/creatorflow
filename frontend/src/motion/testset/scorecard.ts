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
import { clipToNormalized } from '../clipToNormalized';
import { deserializeClip } from '../motionCurves';
import { compareNormalized } from '../motionEngineCore';
import { compareMotion } from '../motionEngine';
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

/**
 * Phase 1a ported engine: the faithful Java-algorithm port behind the lossy
 * clip adapter. Flag semantics use the ported engine's OWN verdict bands
 * (>=90 HIGH or exact), NOT the current engine's 85 threshold — the two
 * scorecards are reported side by side, not on a shared threshold.
 */
export function portedEngineAdapter(): EngineAdapter {
  return (source, candidate) => {
    const normalizedSource = clipToNormalized(source);
    const normalizedCandidate = clipToNormalized(candidate);
    // Java's NormalizedAnimation REJECTS empty keyframes, so the parity-proven core
    // never defined behavior for them — and a clip whose tracks were all dropped by
    // the adapter (e.g. morph-only) carries no motion evidence. Two empty clips must
    // never read as an exact 100% match: no evidence -> no flag, ever.
    if (normalizedSource.keyframes.length === 0 || normalizedCandidate.keyframes.length === 0) {
      return { score: null, flagged: false, exact: false };
    }
    const result = compareNormalized(normalizedSource, normalizedCandidate);
    return {
      score: result.overallPercent,
      flagged: result.verdict === 'EXACT_CURVE_DATA' || result.verdict === 'HIGH_SIMILARITY',
      exact: result.exactCurveData,
    };
  };
}

/** Phase 1b graded engine (v2). Flags at its own >=90 HIGH band or exact. */
export function tunedEngineAdapter(): EngineAdapter {
  return (source, candidate) => {
    const normalizedSource = clipToNormalized(source);
    const normalizedCandidate = clipToNormalized(candidate);
    if (normalizedSource.keyframes.length === 0 || normalizedCandidate.keyframes.length === 0) {
      return { score: null, flagged: false, exact: false };
    }
    const result = compareMotion(normalizedSource, normalizedCandidate);
    return {
      score: result.overallPercent,
      flagged: result.verdict === 'EXACT_CURVE_DATA' || result.verdict === 'HIGH_SIMILARITY',
      exact: result.exactCurveData,
    };
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

/**
 * Precision/recall across the whole decision threshold, rather than at the single operating point
 * the product happens to ship (85).
 *
 * A single pair of numbers ("92% recall, 4% false positives") describes one setting of one dial and
 * says nothing about how the engine behaves either side of it — whether the operating point sits on
 * a plateau or on a cliff, and what a stricter or looser product decision would actually cost. That
 * matters here more than usual: the product's stated priority is precision over recall, because a
 * false accusation is the worst output it can produce, so the cost of moving the dial is a product
 * question that needs a curve to answer.
 *
 * Cases whose engine score is null (no comparable data) are excluded — they are not decidable at
 * any threshold, so counting them would smear the curve with a constant.
 */
export interface SweepPoint {
  threshold: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export function runThresholdSweep(rows: ScorecardRow[], thresholds: number[]): SweepPoint[] {
  const scored = rows.filter((row) => row.score !== null && row.caseClass !== 'variant');
  const positives = scored.filter((row) => row.kind === 'positive');
  const negatives = scored.filter((row) => row.kind === 'negative');
  return thresholds.map((threshold) => {
    const truePositives = positives.filter((row) => (row.score as number) >= threshold).length;
    const falsePositives = negatives.filter((row) => (row.score as number) >= threshold).length;
    const falseNegatives = positives.length - truePositives;
    const precision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
    const recall = positives.length === 0 ? 0 : truePositives / positives.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return {
      threshold,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
    };
  });
}

export function formatSweep(points: SweepPoint[]): string {
  const header = 'threshold  TP   FP   FN   precision  recall  F1';
  const lines = points.map((p) => (
    `${String(p.threshold).padStart(9)}  ${String(p.truePositives).padStart(3)}  `
    + `${String(p.falsePositives).padStart(3)}  ${String(p.falseNegatives).padStart(3)}  `
    + `${p.precision.toFixed(3).padStart(9)}  ${p.recall.toFixed(3).padStart(6)}  ${p.f1.toFixed(3)}`
  ));
  return [header, ...lines].join('\n');
}
