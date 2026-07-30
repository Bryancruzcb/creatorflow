<!-- frontend/src/motion/testset/README.md -->
# Motion copy-detection test set

The safety net for every motion-engine change (handoff Phase 0). `npm test` runs
`copyDetection.test.ts`, which grades the LIVE web engine over ~217 labeled cases and
prints a recall / false-positive scorecard. Since the Phase 1b cutover the live engine
IS the graded v2: `analyzeMotionClips`'s shape/timing modes run `clipToNormalized` →
`compareMotion` (DTW + de-weight + coverage-attenuated composition + mirror
canonicalization); the old TS heuristic engine is deleted from shape/timing, while
loop and root remain TS-only
add-on views. Thresholds: the UI review threshold (90 since issue #43) is a UI
preference for surfacing review candidates; the registry verdict bands live in
the engine (HIGH ≥ 90, MODERATE ≥ 70). The two now coincide numerically but stay
different things — one is what a person is shown, the other is what the engine
concludes — so they are still reported separately rather than merged. Per-case
flag outcomes are pinned in
`scorecard.baseline.json` — an engine change that moves any case across the flag
threshold fails CI until the baseline is regenerated on purpose:

    UPDATE_MOTION_BASELINE=1 npm test    # then commit the diff and report before/after

    # PowerShell:  $env:UPDATE_MOTION_BASELINE = '1'; npm test; Remove-Item Env:UPDATE_MOTION_BASELINE

## Labels

- **Positives** (should match): programmatic derivations of each clip — `reupload`
  (identical), `retime-fast`/`retime-slow` (uniform speed change), `hold` (inserted
  pause), `rescale` (positions ×1.25), `relocate` (root offset), `mirror` (left/right
  joint swap + reflected curves).
- **Negatives** (should NOT match): distinct clips on the same rig. `family` = same
  gait family (Walking↔Running, Walk↔Run) — different works; flagging them is a false
  accusation. Never cross-rig: different skeletons share no joints, so those pairs
  prove nothing.
- **Variant** (reported, ungraded): Walking↔WalkJump — WalkJump is built from Walking,
  so neither label is honest.
- `partial-coverage` negatives: the source clip vs a copy of itself where only a
  slice of tracks keeps its joint names (2 = "low", half = "half") and the rest are
  renamed to unshared joints. Sharing one limb's curves with an otherwise unrelated
  rig is not theft evidence — an engine that flags these over-trusts coverage.

## Honesty caveats

- **The mirror recall number is now partly self-fulfilling — read the false-positive
  rate instead.** Mirror canonicalization (#16) scores every pair in both orientations
  (`mirrorCanonical.ts`), which took mirror recall from 6/19 to 19/19. But the
  canonicalization inverts the *same* simplified reflection the fixtures are generated
  from: both negate x and conjugate the rotation per joint, in the joint's LOCAL frame.
  A true mirror reflects in world space and re-expresses the result in each bone's rest
  frame, which needs the bind pose that `clipToNormalized` drops. So 19/19 measures
  "the detector undoes the generator", and the honest result of that change is the
  false-positive rate it cost, which was **zero at every threshold on the sweep**.
  Whether it catches a mirror produced by Blender or Studio is unmeasured.
- **The positives are saturated: 133/133 at every threshold up to the shipped 90.**
  This set can no longer tell a good engine from a better one on laundering
  resistance — only detect a regression. That is the set having been outgrown, not the
  problem being solved. The next informative measurement has to come from harder
  derivations or from real Roblox animations.
- A scorecard number is a measurement, not a verdict. Precision (not flagging the
  innocent) outranks recall — a change that raises recall by raising the family/unrelated
  false-positive rate is a regression.

## Regenerating fixtures

    npm run fixtures:motion   # re-extracts from public/assets/*.glb via three's GLTFLoader

Fixtures are committed; regenerate only when the GLBs or three's loader change, and
expect the baseline to need a rerun afterwards.

## Ported engine (Phase 1a)

`portedScorecard.test.ts` grades the Java-parity engine (`clipToNormalized` →
`compareNormalized`) on the same case list and pins `scorecard.ported.baseline.json`
(regenerate deliberately: `UPDATE_MOTION_PORTED_BASELINE=1 npm test`; PowerShell:
`$env:UPDATE_MOTION_PORTED_BASELINE = '1'; npm test; Remove-Item Env:UPDATE_MOTION_PORTED_BASELINE`).
The two engines flag on different grounds by design (live UI: the review-threshold
preference, 90 since issue #43; ported: its own ≥ 90 HIGH band). Those are the same
number today and still not the same rule — the UI one is a per-device preference a
person can move, the band is engine behaviour — so compare the two scorecards side
by side, not row-by-row against a shared bar. The live app runs v2 since the Phase 1b cutover;
see "v2 web engine (Phase 1b)" below for the graded engine and its parity anchor.

## v2 engine (Phase 1b)

`tunedScorecard.test.ts` grades the v2 engine (`compareMotion`): the parity-proven
Java kernel + three graded divergences — multiplicative coverage (no tiny-overlap
false accusations, no full-coverage inflation), position de-weighted 0.25/0.65/0.10
(finding 7), and banded DTW (Sakoe-Chiba 12.5%) with a duration+warp timing
composite. Baseline: `scorecard.tuned.baseline.json`, regenerated per graded stage
(`UPDATE_MOTION_TUNED_BASELINE=1`). The parity-locked `compareNormalized` and its
oracle test remain untouched as the Java-fidelity anchor.

**v2 is no longer web-only** (issue #102). It exists in Java as
`MotionComparisonEngineV2`, and the Studio plugin route
(`POST /plugin/v1/motion-comparisons`) scores on it. Until that change the plugin
route ran **v1** while every browser surface ran v2, so the same pair returned
different percentages depending on which door it came through, and a mirrored copy
was caught in the browser and missed through the plugin.

Two implementations of one algorithm only stay one algorithm if something binds
them, so they are bound the same way v1 is: `parity/v2Parity.test.ts` grades
`compareMotion` against `motion-v2-parity-oracle.json`, generated from the Java
engine by `MotionV2ParityOracleGeneratorTest`. That oracle carries all 23 v1 cases
plus **7 mirror cases**, because not one v1 case has a left/right joint name — the
mirror half of the port would otherwise be graded by nothing. The gate is
sensitive: perturbing the pose weights by 0.01 on one side fails 17 of its cases.

The version string stays `creatorflow.motion-comparison/v2-web` in both. It names
the algorithm, not the implementation, and two parity-locked implementations
reporting different strings would put two names for one algorithm back into the
comparison table — the confusion #102 is about. Stored records already carry it.

One thing pinned rather than fixed while porting: `MIRROR_MIN_PAIRS` is 2, but
`buildMirrorMap` stores both directions of every mutual pair, so a **single** pair
already clears it. The comment beside the constant describes a two-pair floor the
code does not implement. Changing the real floor would move scores the web already
ships, so it is a product decision, not a parity fix — recorded in
`v2-mirror-single-pair-allowed`.

## Rig coverage and what these numbers do NOT prove (2026-07-26)

The set ran on **two** rigs (robot, fox) until three CC BY 4.0 Cesium rigs were added, so it now
grades **four**: robot (14 clips), fox (3), cesiumMan (1), riggedFigure (1) — 19 clips, 133
positives, 97 negatives.

Two candidates were **rejected on licence grounds**, worth recording in a tool about provenance:
**BrainStem** carries a Poser EULA despite sitting in an open sample repository, and **Xbot /
Soldier** (three.js) are Mixamo-derived, where redistributing the animations as assets is
restricted. They had the multi-clip sets this test set most wants; they are still not vendored.

`riggedSimple` is vendored but **not graded**: it animates a single joint, and `isGradableRig`
skips rigs under `MIN_ANIMATED_JOINTS`. On a one-joint rig "relocated in space" and "a different
animation" are indistinguishable from local transform data, and mirroring is near-identity — such
a rig moves the headline percentages without exposing engine behaviour.

**What widening the set revealed, and what closed it.** The old aggregate "mirror 47%" was carried
entirely by one rig — mirrored animations were effectively undetected on every rig but robot, and
robot only scored because that rig is symmetric enough for a mirrored clip to still resemble itself:

| rig | mirror recall, before #16 | after |
| --- | --- | --- |
| robot | 8/14 | 14/14 |
| fox | 0/3 | 3/3 |
| cesiumMan | 0/1 | 1/1 |
| riggedFigure | 0/1 | 1/1 |

Mirror canonicalization (#16) closed it by scoring each pair in both orientations rather than by
scoring better. The diagnosis that made it work: after reflecting, the six robot clips that still
failed had a pose score of *exactly 100* and were losing on coverage alone — a one-armed
performance (`Wave`, `ThumbsUp`, `Punch`) contains no left/right pair to find, because the
counterpart joint is never keyed. Pairing across both clips being compared, rather than within one,
took those from 4 pairs to 26. See the honesty caveat above before quoting the "after" column.

**What the set still cannot tell you.** Positives are programmatic derivations of a clip against
itself, so this measures *laundering resistance* — can the engine still recognise this exact clip
after a re-upload, retime, hold, rescale, relocate or mirror. It does **not** measure whether two
animators independently produced similar work, and cross-rig pairs are excluded by construction
(different skeletons share no joints), which means **a copy retargeted onto a different rig is out
of scope entirely**. Real accuracy against real Roblox animations remains uncollected.

## Decision-threshold sweep

`thresholdSweep.test.ts` characterises the engine across the whole threshold rather than at the one
operating point the product ships, and commits the curve (`sweep.baseline.json`) so a tuning change
has to show its cost. Regenerate with `UPDATE_MOTION_SWEEP_BASELINE=1 npm test`.

The sweep is what moved the operating point from 85 to 90 (issue #43, decided 2026-07-29):

| threshold | precision | recall | F1 |
| --- | --- | --- | --- |
| 85 (was shipped) | 0.968 | 0.917 | 0.942 |
| **90 (shipped)** | **0.992** | 0.902 | **0.945** |

Five of 231 cases moved, all from flagged to unflagged — three false positives removed
(`neg:Idle-vs-No`, `neg:Idle-vs-Yes`, `neg:Running-vs-WalkJump`) against two true positives lost
(`mirror:Dance`, `mirror:Death`).

Both losses landing in `mirror` is the reason this was worth taking rather than a coincidence to
note. Mirror recall was 42.1% at 85 and 31.6% at 90 — a class the engine only ever detected by
accident, because mirroring a quaternion is an improper reflection rather than a sign flip, and one
that issue #16 existed to fix properly.

**Then #16 landed and gave both of them back.** `mirror:Dance` and `mirror:Death` are flagged again,
so the threshold move's recall cost is now zero, and the curve is:

| threshold | TP | FP | precision | recall | F1 |
| --- | --- | --- | --- | --- | --- |
| 85 | 133 | 4 | 0.971 | 1.000 | 0.985 |
| **90 (shipped)** | **133** | **1** | **0.993** | **1.000** | **0.996** |
| 95 | 127 | 1 | 0.992 | 0.955 | 0.973 |

Mirror canonicalization added **no false positives at any threshold** — the FP column is unchanged
from before it, at every row. That is the number worth trusting; the recall column is saturated and
partly self-fulfilling (see the honesty caveats).

One consequence for the gates: the old `precision > recall` assertion was a proxy for "this
operating point favours precision", and it broke when recall reached 1.000 — precision went *up*
(0.992 → 0.993) and the gate failed anyway. It is now written as what it meant: a hard cap of one
flagged negative and a 0.99 precision floor at the shipped threshold.

The friend test may still reprice all of this against real Roblox data, which is a better reason to
move the threshold again than a better F1 would be.

