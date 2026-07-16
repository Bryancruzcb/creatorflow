# Phase 1b — Graded Engine Improvements (De-weight + Banded DTW) and Live Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the parity-proven ported engine with the handoff's two Phase 1b changes — position de-weight and banded DTW — each separately graded on the (extended) Phase 0 scorecard, pin the new engine with its own golden vectors, then cut the live web path over to it; plus the hardening backlog from the Phase 1a reviews.

**Architecture:** The parity-locked `compareNormalized` stays byte-identical forever (it is the proven Java mirror; its parity test keeps guarding the shared primitives). A new `compareMotion` (v2) in `frontend/src/motion/motionEngine.ts` composes the SAME exported primitives with three deliberate, separately-graded divergences: (1) multiplicative coverage attenuation (guards the tiny-overlap false-positive the current UI already guards, WITHOUT the old harmonic mean's score inflation at full coverage), (2) position de-weight 0.42→0.25 toward rotation, (3) banded DTW (Sakoe-Chiba, band 12.5%) replacing lockstep sampling, with a warp-based timing composite replacing the ad-hoc timing heuristic. The scorecard case set gains 4 partial-coverage negatives so composition changes are actually measurable. Cutover rewires `analyzeMotionClips`'s shape/timing modes through `clipToNormalized` + `compareMotion` while preserving the entire `MotionAnalysisResult` UI contract, the raw-clip exactness check, and the untouched loop/root modes.

**Tech Stack:** TypeScript + vitest 4 (frontend only — no Java changes except none; the Java engine and oracle stay frozen). No new dependencies.

## Global Constraints

- **Grade every change, in order, one commit each** (handoff 1b): composition first, de-weight second, DTW third — each with before/after scorecard numbers captured in the task report. Hard gates from the handoff: **DTW must raise recall** (hold class is the target: 15/17 → 17/17) without raising FP; **de-weight must not raise FP and must not meaningfully cost recall** (the handoff tolerates a slight recall shave). If a gate fails, STOP the phase and report — do not tune past it silently.
- **`compareNormalized` stays parity-locked**: `src/motion/parity/motionParity.test.ts` must remain green after every task (22/22). Refactors of `motionEngineCore.ts` may add exports and optional parameters but may not change `compareNormalized`'s behavior.
- **The Java engine, oracle fixture, and generator are frozen this phase** (except the Task 8 hardening additions explicitly listed).
- **Precision outranks recall.** The new partial-coverage negatives are false-accusation tripwires: no graded change may flag them.
- **Cutover preserves the UI contract**: `analyzeMotionClips` keeps its exact signature and `MotionAnalysisResult` shape; loop/root modes byte-untouched; `exactCurveData` stays RAW-clip exactness (morph tracks included) via the existing `exactCurveMatch` — the adapter's morph-dropping must never make two different uploads read "exact" in the UI; clips are never mutated; jointScope filters tracks BEFORE normalization.
- **Baselines move only deliberately**: adding the 4 new cases and the cutover each require regenerating baselines via the UPDATE env vars, with per-class before/after deltas recorded in the task report. The reupload anchors (17/17 exact) must hold at every regeneration.
- Branch `claude/motion-engine-registry`; small commits; never push. Suite state at phase start: 17 files / 116 tests green, typecheck clean, `mvn -pl core test` green (modulo the known pre-existing ProjectScannerTest symlink-privilege failure on this machine).
- v2 constants fixed by this plan (golden-pinned, tunable only in a later graded phase): pose blend weights position 0.25 / rotation 0.65 / weight 0.10; DTW band = duration-aware (floor 12.5% of (N−1), grows to cover the duration-mismatch shift +2, cap 35%, min 2); timing composite = durationPercent·0.5 + warpScore·0.5 with warpScore normalized against the granted band; overall = (poseDtw·0.8 + timingComposite·0.2) · coverage/100; verdict bands ≥90 HIGH / ≥70 MODERATE; N = sampleCount+1 mapping from UI preference (48 → 49, matching the Java-lineage default).

## Why these exact design choices (context for reviewers)

- **Multiplicative coverage, not harmonic, not Java-linear:** the current UI's harmonic mean `2sc/(s+c)` guards low coverage but INFLATES at full coverage (pose 90 + coverage 100 → 94.7 — one driver of the old 15.1% FP). Java's linear `+0.15·coverage` under-penalizes: pose 100/timing 100 with HALF the skeleton unshared scores 92.5 → flagged. `x·coverage/100` equals `x` at full coverage (no inflation), annihilates tiny-overlap scores (coverage 2.4 → overall ≈ 2), and halves mid-coverage scores. The 4 new negative cases (Task 2) measure exactly this.
- **De-weight 0.42→0.25:** handoff finding 7 — the absolute-position term partly measures rig identity, not motion. First graded cut; weights live in one exported constant.
- **DTW distance cell, never similarity:** handoff finding 6 — DTW MINIMIZES; the cell cost is `1 − posePercent/100`.
- **Duration-aware band, not fixed 12.5%:** a hold inserted at 30% of duration shifts the whole post-hold tail by `hold/newDuration ≈ 23%` of the timeline (~11 of 48 samples) — a fixed 6-sample band mathematically cannot align it, and the phase's own hard gate (hold 17/17) would fail by construction. The band therefore floors at 12.5% but grows to cover the shift a pure duration mismatch implies: `band = min(round(0.35·(N−1)), max(2, round(0.125·(N−1)), ceil(|maxDur−minDur|/maxDur·(N−1)) + 2))` (base band when maxDur is 0). Same-duration pairs — including every unrelated/family/partial-coverage negative — keep the tight 12.5% band, so precision is unaffected; only genuinely duration-mismatched pairs get the wider corridor, and the warp they use is still penalized via `warpScore` normalized against the granted band.
- **Timing composite:** DTW subsumes the pattern heuristic; what remains meaningful is duration ratio (a real re-timing signal) + how much warp the alignment needed. `timingPercent` (Java's) stays exported for the parity path only.
- **Cutover keeps `exactCurveMatch` (raw):** v2's canonical exactness ignores morph tracks (adapter drops them). Two clips differing only in facial morphs must NOT read exact in the UI.

## File Structure

```
frontend/src/motion/
  motionEngineCore.ts        # MODIFIED (exports only): primitives exposed, poseDelta gains optional weights param
  motionEngine.ts            # NEW: compareMotion (v2) — evolves across Tasks 3→5
  motionEngine.test.ts       # NEW: unit tests per stage
  motionEngineGolden.test.ts # NEW (Task 6): golden vectors over oracle inputs + synthetic partial-coverage pairs
  motion-engine-golden.json  # NEW generated+committed (Task 6)
  motionAnalysis.ts          # MODIFIED (Task 7): shape/timing modes route through clipToNormalized + compareMotion
  testset/
    copyDetectionCases.ts    # MODIFIED (Task 2): + partial-coverage negatives (4 cases)
    copyDetectionCases.test.ts # MODIFIED: updated totals + new-class assertions
    copyDetection.test.ts    # MODIFIED: totals 93→97; baseline regenerated (Tasks 2, 7)
    portedScorecard.test.ts  # MODIFIED: totals 93→97; + finite-or-null score loop; baseline regenerated (Task 2)
    scorecard.ts             # MODIFIED (Task 3): + tunedEngineAdapter for v2 grading
    tunedScorecard.test.ts   # NEW (Task 3): v2 scorecard harness + pinned baseline (regenerated Tasks 4, 5)
    scorecard.tuned.baseline.json # NEW generated+committed
    README.md                # MODIFIED (Tasks 2, 5, 7)
core/src/test/java/creatorflow/motion/MotionParityOracle.java          # MODIFIED (Task 8 ONLY): + fixture-scale case
core/src/test/java/creatorflow/motion/MotionParityOracleGeneratorTest.java # MODIFIED (Task 8 ONLY): env gate === "1"
frontend/src/motion/parity/motion-parity-oracle.json                   # regenerated (Task 8 ONLY)
frontend/src/motion/parity/motionParity.test.ts                        # MODIFIED (Task 8): case count 22→23, expected-NaN guard
```

Execution note for the controller: Tasks 3–5 are graded sequentially and each ends with a decision point — if a hard gate fails, STOP and report to Bryan instead of proceeding. Task 7 (cutover) proceeds only if Tasks 3–5 gates all passed.

---

### Task 1: Export the core primitives (behavior-frozen refactor)

**Files:**
- Modify: `frontend/src/motion/motionEngineCore.ts`

**Interfaces:**
- Consumes: the existing internals.
- Produces (v2 relies on these exact exports): `export interface PoseBlendWeights { position: number; rotation: number; weight: number }`; `export const JAVA_POSE_WEIGHTS: PoseBlendWeights` (= {0.42, 0.5, 0.08}); `export { tracks, sample, poseDelta, canonicalCurvesEqual, round, quantileIndex, trackMetadataPercent }`; `export type { TrackKey, PoseSample, PoseDelta }`; `poseDelta(source, candidate, weights: PoseBlendWeights = JAVA_POSE_WEIGHTS)`.
- The parity gate IS the test for this task: zero behavior change allowed.

- [ ] **Step 1: Apply the refactor**

In `frontend/src/motion/motionEngineCore.ts`:

1. Change the three internal interfaces to exported ones and add the weights type + constant:

```ts
export interface Vector3 { x: number; y: number; z: number }
export interface Quaternion { w: number; x: number; y: number; z: number }
export interface TrackKey {
  time: number;
  position: Vector3;
  rotation: Quaternion;
  weight: number;
  easingStyle: string;
  easingDirection: string;
}
export interface PoseSample { position: Vector3; rotation: Quaternion; weight: number }
export interface PoseDelta { posePercent: number; positionDelta: number; rotationDelta: number }

/** The Java engine's per-pose blend. v2 passes its own de-weighted values. */
export interface PoseBlendWeights { position: number; rotation: number; weight: number }
export const JAVA_POSE_WEIGHTS: PoseBlendWeights = { position: 0.42, rotation: 0.5, weight: 0.08 };
```

2. Add `export` keywords (nothing else) to: `canonicalCurvesEqual`, `tracks`, `sample`, `round`, `quantileIndex`, `trackMetadataPercent`.

3. Generalize `poseDelta` with a defaulted parameter — the parity path's call sites stay argument-free, so behavior is unchanged:

```ts
export function poseDelta(source: PoseSample, candidate: PoseSample, weights: PoseBlendWeights = JAVA_POSE_WEIGHTS): PoseDelta {
  const positionDelta = vectorDistance(source.position, candidate.position);
  const rotationDelta = quatAngleTo(source.rotation, candidate.rotation);
  const weightDelta = Math.abs(source.weight - candidate.weight);
  const positionPercent = 100 * Math.exp(-POSITION_DECAY * positionDelta);
  const rotationPercent = 100 * Math.exp(-ROTATION_DECAY * rotationDelta);
  const weightPercent = 100 * Math.max(0, 1 - weightDelta);
  const posePercent = positionPercent * weights.position + rotationPercent * weights.rotation + weightPercent * weights.weight;
  return { posePercent, positionDelta, rotationDelta };
}
```

PORT-FIDELITY NOTE: with the default weights this computes `positionPercent * 0.42 + rotationPercent * 0.5 + weightPercent * 0.08` — the same three products in the same order as before; only the literals now come through the constant. Do not reorder the sum.

- [ ] **Step 2: Prove zero behavior change**

Run: `cd frontend && npx vitest run src/motion/parity/motionParity.test.ts src/motion/motionEngineCore.test.ts`
Expected: PASS (23 + 13). Then `npm run typecheck && npm test` — all green (116 tests).

- [ ] **Step 3: Commit**

```bash
git add src/motion/motionEngineCore.ts
git commit -m "Motion engine: export core primitives for the v2 composition (parity unchanged)"
```

---

### Task 2: Partial-coverage negative cases + deliberate baseline regenerations

**Files:**
- Modify: `frontend/src/motion/testset/copyDetectionCases.ts`
- Modify: `frontend/src/motion/testset/copyDetectionCases.test.ts`
- Modify: `frontend/src/motion/testset/copyDetection.test.ts` (totals), regenerate `scorecard.baseline.json`
- Modify: `frontend/src/motion/testset/portedScorecard.test.ts` (totals + finite-or-null loop), regenerate `scorecard.ported.baseline.json`
- Modify: `frontend/src/motion/testset/README.md`

**Interfaces:**
- Consumes: `MotionCurves` (motionCurves.ts), the existing case builder.
- Produces: `CaseClass` union gains `'partial-coverage'`; 4 new negative cases with ids `robot:neg-partial:low:Walking`, `robot:neg-partial:half:Walking`, `fox:neg-partial:low:Walk`, `fox:neg-partial:half:Walk`. New totals everywhere: negatives 97, all cases 217.

- [ ] **Step 1: Write the failing tests (update copyDetectionCases.test.ts)**

Replace the second and fourth `it` blocks and ADD one:

```ts
  it('produces within-rig negatives only: 92 robot + 5 fox, plus the one variant pair', () => {
    const negatives = cases.filter((entry) => entry.kind === 'negative');
    expect(negatives.filter((entry) => entry.rigId === 'robot')).toHaveLength(92);
    expect(negatives.filter((entry) => entry.rigId === 'fox')).toHaveLength(5);
    expect(cases.filter((entry) => entry.kind === 'variant')).toHaveLength(1);
    expect(cases.find((entry) => entry.kind === 'variant')!.id).toBe('robot:variant:WalkJump-vs-Walking');
  });

  it('builds partial-coverage negatives that genuinely share only a slice of the skeleton', () => {
    const partial = cases.filter((entry) => entry.caseClass === 'partial-coverage');
    expect(partial.map((entry) => entry.id).sort()).toEqual([
      'fox:neg-partial:half:Walk', 'fox:neg-partial:low:Walk',
      'robot:neg-partial:half:Walking', 'robot:neg-partial:low:Walking',
    ]);
    for (const entry of partial) {
      expect(entry.kind).toBe('negative');
      const sourceNames = new Set(entry.source.tracks.map((track) => track.name));
      const candidateNames = entry.candidate.tracks.map((track) => track.name);
      const shared = candidateNames.filter((name) => sourceNames.has(name));
      const renamed = candidateNames.filter((name) => !sourceNames.has(name));
      expect(shared.length).toBeGreaterThan(0);
      expect(renamed.length).toBeGreaterThan(0);
      expect(entry.id.includes(':low:') ? shared.length <= 2 : shared.length >= Math.floor(candidateNames.length / 3)).toBe(true);
      for (const name of renamed) expect(name.startsWith('Unshared')).toBe(true);
    }
  });
```

And in the totals test, cases.length is unchanged for positives (still 119) — no edit needed there.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/motion/testset/copyDetectionCases.test.ts`
Expected: FAIL — 90/3 negatives found where 92/5 expected; `partial-coverage` class missing.

- [ ] **Step 3: Implement in copyDetectionCases.ts**

Extend the `CaseClass` union with `'partial-coverage'`, then add after the variant/family constants:

```ts
// Partial-coverage negatives (Phase 1b): a candidate that shares only SOME tracks
// with the source — the rest renamed to unshared joints. Identical curve data on
// the shared slice makes these maximally hard: any engine whose composition
// under-penalizes low coverage will flag them, and flagging a clip that shares
// one limb's motion with 20 unrelated tracks is a false accusation.
const PARTIAL_SOURCE: Record<string, string> = { robot: 'Walking', fox: 'Walk' };

function partialCoverageCandidate(clip: MotionCurves, sharedCount: number): MotionCurves {
  const tracks = clip.tracks.map((track, index) => (
    index < sharedCount
      ? { ...track, times: track.times.slice(), values: track.values.slice() }
      : { ...track, name: `Unshared${index}.${track.name.slice(track.name.lastIndexOf('.') + 1)}`, times: track.times.slice(), values: track.values.slice() }
  ));
  return { ...clip, name: `${clip.name} (partial ${sharedCount})`, tracks };
}
```

And inside `buildCases`'s per-fixture loop, after the negative-pairs loop:

```ts
    const partialSource = fixture.clips.find((clip) => clip.name === PARTIAL_SOURCE[fixture.rigId]);
    if (!partialSource) throw new Error(`partial-coverage source clip missing for rig ${fixture.rigId}`);
    for (const [label, sharedCount] of [['low', 2], ['half', Math.floor(partialSource.tracks.length / 2)]] as const) {
      cases.push({
        id: `${fixture.rigId}:neg-partial:${label}:${partialSource.name}`,
        rigId: fixture.rigId,
        kind: 'negative',
        caseClass: 'partial-coverage',
        sourceName: partialSource.name,
        candidateName: `${partialSource.name} (partial ${sharedCount})`,
        source: partialSource,
        candidate: partialCoverageCandidate(partialSource, sharedCount),
      });
    }
```

- [ ] **Step 4: Update both harness totals and regenerate both baselines deliberately**

In `copyDetection.test.ts` and `portedScorecard.test.ts`: `falsePositives.overall.total` expectation 93 → 97. In `portedScorecard.test.ts`, extend the coverage test with the finite-or-null loop (Phase 1a review hardening):

```ts
    for (const row of scorecard.rows) {
      expect(row.score === null || Number.isFinite(row.score), `${row.id} produced a non-finite score`).toBe(true);
    }
```

Then regenerate (Git Bash):
```bash
cd frontend
npx vitest run src/motion/testset/ # expect ONLY the two baseline tests failing (new cases unknown to committed baselines)
UPDATE_MOTION_BASELINE=1 npx vitest run src/motion/testset/copyDetection.test.ts
UPDATE_MOTION_PORTED_BASELINE=1 npx vitest run src/motion/testset/portedScorecard.test.ts
npx vitest run src/motion/testset/  # all green
git diff --stat -- src/motion/testset/*.baseline.json  # both changed: RECORD the per-class deltas in your report
```
CRITICAL measurement to record: how each engine scores the 4 new negatives (current engine expected: NOT flagged — harmonic guard; ported engine expected: not flagged at 'low' (~85 < 90), WATCH 'half' (Java-linear ≈ 90-93 → may flag — that measured fact is the ammunition for Task 3's composition change; record it either way).

- [ ] **Step 5: README — add under "Labels"**

```markdown
- `partial-coverage` negatives: the source clip vs a copy of itself where only a
  slice of tracks keeps its joint names (2 = "low", half = "half") and the rest are
  renamed to unshared joints. Sharing one limb's curves with an otherwise unrelated
  rig is not theft evidence — an engine that flags these over-trusts coverage.
```

- [ ] **Step 6: Full suite + typecheck, commit**

```bash
cd frontend && npm run typecheck && npm test
git add src/motion/testset
git commit -m "Motion test set: partial-coverage negatives (4 cases, baselines regenerated)"
```

---

### Task 3: v2 engine — Java-lineage composition with multiplicative coverage (graded change #1)

**Files:**
- Create: `frontend/src/motion/motionEngine.ts`
- Create: `frontend/src/motion/motionEngine.test.ts`
- Modify: `frontend/src/motion/testset/scorecard.ts` (append `tunedEngineAdapter`)
- Create: `frontend/src/motion/testset/tunedScorecard.test.ts` + generate `scorecard.tuned.baseline.json`

**Interfaces:**
- Consumes: Task 1 exports; `clipToNormalized`; testset infrastructure.
- Produces (Tasks 4–7 rely on): `compareMotion(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson, options?: MotionEngineOptions): MotionComparisonV2`; `interface MotionEngineOptions { sampleCount?: number; poseWeights?: PoseBlendWeights }`; `interface MotionComparisonV2 { engineVersion: string; overallPercent: number; posePercent: number; timingPercent: number; coveragePercent: number; durationPercent: number; warpScore: number; exactCurveData: boolean; verdict: NormalizedVerdict; jointScores: NormalizedJointScore[]; frameScores: Array<{ sampleIndex: number; posePercent: number }>; commonJointCount: number; allJointCount: number }`; `V2_POSE_WEIGHTS: PoseBlendWeights`; `ENGINE_V2_VERSION = 'creatorflow.motion-comparison/v2-web'`; `tunedEngineAdapter(): EngineAdapter`.
- **Stage note:** in THIS task v2 uses lockstep sampling (`t_i = i/(N−1)·duration`, pairs (i,i) only), JAVA_POSE_WEIGHTS, Java's timingPercent — the ONLY divergence is the composition `overall = (pose·0.8 + timing·0.2)·coverage/100`. `V2_POSE_WEIGHTS` is introduced in Task 4; `warpScore` is 100 (no warp measured) until Task 5. This isolates the composition's scorecard effect.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/motion/motionEngine.test.ts
import { describe, expect, it } from 'vitest';
import type { NormalizedAnimationJson, NormalizedKeyframeJson, NormalizedPoseJson } from './normalizedMotion';
import { compareNormalized } from './motionEngineCore';
import { compareMotion, ENGINE_V2_VERSION } from './motionEngine';

function pose(jointPath: string, x: number, yawDegrees: number): NormalizedPoseJson {
  const angle = (yawDegrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { jointPath, transform: [x, 0, 0, c, 0, s, 0, 1, 0, -s, 0, c], weight: 1, easingStyle: 'Linear', easingDirection: 'InOut' };
}
const keyframe = (time: number, ...poses: NormalizedPoseJson[]): NormalizedKeyframeJson => ({ time, poses });
const animation = (assetId: string, duration: number, ...keyframes: NormalizedKeyframeJson[]): NormalizedAnimationJson =>
  ({ assetId, name: assetId, duration, looped: false, priority: 'Movement', keyframes });

describe('compareMotion (v2) — composition stage', () => {
  const walk = (id: string) => animation(id, 1,
    keyframe(0, pose('Root/Hip', 0, 0)), keyframe(0.5, pose('Root/Hip', 0.25, 35)), keyframe(1, pose('Root/Hip', 0, 70)));

  it('matches the parity core exactly at full coverage except for the composition', () => {
    const source = walk('100');
    const candidate = animation('200', 1,
      keyframe(0, pose('Root/Hip', 0, 0)), keyframe(0.5, pose('Root/Hip', 0.9, 120)), keyframe(1, pose('Root/Hip', 0, 70)));
    const v1 = compareNormalized(source, candidate);
    const v2 = compareMotion(source, candidate);
    expect(v2.engineVersion).toBe(ENGINE_V2_VERSION);
    expect(v2.posePercent).toBe(v1.posePercent);            // same kernel, same lockstep in this stage
    expect(v2.timingPercent).toBe(v1.timingPercent);
    expect(v2.coveragePercent).toBe(v1.coveragePercent);
    const expectedOverall = Math.round(((v1.posePercent * 0.8 + v1.timingPercent * 0.2) * v1.coveragePercent) / 100 * 100) / 100;
    expect(v2.overallPercent).toBeCloseTo(expectedOverall, 1);
  });

  it('annihilates tiny-overlap scores instead of promoting them (the false-accusation guard)', () => {
    // 1 shared joint of 21 total: pose/timing 100, coverage ~4.76 -> overall ~4.76, LOW verdict
    const sharedPose = (id: string) => keyframe(0, pose('Root/Hip', 0, 0));
    const sharedPose2 = (id: string) => keyframe(1, pose('Root/Hip', 0.2, 30));
    const withExtras = (id: string, prefix: string) => animation(id, 1,
      { time: 0, poses: [pose('Root/Hip', 0, 0), ...Array.from({ length: 10 }, (_, i) => pose(`${prefix}${i}`, 0, 10))] },
      { time: 1, poses: [pose('Root/Hip', 0.2, 30), ...Array.from({ length: 10 }, (_, i) => pose(`${prefix}${i}`, 0, 40))] });
    const result = compareMotion(withExtras('100', 'SourceOnly'), withExtras('200', 'CandidateOnly'));
    expect(result.coveragePercent).toBeCloseTo(100 / 21, 1);
    expect(result.overallPercent).toBeLessThan(10);
    expect(result.verdict).toBe('LOW_SIMILARITY');
  });

  it('does not inflate at full coverage the way the old harmonic mean did', () => {
    const source = walk('100');
    const candidate = animation('200', 1,
      keyframe(0, pose('Root/Hip', 0, 15)), keyframe(0.5, pose('Root/Hip', 0.25, 50)), keyframe(1, pose('Root/Hip', 0, 85)));
    const v2 = compareMotion(source, candidate);
    // overall must never exceed its pose/timing blend when coverage is 100
    expect(v2.overallPercent).toBeLessThanOrEqual(v2.posePercent * 0.8 + v2.timingPercent * 0.2 + 0.01);
  });

  it('keeps exact-curve recognition and the 100 override', () => {
    const result = compareMotion(walk('100'), walk('200'));
    expect(result.exactCurveData).toBe(true);
    expect(result.verdict).toBe('EXACT_CURVE_DATA');
    expect(result.overallPercent).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/motion/motionEngine.test.ts` → cannot resolve `./motionEngine`.

- [ ] **Step 3: Implement motionEngine.ts (composition stage)**

```ts
// frontend/src/motion/motionEngine.ts
/**
 * The web's ONE user-facing motion engine (v2): the parity-proven Java kernel
 * (motionEngineCore primitives) with three deliberate, separately-graded
 * divergences, each pinned by the scorecard + golden vectors:
 *   1. overall = (pose*0.8 + timing*0.2) * coverage/100  — guards tiny-overlap
 *      false accusations without the old harmonic mean's full-coverage inflation.
 *   2. (Task 4) position de-weighted 0.42 -> 0.25 toward rotation (handoff finding 7).
 *   3. (Task 5) banded DTW replaces lockstep sampling; warp-aware timing composite.
 * compareNormalized in motionEngineCore stays parity-locked to Java — v2 composes
 * its exported primitives and NEVER changes them.
 */
import type { NormalizedAnimationJson } from './normalizedMotion';
import {
  JAVA_POSE_WEIGHTS, type NormalizedJointScore, type NormalizedVerdict, type PoseBlendWeights,
  canonicalCurvesEqual, poseDelta, round, sample, trackMetadataPercent, tracks,
} from './motionEngineCore';

export const ENGINE_V2_VERSION = 'creatorflow.motion-comparison/v2-web';

export interface MotionEngineOptions {
  sampleCount?: number;
  poseWeights?: PoseBlendWeights;
}

export interface MotionComparisonV2 {
  engineVersion: string;
  overallPercent: number;
  posePercent: number;
  timingPercent: number;
  coveragePercent: number;
  durationPercent: number;
  warpScore: number;
  exactCurveData: boolean;
  verdict: NormalizedVerdict;
  jointScores: NormalizedJointScore[];
  frameScores: Array<{ sampleIndex: number; posePercent: number }>;
  commonJointCount: number;
  allJointCount: number;
}

function durationPercentOf(source: NormalizedAnimationJson, candidate: NormalizedAnimationJson): number {
  if (source.duration === 0 && candidate.duration === 0) return 100;
  if (source.duration === 0 || candidate.duration === 0) return 0;
  return (100 * Math.min(source.duration, candidate.duration)) / Math.max(source.duration, candidate.duration);
}

function verdictFor(exact: boolean, overallPercent: number): NormalizedVerdict {
  if (exact) return 'EXACT_CURVE_DATA';
  if (overallPercent >= 90) return 'HIGH_SIMILARITY';
  if (overallPercent >= 70) return 'MODERATE_SIMILARITY';
  return 'LOW_SIMILARITY';
}

export function compareMotion(
  source: NormalizedAnimationJson,
  candidate: NormalizedAnimationJson,
  options: MotionEngineOptions = {},
): MotionComparisonV2 {
  const sampleCount = Math.max(13, Math.round(options.sampleCount ?? 49));
  const weights = options.poseWeights ?? JAVA_POSE_WEIGHTS;
  const exact = canonicalCurvesEqual(source, candidate);

  const sourceTracks = tracks(source);
  const candidateTracks = tracks(candidate);
  const allJoints = [...new Set([...sourceTracks.keys(), ...candidateTracks.keys()])].sort();
  const commonJoints = [...sourceTracks.keys()].filter((joint) => candidateTracks.has(joint)).sort();
  let coveragePercent = allJoints.length === 0 ? 0 : (100 * commonJoints.length) / allJoints.length;

  // Composition stage: lockstep (i,i) sampling, exactly as the parity core does.
  const perJoint = new Map<string, { poseTotal: number; positionTotal: number; rotationTotal: number; maxPosition: number; maxRotation: number }>();
  for (const joint of commonJoints) perJoint.set(joint, { poseTotal: 0, positionTotal: 0, rotationTotal: 0, maxPosition: 0, maxRotation: 0 });
  const frameScores: Array<{ sampleIndex: number; posePercent: number }> = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const normalizedTime = sampleIndex / (sampleCount - 1);
    const sourceTime = normalizedTime * source.duration;
    const candidateTime = normalizedTime * candidate.duration;
    let frameTotal = 0;
    for (const joint of commonJoints) {
      const delta = poseDelta(sample(sourceTracks.get(joint)!, sourceTime), sample(candidateTracks.get(joint)!, candidateTime), weights);
      const acc = perJoint.get(joint)!;
      acc.poseTotal += delta.posePercent;
      acc.positionTotal += delta.positionDelta;
      acc.rotationTotal += delta.rotationDelta;
      acc.maxPosition = Math.max(acc.maxPosition, delta.positionDelta);
      acc.maxRotation = Math.max(acc.maxRotation, delta.rotationDelta);
      frameTotal += delta.posePercent;
    }
    frameScores.push({ sampleIndex, posePercent: round(commonJoints.length === 0 ? 0 : frameTotal / commonJoints.length, 2) });
  }

  const jointScores: NormalizedJointScore[] = [];
  let poseTotal = 0;
  for (const joint of allJoints) {
    const inSource = sourceTracks.has(joint);
    const inCandidate = candidateTracks.has(joint);
    if (!inSource || !inCandidate) {
      jointScores.push({ jointPath: joint, presentInSource: inSource, presentInCandidate: inCandidate, posePercent: 0, meanPositionDelta: 0, maxPositionDelta: 0, meanRotationDeltaDegrees: 0, maxRotationDeltaDegrees: 0 });
      continue;
    }
    const acc = perJoint.get(joint)!;
    const metadataPercent = trackMetadataPercent(sourceTracks.get(joint)!, candidateTracks.get(joint)!);
    const jointPercent = (acc.poseTotal / sampleCount) * 0.96 + metadataPercent * 0.04;
    poseTotal += jointPercent;
    jointScores.push({
      jointPath: joint,
      presentInSource: true,
      presentInCandidate: true,
      posePercent: round(jointPercent, 2),
      meanPositionDelta: round(acc.positionTotal / sampleCount, 6),
      maxPositionDelta: round(acc.maxPosition, 6),
      meanRotationDeltaDegrees: round((acc.rotationTotal / sampleCount) * (180 / Math.PI), 3),
      maxRotationDeltaDegrees: round(acc.maxRotation * (180 / Math.PI), 3),
    });
  }

  let posePercent = commonJoints.length === 0 ? 0 : poseTotal / commonJoints.length;
  const durationPercent = durationPercentOf(source, candidate);
  // Composition stage keeps the Java timing heuristic verbatim via the core export.
  let timing = javaTimingPercent(source, candidate);
  const warpScore = 100; // no warp measured until the DTW stage (Task 5)

  let overallPercent = ((posePercent * 0.8 + timing * 0.2) * coveragePercent) / 100;
  if (exact) {
    posePercent = 100;
    timing = 100;
    coveragePercent = 100;
    overallPercent = 100;
  }

  return {
    engineVersion: ENGINE_V2_VERSION,
    overallPercent: round(overallPercent, 2),
    posePercent: round(posePercent, 2),
    timingPercent: round(timing, 2),
    coveragePercent: round(coveragePercent, 2),
    durationPercent: round(durationPercent, 2),
    warpScore: round(warpScore, 2),
    exactCurveData: exact,
    verdict: verdictFor(exact, overallPercent),
    jointScores,
    frameScores,
    commonJointCount: commonJoints.length,
    allJointCount: allJoints.length,
  };
}
```

Also add to motionEngineCore.ts exports (Task 1 already exported `trackMetadataPercent`; export `timingPercent as javaTimingPercent` is NOT possible without renaming — instead in motionEngine.ts import it directly):

```ts
import { timingPercent as javaTimingPercent } from './motionEngineCore';
```
(and add `export` to `timingPercent` in Task 1's list — controller note: Task 1's export list MUST include `timingPercent`.)

- [ ] **Step 4: Adapter + tuned harness**

Append to `frontend/src/motion/testset/scorecard.ts`:

```ts
import { compareMotion } from '../motionEngine';

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
```

Create `frontend/src/motion/testset/tunedScorecard.test.ts` — identical structure to portedScorecard.test.ts with: title `'v2 web engine (composition stage)'` (UPDATE the title string at each graded stage: Task 4 → `'v2 web engine (de-weight stage)'`, Task 5 → `'v2 web engine (DTW)'` — the baseline diff then shows WHICH stage moved which case), baseline path `./scorecard.tuned.baseline.json`, env var `UPDATE_MOTION_TUNED_BASELINE`, totals 119/97/1, the reupload anchor, the no-evidence guard test (reuse the morph-only construction), and the finite-or-null loop.

```ts
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

const ENGINE_TITLE = 'v2 web engine (composition stage)';
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
```

- [ ] **Step 5: Generate + GRADE**

```bash
cd frontend && npx vitest run src/motion/motionEngine.test.ts        # 4/4
UPDATE_MOTION_TUNED_BASELINE=1 npx vitest run src/motion/testset/tunedScorecard.test.ts
npx vitest run src/motion/testset/tunedScorecard.test.ts             # 5/5
npm run typecheck && npm test
```
RECORD in the report: full per-class deltas v2-composition vs ported baseline. Expected direction (verify, don't force): partial-coverage 0 flagged (the composition's whole point); family stays 0; recall classes ~unchanged vs ported (full coverage → composition is near-identity there, modulo pose 0.65→0.8 timing 0.20→0.2 reweight). GATE: no recall class may drop by more than 1 case vs the ported baseline; FP must be ≤ ported's. If violated: STOP, report.

- [ ] **Step 6: Commit** — `git add src/motion/motionEngine.ts src/motion/motionEngine.test.ts src/motion/testset/scorecard.ts src/motion/testset/tunedScorecard.test.ts src/motion/testset/scorecard.tuned.baseline.json && git commit -m "Motion engine v2: multiplicative-coverage composition (graded)"`

---

### Task 4: De-weight the position term (graded change #2)

**Files:**
- Modify: `frontend/src/motion/motionEngine.ts` (V2_POSE_WEIGHTS + default swap; ~4 lines)
- Modify: `frontend/src/motion/motionEngine.test.ts` (one new test)
- Modify: `frontend/src/motion/testset/tunedScorecard.test.ts` (ENGINE_TITLE → `'v2 web engine (de-weight stage)'`), regenerate baseline

**Interfaces:** Produces `export const V2_POSE_WEIGHTS: PoseBlendWeights = { position: 0.25, rotation: 0.65, weight: 0.1 };` — the new default for `compareMotion` (`options.poseWeights ?? V2_POSE_WEIGHTS`).

- [ ] **Step 1: Failing test (add to motionEngine.test.ts)**

```ts
describe('compareMotion (v2) — de-weight stage', () => {
  it('weights rotation over absolute position (finding 7)', () => {
    const still = (id: string, x: number, yaw: number) => animation(id, 1,
      keyframe(0, pose('Root/Hip', x, yaw)), keyframe(1, pose('Root/Hip', x, yaw)));
    // pure position offset of 1.0 vs pure rotation offset of 90 degrees:
    const positionOnly = compareMotion(still('100', 0, 0), still('200', 1, 0));
    const rotationOnly = compareMotion(still('100', 0, 0), still('200', 0, 90));
    // Under Java weights positionOnly pose ~63.9 < rotationOnly ~54.8; de-weighted, the order flips.
    expect(positionOnly.posePercent).toBeGreaterThan(rotationOnly.posePercent);
    // position kernel now contributes 0.25: pose = 0.25*10.54 + 0.65*100 + 0.10*100 = 77.63 -> *0.96+4 = 78.53
    expect(positionOnly.posePercent).toBeCloseTo(78.53, 1);
  });
});
```

- [ ] **Step 2: Run — new test fails** (position weight still 0.42 → 63.93 not 78.53).

- [ ] **Step 3: Implement** — in motionEngine.ts:

```ts
/** Finding 7: absolute position partly measures rig identity; de-weight toward rotation. */
export const V2_POSE_WEIGHTS: PoseBlendWeights = { position: 0.25, rotation: 0.65, weight: 0.1 };
```
and `const weights = options.poseWeights ?? V2_POSE_WEIGHTS;`

- [ ] **Step 4: Grade** — update ENGINE_TITLE, regenerate tuned baseline (same commands), record per-class deltas vs Task 3's baseline. GATE (handoff): FP must not rise (watch robot No-vs-Yes — rotation now counts more, its Head-difference should push it DOWN; record whether the last unrelated FP clears); recall may shave slightly — record exactly which cases move. Full suite + typecheck.

- [ ] **Step 5: Commit** — `git commit -m "Motion engine v2: de-weight absolute position toward rotation (graded)"` (with the four files).

---

### Task 5: Banded DTW replaces lockstep (graded change #3)

**Files:**
- Modify: `frontend/src/motion/motionEngine.ts` (the sampling/aggregation core)
- Modify: `frontend/src/motion/motionEngine.test.ts` (DTW tests)
- Modify: `frontend/src/motion/testset/tunedScorecard.test.ts` (ENGINE_TITLE → `'v2 web engine (DTW)'`), regenerate baseline
- Modify: `frontend/src/motion/testset/README.md` (v2 engine section)

**Interfaces:** `compareMotion` signature unchanged. `warpScore` becomes real: `100·max(0, 1 − meanWarp/band)`. `timingPercent` of v2 becomes the composite `durationPercent·0.5 + warpScore·0.5` (the Java pattern heuristic is DROPPED from v2 — DTW subsumes it, per the handoff).

- [ ] **Step 1: Failing tests (add to motionEngine.test.ts)**

```ts
describe('compareMotion (v2) — banded DTW stage', () => {
  const posesAt = (yaw: number) => pose('Root/Hip', 0, yaw);
  /** A clip whose yaw sweeps 0..90 with an inserted hold between 40% and 70% of the timeline. */
  const heldSweep = (id: string) => animation(id, 1.3,
    keyframe(0, posesAt(0)), keyframe(0.4, posesAt(36)), keyframe(0.7, posesAt(36)), keyframe(1.3, posesAt(90)));
  const sweep = (id: string) => animation(id, 1,
    keyframe(0, posesAt(0)), keyframe(0.4, posesAt(36)), keyframe(1, posesAt(90)));

  it('aligns an inserted hold elastically instead of punishing the lockstep misalignment', () => {
    const dtw = compareMotion(sweep('100'), heldSweep('200'));
    // Lockstep at these samples misaligns the post-hold sweep; DTW re-aligns it.
    expect(dtw.posePercent).toBeGreaterThan(97);
    expect(dtw.warpScore).toBeLessThan(100);   // the alignment cost shows up as warp, not pose damage
    expect(dtw.verdict).toBe('HIGH_SIMILARITY');
  });

  it('reports zero warp and full timing for identical timelines', () => {
    const result = compareMotion(sweep('100'), sweep('200'));
    expect(result.exactCurveData).toBe(true);   // identical curves
    const nearCopy = compareMotion(sweep('100'), animation('300', 1,
      keyframe(0, posesAt(1)), keyframe(0.4, posesAt(37)), keyframe(1, posesAt(91))));
    expect(nearCopy.warpScore).toBe(100);
    expect(nearCopy.timingPercent).toBe(100);
  });

  it('stays deterministic: two runs produce identical results', () => {
    const first = compareMotion(sweep('100'), heldSweep('200'));
    const second = compareMotion(sweep('100'), heldSweep('200'));
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 2: Run — fails** (lockstep pose < 97 for the held sweep, warpScore hardcoded 100).

- [ ] **Step 3: Implement the DTW core in motionEngine.ts**

Replace the lockstep sampling block with:

```ts
  // --- Banded DTW over lockstep sample grids (handoff finding 6) ---
  // Cost cell = DISTANCE (1 - posePercent/100), never similarity: DTW minimizes.
  // Duration-aware band: a duration mismatch of fraction f shifts alignment by up to
  // f*(N-1) samples (a 30% inserted hold needs ~23% of the timeline), so the band
  // floors at 12.5% but grows to cover that shift, capped at 35%. Same-duration
  // pairs (all our negatives) keep the tight 12.5% corridor.
  const maxDuration = Math.max(source.duration, candidate.duration);
  const durationShift = maxDuration === 0 ? 0 : Math.abs(source.duration - candidate.duration) / maxDuration;
  const band = Math.min(
    Math.round(0.35 * (sampleCount - 1)),
    Math.max(2, Math.round(0.125 * (sampleCount - 1)), Math.ceil(durationShift * (sampleCount - 1)) + 2),
  );
  const sourceSamples: PoseSample[][] = [];
  const candidateSamples: PoseSample[][] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const normalizedTime = i / (sampleCount - 1);
    sourceSamples.push(commonJoints.map((joint) => sample(sourceTracks.get(joint)!, normalizedTime * source.duration)));
    candidateSamples.push(commonJoints.map((joint) => sample(candidateTracks.get(joint)!, normalizedTime * candidate.duration)));
  }
  const jointCount = commonJoints.length;
  const cellDeltas = (i: number, j: number): PoseDelta[] =>
    sourceSamples[i].map((sourcePose, jointIndex) => poseDelta(sourcePose, candidateSamples[j][jointIndex], weights));
  const cellCost = (deltas: PoseDelta[]): number =>
    jointCount === 0 ? 1 : 1 - deltas.reduce((total, delta) => total + delta.posePercent, 0) / jointCount / 100;

  // DP within the Sakoe-Chiba band.
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(INF));
  const accumulated: number[][] = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(INF));
  for (let i = 0; i < sampleCount; i += 1) {
    for (let j = Math.max(0, i - band); j <= Math.min(sampleCount - 1, i + band); j += 1) {
      cost[i][j] = cellCost(cellDeltas(i, j));
    }
  }
  accumulated[0][0] = cost[0][0];
  for (let i = 0; i < sampleCount; i += 1) {
    for (let j = Math.max(0, i - band); j <= Math.min(sampleCount - 1, i + band); j += 1) {
      if (i === 0 && j === 0) continue;
      const diag = i > 0 && j > 0 ? accumulated[i - 1][j - 1] : INF;
      const up = i > 0 ? accumulated[i - 1][j] : INF;
      const left = j > 0 ? accumulated[i][j - 1] : INF;
      accumulated[i][j] = cost[i][j] + Math.min(diag, up, left);
    }
  }
  // Backtrack (diag preferred on ties -> deterministic), collecting the path.
  const path: Array<[number, number]> = [];
  let pi = sampleCount - 1;
  let pj = sampleCount - 1;
  while (pi > 0 || pj > 0) {
    path.push([pi, pj]);
    const diag = pi > 0 && pj > 0 ? accumulated[pi - 1][pj - 1] : INF;
    const up = pi > 0 ? accumulated[pi - 1][pj] : INF;
    const left = pj > 0 ? accumulated[pi][pj - 1] : INF;
    if (diag <= up && diag <= left) { pi -= 1; pj -= 1; }
    else if (up <= left) { pi -= 1; }
    else { pj -= 1; }
  }
  path.push([0, 0]);
  path.reverse();
  const pathLength = path.length;
  const meanWarp = path.reduce((total, [i, j]) => total + Math.abs(i - j), 0) / pathLength;
  const warpScoreRaw = 100 * Math.max(0, 1 - meanWarp / band);

  // Per-joint + per-frame aggregation along the ALIGNED path.
  const perJoint = new Map<string, { poseTotal: number; positionTotal: number; rotationTotal: number; maxPosition: number; maxRotation: number }>();
  for (const joint of commonJoints) perJoint.set(joint, { poseTotal: 0, positionTotal: 0, rotationTotal: 0, maxPosition: 0, maxRotation: 0 });
  const frameTotals = Array(sampleCount).fill(0);
  const frameCounts = Array(sampleCount).fill(0);
  for (const [i, j] of path) {
    const deltas = cellDeltas(i, j);
    let cellTotal = 0;
    deltas.forEach((delta, jointIndex) => {
      const acc = perJoint.get(commonJoints[jointIndex])!;
      acc.poseTotal += delta.posePercent;
      acc.positionTotal += delta.positionDelta;
      acc.rotationTotal += delta.rotationDelta;
      acc.maxPosition = Math.max(acc.maxPosition, delta.positionDelta);
      acc.maxRotation = Math.max(acc.maxRotation, delta.rotationDelta);
      cellTotal += delta.posePercent;
    });
    frameTotals[i] += jointCount === 0 ? 0 : cellTotal / jointCount;
    frameCounts[i] += 1;
  }
  const frameScores = frameTotals.map((total, index) => ({
    sampleIndex: index,
    posePercent: round(frameCounts[index] ? total / frameCounts[index] : 0, 2),
  }));
```

and in the joint-score loop divide accumulations by `perJointPathCount` = pathLength (each path cell touches every joint once): use `acc.poseTotal / pathLength`, `acc.positionTotal / pathLength`, `acc.rotationTotal / pathLength`. Replace the timing line with:

```ts
  const warpScore = warpScoreRaw;
  let timing = durationPercent * 0.5 + warpScore * 0.5;
```
(The Java pattern-heuristic import `javaTimingPercent` is removed from this file.)

PERFORMANCE NOTE: cells computed = sampleCount·(2·band+1) ≈ 49·13 = 637 per comparison, each over all common joints — same order of work as the ported engine's 49·joints lockstep×13. The 213-case scorecard stays in the low seconds. `cellDeltas` is recomputed during path aggregation for only ~2·sampleCount cells; do not cache all cells' deltas (memory) — recomputing the path cells is cheaper and deterministic.

- [ ] **Step 4: Grade** — update ENGINE_TITLE to `'v2 web engine (DTW)'`, regenerate tuned baseline, run everything. HARD GATES (handoff): hold class 17/17 (this is what DTW is FOR — if it doesn't recover both hold misses, STOP and diagnose the band/penalty before committing); retime classes stay 17/17; FP total must not exceed Task 4's; partial-coverage stays 0 flagged. Record all per-class deltas.

- [ ] **Step 5: README** — replace the Phase 1a "Ported engine" paragraph's last sentence and add:

```markdown
## v2 web engine (Phase 1b)

`tunedScorecard.test.ts` grades the v2 engine (`compareMotion`): the parity-proven
Java kernel + three graded divergences — multiplicative coverage (no tiny-overlap
false accusations, no full-coverage inflation), position de-weighted 0.25/0.65/0.10
(finding 7), and banded DTW (Sakoe-Chiba 12.5%) with a duration+warp timing
composite. Baseline: `scorecard.tuned.baseline.json`, regenerated per graded stage
(`UPDATE_MOTION_TUNED_BASELINE=1`). The parity-locked `compareNormalized` and its
oracle test remain untouched as the Java-fidelity anchor.
```

- [ ] **Step 6: Full suite + typecheck; commit** — `git commit -m "Motion engine v2: banded DTW with warp-aware timing (graded)"`

---

### Task 6: v2 golden vectors

**Files:**
- Create: `frontend/src/motion/motionEngineGolden.test.ts`
- Generate + commit: `frontend/src/motion/motion-engine-golden.json`

**Interfaces:** Consumes `compareMotion`, the parity oracle's INPUTS (reused as diverse normalized pairs — the oracle's Java outputs are irrelevant here), and two synthetic partial-coverage pairs. Pins the v2 engine's own behavior post-1b.

- [ ] **Step 1: Write the golden test**

```ts
// frontend/src/motion/motionEngineGolden.test.ts
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
```

- [ ] **Step 2–4:** Run (fails: golden missing) → generate with `UPDATE_MOTION_GOLDEN=1` → re-run green (2 tests) → full suite + typecheck → commit `"Motion engine v2: golden vectors pin post-1b behavior"`.

---

### Task 7: Live cutover — analyzeMotionClips shape/timing modes run v2

**Files:**
- Modify: `frontend/src/motion/motionAnalysis.ts` (the `analyzeMotionClips` shape/timing path ONLY; loop/root code untouched)
- Modify: `frontend/src/components/MotionComparisonLab.test.ts` (updated numeric expectations where honestly changed — each with a justification comment)
- Regenerate: `frontend/src/motion/testset/scorecard.baseline.json` (the "current engine" IS now v2-through-the-UI)
- Modify: `frontend/src/motion/testset/README.md` + `frontend/src/motion/testset/copyDetection.test.ts` ENGINE_TITLE → `'live web engine (v2 via analyzeMotionClips)'`

**Interfaces:**
- `analyzeMotionClips` and `MotionAnalysisResult` keep their EXACT current signatures and shapes (MotionComparisonLab.tsx requires zero changes).
- Mapping contract (shape & timing modes): scope filter via existing `trackMatchesJointScope` on raw track names BEFORE `clipToNormalized`; `exactCurveData` = existing raw `exactCurveMatch(source, candidate)` (morphs included) — the v2 result's exact flag is not used for the UI field; `pose` = v2 `posePercent` (rounded to integer as today); `timing` = v2 `timingPercent` (integer); `durationSimilarity` = v2 `durationPercent` (integer); `coverage` = v2 `coveragePercent` (integer); `overall`/`primaryValue` = round(v2 `overallPercent`) for shape mode, round(v2 `timingPercent`) composed the same way for timing mode (`(timing·0.8 + pose·0.2)·coverage/100` — mirror composition with timing leading); `frameScores` = v2 frameScores posePercent/100 (0..1 floats as today); `trackScores` = v2 jointScores mapped to `{ name: motionTrackLabel(jointPath + '.quaternion'), rawName: jointPath, score: posePercent/100, worstScore: posePercent/100, worstProgress: 0 }` sorted ascending, missing-joint entries filtered out (presentInSource && presentInCandidate only); counts/durations/keys computed from the scoped clips exactly as today; verdict/tone via the existing `relationshipVerdict` + threshold logic unchanged; `sampleCount` option maps to v2 `sampleCount = uiSampleCount + 1`.
- Behaviors that MUST keep passing untouched Lab tests: exact-copy recognition (raw), shape-vs-timing separation for a retimed clip, jointScope commonTracks/keys counts, tiny-overlap guard (`primaryValue < 10`), loop mode results, root mode results, non-mutation.

- [ ] **Step 1: Run the Lab tests BEFORE changing anything** — `npx vitest run src/components/MotionComparisonLab.test.ts` (8 green) — this is the before-state.

- [ ] **Step 2: Rewrite the shape/timing path in analyzeMotionClips**

Replace the body's shape/timing computation (keep loop/root code identical). The new imports at top of motionAnalysis.ts:

```ts
import { clipToNormalized } from './clipToNormalized';
import { compareMotion } from './motionEngine';
```

Inside `analyzeMotionClips`, replace the `compareTrackPairs` phase/authored computations and the pose/timing/overall derivation with:

```ts
  const scopedSourceClip = new AnimationClip(source.name, source.duration, scopedSource);
  const scopedCandidateClip = new AnimationClip(candidate.name, candidate.duration, scopedCandidate);
  const v2 = compareMotion(
    clipToNormalized(scopedSourceClip, source.name),
    clipToNormalized(scopedCandidateClip, candidate.name),
    { sampleCount: sampleCount + 1 },
  );
  const pose = Math.round(v2.posePercent);
  const durationSimilarity = Math.round(v2.durationPercent);
  const timing = Math.round(v2.timingPercent);
  const coveragePercent = Math.round(v2.coveragePercent);
  const shapeOverall = Math.round(v2.overallPercent);
  const timingOverall = Math.round(((v2.timingPercent * 0.8 + v2.posePercent * 0.2) * v2.coveragePercent) / 100);
  const v2FrameScores = v2.frameScores.map((frame) => frame.posePercent / 100);
  const v2TrackScores: MotionTrackScore[] = v2.jointScores
    .filter((joint) => joint.presentInSource && joint.presentInCandidate)
    .map((joint) => ({
      name: motionTrackLabel(joint.jointPath),
      rawName: joint.jointPath,
      score: joint.posePercent / 100,
      worstScore: joint.posePercent / 100,
      worstProgress: 0,
    }))
    .sort((left, right) => left.score - right.score);
```

with the downstream wiring: `frameScores`/`trackScores` for shape AND timing modes both use `v2FrameScores`/`v2TrackScores`; `overall`/`primaryValue` = `shapeOverall` (shape) / `timingOverall` (timing); `coverage: coveragePercent` in the result; `exactCurveData` stays `exactCurveMatch(source, candidate)` (raw clips, unscoped — as today); everything else (loop, root, verdict/tone logic, largestDifference*, counts, durations) keeps its existing derivation, now fed from the new frame/track score arrays. DELETE the now-unused `compareTrackPairs`, `PairSamples`, `prepareTrack`, `valuesSimilarity`, `vectorSimilarity`, `quaternionSimilarity`, `quaternionAngle`, `distance`, `average` helpers ONLY IF nothing else references them — `loopContinuity` still uses several (`prepareTrack`, `valuesSimilarity`, `vectorSimilarity`, `quaternionVelocity`, `linearVelocity`, `quaternionAngle`, `distance`, `average`) and `rootPath` uses `prepareTrack` — so delete ONLY `compareTrackPairs` and `PairSamples`. Everything loop/root stays.

Note on `largestDifferenceTimeSeconds`: keep the existing formula; with DTW the notion is approximate (source-projected) — acceptable, documented in the result already as a highlight aid, not a measurement.

- [ ] **Step 3: Lab tests — run and reconcile**

`npx vitest run src/components/MotionComparisonLab.test.ts`. Expected outcomes to verify and, where numbers legitimately moved, update WITH a justification comment (each updated expectation must cite the v2 mechanism):
- exact-copy test: passes unchanged (raw exactness + 100 override).
- retimed shape/timing test: `shape.pose` stays 100 (phase-normalized + DTW); `timing.timing < shape.pose` still true via durationPercent 80 → timing = 90.
- jointScope test: counts unchanged; `upper.pose === 100` (identical Head tracks); `full.pose < upper.pose` (Foot differs).
- tiny-overlap test: `coverage < 5` ✓, `primaryValue < 10` via multiplicative composition ✓, `pose` is now the JOINT-scoped mean (still 100 for the identical shared track) ✓.
- loop/root/non-mutation tests: untouched paths, must pass as-is.
If any expectation shifts beyond these mechanisms, STOP — that's an unplanned behavior change to diagnose, not an expectation to edit.

- [ ] **Step 4: Regenerate the live-engine baseline deliberately**

`copyDetection.test.ts`: ENGINE_TITLE → `'live web engine (v2 via analyzeMotionClips)'`. Then `UPDATE_MOTION_BASELINE=1 npx vitest run src/motion/testset/copyDetection.test.ts`; re-run green. RECORD the per-class delta table old-live vs new-live in the report — this IS the cutover's measured effect (expect it to be ≈ the tuned baseline modulo the UI threshold semantics: flagged = tone !== 'neutral' at reviewThreshold 85 vs tuned's ≥90 — differences between the live and tuned scorecards come only from that threshold gap; verify and record).

- [ ] **Step 5: README** — update the top section: the live engine is now v2; the old TS heuristic engine is deleted from shape/timing (loop/root remain TS-only add-on views); thresholds note (UI review threshold 85 is a UI preference; registry verdict bands are 90/70).

- [ ] **Step 6: Full suite + typecheck + BOTH parity gates** — `npm run typecheck && npm test` (all green, three scorecards print: live/ported/tuned) and explicitly confirm `motionParity.test.ts` 23/23 (untouched core).

- [ ] **Step 7: Commit** — `git add -A frontend/src && git commit -m "Motion: live web engine is now the graded v2 (DTW + de-weight + coverage guard)"`

---

### Task 8: Hardening backlog from the Phase 1a reviews

**Files:**
- Modify: `core/src/test/java/creatorflow/motion/MotionParityOracle.java` (+1 case), `MotionParityOracleGeneratorTest.java` (env gate)
- Regenerate: `frontend/src/motion/parity/motion-parity-oracle.json` (23 cases)
- Modify: `frontend/src/motion/parity/motionParity.test.ts` (count 22→23; check() expected-side NaN guard)
- Modify: `frontend/src/motion/testset/portedScorecard.test.ts` (ENGINE_TITLE wording), `copyDetection.test.ts` + `tunedScorecard.test.ts` (env gates `=== '1'`)

- [ ] **Step 1: Fixture-scale oracle case** — append to `MotionParityOracle.cases()`:

```java
        cases.add(new OracleCase("fixture-scale-sparse", "20 joints x 30 irregular keys, one sparse joint",
                fixtureScale("100", 0.0), fixtureScale("200", 3.0)));
```
and the builder (irregular times, one joint present only in every third keyframe — sparse per-joint tracks, the envelope the Phase 1a final review flagged):

```java
    private static NormalizedAnimation fixtureScale(String id, double offsetDegrees) {
        int jointCount = 20;
        int keyCount = 30;
        NormalizedKeyframe[] frames = new NormalizedKeyframe[keyCount];
        for (int k = 0; k < keyCount; k++) {
            double time = Math.pow((double) k / (keyCount - 1), 1.35); // irregular spacing, strictly increasing
            java.util.List<NormalizedPose> poses = new java.util.ArrayList<>();
            for (int j = 0; j < jointCount; j++) {
                if (j == 7 && k % 3 != 0) continue; // joint 7 is sparse: keys only every 3rd frame
                double yaw = Math.sin(2.0 * Math.PI * time + 0.7 * j) * 55.0 + offsetDegrees;
                double pitch = Math.cos(2.0 * Math.PI * time + 0.3 * j) * 30.0;
                double x = 0.15 * Math.sin(2.0 * Math.PI * time + 0.2 * j);
                double[] rotation = multiply(yawMatrix(yaw), pitchMatrix(pitch));
                poses.add(new NormalizedPose("Rig/J" + j, cframe(x, 0.01 * j, -0.02 * j, rotation), 1.0, "Linear", "InOut"));
            }
            frames[k] = new NormalizedKeyframe(time, java.util.List.copyOf(poses));
        }
        return anim(id, 1.0, frames);
    }
```

- [ ] **Step 2: Env gates** — Java: `if ("1".equals(System.getenv("UPDATE_MOTION_PARITY_ORACLE")))`; TS (three harnesses): `if (process.env.UPDATE_MOTION_BASELINE === '1')` etc. (the golden test already checks `=== '1'`).
- [ ] **Step 3: Parity test** — inventory 22→23 (both assertions); `check()` first line becomes `if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) {`.
- [ ] **Step 4: ENGINE_TITLE wording** — portedScorecard: `'ported Java-parity engine (49 samples / flags at >=90 or exact)'` — note this changes the stored `engine` string → regenerate the ported baseline too (flag booleans must be IDENTICAL; only the title moves — verify with git diff).
- [ ] **Step 5: Regenerate oracle** (`UPDATE_MOTION_PARITY_ORACLE=1 mvn -q -pl core test -Dtest=MotionParityOracleGeneratorTest`), drift-guard re-run, TS parity 24/24 (1 inventory + 23 cases) — the new case must pass WITHOUT touching motionEngineCore.ts; if it fails, that IS a real port divergence in the fixture-scale envelope: diagnose per the Task 3 (1a) iron rule.
- [ ] **Step 5b: Regenerate the v2 golden file** — the golden test (Task 6) pins `Object.keys(golden).length === oracle.cases.length`, so the 23rd oracle case makes it red until regenerated: `UPDATE_MOTION_GOLDEN=1 npx vitest run src/motion/motionEngineGolden.test.ts`, then re-run without the env var. VERIFY with `git diff` that the 22 pre-existing golden entries are byte-identical — only the `fixture-scale-sparse` entry may be new; any other change means v2 behavior moved and must be diagnosed, not committed.
- [ ] **Step 6: Full suites both sides + typecheck; commit** — `"Hardening: fixture-scale oracle case, strict env gates, NaN-guard both sides"`

---

### Task 9: Whole-phase review + phase report to Bryan

- [ ] **Step 1:** Dispatch the whole-phase fable review over the full 1b range with the graded-stage baselines and all deferred minors.
- [ ] **Step 2:** Report to Bryan: the three graded stages' before/after per-class tables (composition, de-weight, DTW), the golden pin, the cutover's live-baseline delta, the hardening results, and what Phase 2 (live registry) needs from him. STOP for the Phase 2 go.

---

## Self-review (per writing-plans skill)

- **Spec coverage:** de-weight own graded commit ✓ (T4); banded DTW with Sakoe-Chiba band + warp penalty + distance cells ✓ (T5); timing heuristic dropped from v2, subsumed by warp composite ✓ (T5); "pin NEW behavior with own golden vectors" ✓ (T6); parity test remains applicable because compareNormalized is untouched — documented deviation from the handoff's assumption that the port itself would be modified ✓ (header + T1); recall/FP gates per handoff ✓ (T3–T5 gates); UI replacement of the old TS similarity math while keeping loop/root ✓ (T7); scorecard grades every change ✓.
- **Placeholder scan:** clean — every step carries code or exact commands; T7's mapping contract enumerates every MotionAnalysisResult field's source.
- **Type consistency:** `PoseBlendWeights`/`JAVA_POSE_WEIGHTS`/`timingPercent` exports (T1) consumed by T3; `V2_POSE_WEIGHTS` (T4) defaults into `compareMotion`; `MotionComparisonV2` fields consumed by T6 (`pick`) and T7 (mapping); `tunedEngineAdapter` name consistent (T3, harness); case ids `neg-partial` consistent between builder and tests (T2).
- **Known judgment calls (Bryan can veto any):** (1) multiplicative coverage replaces both the old harmonic and Java-linear compositions — graded on the new partial-coverage negatives; (2) v2 weights 0.25/0.65/0.10 as the first graded cut; (3) parity core kept alive alongside v2 rather than modified in place; (4) UI timing-mode overall mirrors the shape composition with timing leading; (5) exactCurveData stays raw-clip exactness in the UI.
- **Deliberate exclusions (stay in scope):** no mirror canonicalization, no height/root normalization (Phase 3); no server work (Phase 2); no threshold retuning beyond the documented bands.
