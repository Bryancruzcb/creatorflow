<!-- frontend/src/motion/testset/README.md -->
# Motion copy-detection test set

The safety net for every motion-engine change (handoff Phase 0). `npm test` runs
`copyDetection.test.ts`, which grades the LIVE web engine over ~217 labeled cases and
prints a recall / false-positive scorecard. Since the Phase 1b cutover the live engine
IS the graded v2: `analyzeMotionClips`'s shape/timing modes run `clipToNormalized` →
`compareMotion` (DTW + de-weight + coverage-attenuated composition); the old TS
heuristic engine is deleted from shape/timing, while loop and root remain TS-only
add-on views. Thresholds: the UI review threshold (85) is a UI preference for
surfacing review candidates; the registry verdict bands live in the engine
(HIGH ≥ 90, MODERATE ≥ 70) — so this scorecard and the tuned one differ only in
the 85–90 flag band. Per-case flag outcomes are pinned in
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

- Mirrored fixtures swap left/right joints and reflect curves across the YZ plane.
  That is a faithful mirror only insofar as the rigs are left/right symmetric (both
  are, near enough). The live v2 baseline flags 8/17 mirrored fixtures (47.1%):
  every hit is on the robot rig's symmetric holds and gross-motion clips
  (Dance, Death, Idle, Jump, No, Sitting, Standing, Yes), while it misses all 3 fox
  rig mirrors (Run, Survey, Walk) and 6 more robot clips (Punch, Running, ThumbsUp,
  Walking, WalkJump, Wave). Dedicated mirror canonicalization — to close that gap on
  purpose rather than by accident — is still Phase 3's job.
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
The two engines use different flag thresholds by design (live UI: score ≥ 85;
ported: its own ≥ 90 HIGH band), so compare the two scorecards side by side, not
row-by-row against a shared bar. The live app runs v2 since the Phase 1b cutover;
see "v2 web engine (Phase 1b)" below for the graded engine and its parity anchor.

## v2 web engine (Phase 1b)

`tunedScorecard.test.ts` grades the v2 engine (`compareMotion`): the parity-proven
Java kernel + three graded divergences — multiplicative coverage (no tiny-overlap
false accusations, no full-coverage inflation), position de-weighted 0.25/0.65/0.10
(finding 7), and banded DTW (Sakoe-Chiba 12.5%) with a duration+warp timing
composite. Baseline: `scorecard.tuned.baseline.json`, regenerated per graded stage
(`UPDATE_MOTION_TUNED_BASELINE=1`). The parity-locked `compareNormalized` and its
oracle test remain untouched as the Java-fidelity anchor.

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

**What widening the set revealed.** The old aggregate "mirror 47%" was carried entirely by one rig:

| rig | mirror recall |
| --- | --- |
| robot | 8/14 |
| fox | 0/3 |
| cesiumMan | 0/1 |
| riggedFigure | 0/1 |

Mirrored animations are **effectively undetected on every rig except robot**. Treat mirror
detection as unimplemented (see the deferred mirror-canonicalization work), not as "partial".

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

At the time of writing, the shipped threshold (85) is **not** the precision-optimal choice on this
set — 90 removes three of the four false positives for two true positives, and scores a slightly
better F1:

| threshold | precision | recall | F1 |
| --- | --- | --- | --- |
| 85 (shipped) | 0.968 | 0.917 | 0.942 |
| 90 | **0.992** | 0.902 | **0.945** |

Given the product's stated priority — a false accusation is the worst output it can produce — that
is a live argument for moving the operating point. Deliberately not changed here: the threshold is
a product decision, and the friend test may reprice it against real data.

