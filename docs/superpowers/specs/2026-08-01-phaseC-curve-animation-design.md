---
type: design-spec
project: CreatorFlow
phase: C
status: approved-in-chat
date: 2026-08-01
tags:
  - creatorflow
  - roblox
  - phase-c
  - curve-animation
---

# Phase C — CurveAnimation support

**Goal:** stop hard-rejecting `CurveAnimation` assets and let them be compared with the
same fidelity `KeyframeSequence` assets already get — without building a second
comparison engine, and without ever claiming sampled data is as exact as a direct
keyframe read.

**Why this phase, why now:** `docs/ROADMAP.md` marks Phase C `(validation-gated)`, and
`docs/superpowers/plans/2026-07-29-codebase-triage.md` states plainly that Phases B/C/D/E
"are all explicitly validation-gated behind [the friend test]... This is a human blocker
and it cannot be worked around." That friend test was cancelled by the project owner on
2026-07-30 and will not happen — recorded when Phase B was scoped, not re-litigated
here. Phase B's own spec documents an owner decision to build B specifically, "picked
over C/D/E" — it left C/D/E unresolved for later, not pre-approved. Proceeding with C
now is a separate, new owner decision to keep going despite the gate, not a claim that
Phase B's decision already covers it.
Two separate documents (`ROADMAP.md` and the triage doc) both flag the same technical
blocker — "needs a deterministic curve canonical format first" — as the reason this was
never started. `CreatorFlowAnimationBridge.lua`'s `readAnimation` explicitly rejects
`CurveAnimation` today (`roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua:809-818`):
"CreatorFlow v0.1 compares KeyframeSequence assets only; curve-channel normalization is
planned separately." This phase is that plan.

**Architecture:** `CurveAnimation` stores animation as continuous per-property curves,
not the discrete per-keyframe poses `KeyframeSequence` uses — a genuinely different data
model, not just a different container for the same thing. Rather than build a parallel
comparison engine for it, this phase **samples** a curve animation's position/rotation
data at fixed time intervals and bakes the result into the exact same `{time, poses}`
shape `normalizeKeyframeSequence` already produces. That shape is what
`MotionComparisonEngine`/`MotionComparisonEngineV2`, the fingerprinting, the wire schema,
and the whole frontend comparison UI already consume — none of that changes. "Deterministic
curve canonical format" becomes concrete: a fixed sample rate plus the same
`roundNumber`/`ROUNDING_SCALE` rounding already used for `KeyframeSequence` poses.

**Honesty wrinkle this phase introduces:** sampled data is an *approximation* of a
continuous curve; a direct `KeyframeSequence` read is exact. The codebase already has a
field named `exactCurveData` — that means something unrelated (whether two *normalized
pose* results matched byte-for-byte) and predates this feature. To avoid two different
"curve" concepts colliding in the same codebase, this phase never reuses that name for
anything about sampling. Instead it tracks each side's data provenance honestly as a new
`sourceKind`/`candidateKind: "KEYFRAME" | "CURVE_SAMPLED"` pair, so a sampled
approximation is never visually indistinguishable from an exact read.

**Tech stack:** Luau (Studio plugin), Java 21 (desktop bridge + persistence), React 19 +
TypeScript (frontend evidence view).

## Global constraints

- **Sampled is not exact, and must never be shown as if it were.** Every comparison
  involving a `CURVE_SAMPLED` side carries that provenance through to the UI. This is the
  same non-overclaiming discipline already governing `VERIFIED` (Phase A/B), never
  relaxed for convenience.
- **v1 scope: position/rotation curves on rig-joint-equivalent paths only.** Roblox's
  curve system can technically animate arbitrary instance properties (transparency,
  color, light brightness, camera FOV, …). None of that is in scope — it mirrors what
  `KeyframeSequence` already encodes today (joint pose transforms only), so this is an
  honest like-for-like extension, not new scope. A curve animation with no
  position/rotation channels at all is rejected with a clear reason, the same way
  `normalizeKeyframeSequence` already rejects a clip with zero keyframes
  (`CreatorFlowAnimationBridge.lua:746-748`).
- **No new comparison engine, no server-side engine changes.** `MotionComparisonEngine`,
  `MotionComparisonEngineV2`, and `NormalizedAnimation` are untouched. A curve-sampled
  clip is indistinguishable from a keyframe clip at that layer — the honesty distinction
  lives entirely in the new provenance fields, carried alongside, never inside, the
  pose data those engines already trust.
- **`sourceKind`/`candidateKind` are new top-level sibling fields in the wire payload,
  not nested inside `source`/`candidate`.** Exactly the same reason `playability` (Phase
  B) had to be top-level: `LocalBridgeServer.parseMotionRequest` deserializes
  `source`/`candidate` straight into `NormalizedAnimation` via Jackson, whose
  `ObjectMapper` does not disable `FAIL_ON_UNKNOWN_PROPERTIES` — an unknown field nested
  in either object would throw on every submission.
- **Determinism is inherited, not re-derived — and one real consumer depends on it more
  than comparisons do.** Because sampled output uses the identical
  `roundNumber`/`ROUNDING_SCALE` path already used for keyframe poses, byte-determinism
  guarantees already proven for that path apply unchanged, *contingent on Task 0
  confirming curve sampling itself is deterministic run-to-run* (see Task 0 Step 4).
  A one-off comparison surviving non-determinism is low-stakes (the score might jitter
  slightly run-to-run, disclosed via `sourceKind`). **Animation snapshots
  (`motion_snapshots`, "last-known-good"/"last-published" pinning,
  `AnimationSnapshotsPanel.tsx`) are not** — `MotionSnapshots.classify`
  (`core/src/main/java/creatorflow/motion/MotionSnapshots.java`) determines
  UNCHANGED/CHANGED by fingerprint equality alone, with no knowledge of `sourceKind`.
  If sampling isn't bit-identical run-to-run, re-pinning a genuinely-unchanged
  `CURVE_SAMPLED` asset would report a false CHANGED — exactly the "false accusation"
  class of error `ROADMAP.md`'s standing constraints call out as the worst possible
  output ("when in doubt, under-flag"). **If Task 0 finds sampling is not
  deterministic, `CURVE_SAMPLED` sides must be excluded from snapshot pinning in v1**
  (see Components → Frontend) rather than let a known-unreliable fingerprint feed a
  drift-detection feature that has no way to express "might not actually have changed."
- **No live playback simulation or building ships until the Task 0 spike confirms the
  underlying API assumptions.** See Task 0.

## Task 0 (GATE) — Feasibility spike: how does `CurveAnimation` actually expose its data?

**Nothing past this task is built until it answers these.** Unlike Phase A/B, where the
overall mechanism was well understood and only specific behaviors needed live
confirmation, here the *shape of the solution itself* depends on an external API this
project has only medium confidence about — the same posture Phase A was in with Open
Cloud before its own Task 0 spike, and exactly why this gets one too rather than guessed
at.

**Files:** none committed — a throwaway script in Studio's command bar, findings written
to `docs/superpowers/plans/2026-08-01-phaseC-task0-spike-note.md`.

- [ ] **Step 1 — Get a real `CurveAnimation` asset to test against.** Author one in
      Roblox's Animation Editor (curve animations can be authored directly, or an
      existing `KeyframeSequence` may be convertible in-editor) or find a public one via
      the Toolbox. Confirm `clip:IsA("CurveAnimation")` is true for it via
      `AnimationClipProvider:GetAnimationClipAsync`.
- [ ] **Step 2 — Confirm the read API.** Determine, for real, how to enumerate which
      rig paths have curve data and read position/rotation values at an arbitrary time
      for each. Record the actual instance/property/method names used — do not assume
      the `KeyframeSequence` shape (`GetKeyframes()`/`GetPoses()`) carries over.
- [ ] **Step 3 — Confirm `Loop`/`Priority` equivalents exist.** `normalizeKeyframeSequence`
      reads `clip.Loop` and `clip.Priority.Name` directly off the `KeyframeSequence`
      instance. Confirm `CurveAnimation` exposes the same (or find the actual
      equivalent) — if it doesn't, record what the normalized `looped`/`priority` fields
      should default to for curve-sourced clips. **This choice is not cosmetic:**
      whatever `looped` value `normalizeCurveAnimation` produces becomes
      `declaredLooped` in `probePlayability(sourceId, "R6", source.looped, sourceMarkers)`
      (`CreatorFlowAnimationBridge.lua:893-899`), which compares it against the *real*
      engine-observed `track.Looped` from actually playing the clip
      (`local loopHonored = engineLooped == declaredLooped`, line 249). A wrong default
      here doesn't just mislabel one field — it makes every curve-sourced clip fail the
      Phase B playability probe's loop check spuriously. If no reliable equivalent
      exists, record that explicitly rather than guessing a default, so the
      implementation plan can decide whether to default to "unknown" (skip the
      loop-honored check for curve-sourced clips, disclosed the same way the
      priority-honored check is already skipped) instead of a value that's actively
      likely to be wrong.
- [ ] **Step 4 — Confirm sampling is deterministic.** Read the same curve at the same
      time value twice (or across two separate script runs) and confirm identical
      output. If it is not bit-identical, determine whether the existing
      `roundNumber`/`ROUNDING_SCALE` rounding is coarse enough to absorb the difference,
      or whether determinism cannot be guaranteed for curve-sourced clips at all — a
      real possible outcome that would need to be disclosed, not hidden, exactly like
      Phase B disclosed the R6/R15 rig-mismatch gap rather than pretending it away.
- [ ] **Step 5 — Pick a concrete sample rate.** Balance fidelity (a fast movement
      sampled too coarsely reads as far less motion than it is) against
      `MAX_POSES`/`MAX_REQUEST_BYTES` (`CreatorFlowAnimationBridge.lua:14-15`) for a
      realistic clip duration. Record the chosen rate and the reasoning.
- [ ] **Step 6 — Write the confirmed contract.** The real read API (Step 2), the
      `Loop`/`Priority` answer (Step 3), the determinism verdict (Step 4), and the
      chosen sample rate (Step 5). **This note is what the implementation plan codes
      against.**

**Completion test:** the note has a clear, real answer for Steps 2 and 4. If Step 4
finds sampling is not deterministic even after rounding, that is not a reason to abandon
the phase — it becomes a disclosed limitation, scoped down exactly the way Phase B
scoped down "priority honored" and "rig-topology mismatch detection" rather than
silently shipping a false guarantee: comparisons involving a curve-sourced side are
labeled as such and may not re-export byte-identical, **and** — because a stale
fingerprint is a much bigger deal for drift-detection than for a one-off comparison —
snapshot pinning is disabled for `CURVE_SAMPLED` sides, enforced both in the frontend
(the Pin button, with a stated reason) and server-side (`LocalBridgeServer`'s
animation-snapshot capture endpoint rejects it too, so the restriction isn't just a
bypassable UI affordance). See Global Constraints and Components below for exactly what
that means once Task 0 answers Step 4 for real.

## Components

**Plugin (`CreatorFlowAnimationBridge.lua`):**
- `readAnimation`'s current `CurveAnimation` branch (lines 809-818, currently an
  unconditional `error(...)`) is replaced: route to a new `normalizeCurveAnimation(assetId,
  clip)` instead of rejecting.
- `normalizeCurveAnimation` — per Task 0's confirmed read API, samples every
  position/rotation-equivalent channel at the chosen fixed interval across the clip's
  duration, producing the identical `{time, poses}` shape `normalizeKeyframeSequence`
  returns. `jointPath`/`transform`/`weight` carry the sampled data; `easingStyle`/
  `easingDirection` — which describe *interpolation between authored keyframes*, a
  concept that doesn't apply to a value sampled directly off a continuous curve — are
  fixed to `"Linear"`/`"InOut"` for every sampled pose, the same values already used as
  a real example in this codebase's own test fixtures
  (`desktop/src/test/java/creatorflow/bridge/LocalBridgeServerTest.java`), so the
  choice has precedent rather than being invented here. `markers` defaults to an empty
  list — `CurveAnimation`'s data model is per-property curves, not per-keyframe objects
  a marker could be authored on the way `KeyframeSequence`'s `Keyframe:GetMarkers()`
  works, and Task 0 does not investigate whether any equivalent concept exists. If a
  future phase finds one, it plugs in the same way Phase B's shipped marker collection
  actually works: gathered inline while already iterating the clip's structure
  (`normalizeKeyframeSequence`, `CreatorFlowAnimationBridge.lua:776-782`) and deduped via
  the pure, self-tested `dedupeMarkerNames` helper (lines 163-173) — not a separate
  extractor function kept apart from the data it reads.
  Returns the same `(normalized, counters, markers)` triple `normalizeKeyframeSequence`
  already produces — `normalizeCurveAnimation` and `normalizeKeyframeSequence` must have
  matching return shapes, since `readAnimation` calls whichever one applies through the
  same `pcall`. A clip with zero position/rotation channels is rejected with a clear
  message, the same pattern as the existing zero-keyframes rejection.
- **`readAnimation` itself gains a 4th return value: `kind`** (`"KEYFRAME"` or
  `"CURVE_SAMPLED"`), literal-set by `readAnimation` based on which of
  `normalizeKeyframeSequence`/`normalizeCurveAnimation` it called — not carried inside
  `normalized` (that table becomes `source`/`candidate` verbatim in the JSON body,
  deserialized straight into `NormalizedAnimation`, so an extra field there would hit
  the same `FAIL_ON_UNKNOWN_PROPERTIES` failure already avoided for `playability` — see
  Global Constraints). This is the same shape of extension `markers` already was: a
  value `readAnimation` returns *alongside* `normalized`, never inside it.
  `compareButton.Activated` captures it as `sourceKind`/`candidateKind`
  (`local source, sourceCounts, sourceMarkers, sourceKind = readAnimation(sourceId)`,
  matching the existing 3-value capture it already does today) and includes both as new
  top-level fields in the `HttpService:JSONEncode({...})` body, alongside `schema`,
  `source`, `candidate`, and (from Phase B) `playability`.

**Desktop bridge (`LocalBridgeServer.java`):**
- `parseMotionRequest` gains an independent, optional read of the new top-level
  `sourceKind`/`candidateKind` fields — same additive pattern as `playability`, no
  changes to `NormalizedAnimation` or the existing `source`/`candidate` parsing.
- `animation_comparisons` gains two new nullable `TEXT` columns
  (`source_clip_kind`, `candidate_clip_kind`) via a new migration, following the exact
  precedent `V012__playback_settings.sql` set for per-side nullable data — **and this
  migration must also be registered in `SchemaMigrator.MIGRATIONS`
  (`desktop/src/main/java/creatorflow/db/SchemaMigrator.java`), which is a hardcoded
  list, not a directory scan.** (Phase B's implementation hit exactly this gap — a
  migration SQL file with no corresponding `MIGRATIONS` entry does nothing at runtime,
  failing with "table has no column" and no compile-time warning. Documented here so
  this phase's plan doesn't repeat the discovery from scratch.)
- `AnimationComparisonRecord`/`AnimationComparisonRepository`/`animationComparisonView`
  extend the same way Phase B's `playabilityJson` did: record field, insert parameter,
  `INSERT` column + placeholder, `map()` column read, view field. `NULL` (absent) means
  "not recorded" — for comparisons made before this phase shipped, not an unknown clip
  kind claimed as `KEYFRAME` by default.
- **If (and only if) Task 0 finds sampling is not deterministic: the
  animation-snapshot capture endpoint enforces the pinning restriction server-side, not
  just in the UI.** `LocalBridgeServer`'s handler for
  `POST .../animation-snapshots` already loads the source `AnimationComparisonRecord`
  to build the snapshot from — it has `source_clip_kind`/`candidate_clip_kind`
  available on that same record with no extra lookup. Reject the request (an honest
  error naming why, not a silent no-op) when the requested side's `clip_kind` is
  `CURVE_SAMPLED`. This mirrors how `MAX_POSES`/`MAX_REQUEST_BYTES` already get both a
  client-side pre-check *and* server-side enforcement (`validateMotionEnvelope`) rather
  than trusting the plugin UI alone — the same double-enforcement is warranted here
  because a disabled button is bypassable (a stale tab, a direct API call) and this
  restriction exists specifically to prevent a false "your animation changed" report,
  not a soft preference.

**Frontend:**
- Wherever a comparison's per-side evidence renders (`AnimationSnapshotsPanel.tsx`,
  extended by Phase B), a `CURVE_SAMPLED` side gets a visible qualifier — matching the
  existing `mirrored` flag's precedent ("a score found by mirroring is a different claim
  from a score found as submitted, so it is stated rather than folded into the
  percentage" — the same reasoning applies here: a score found by *sampling* a curve is
  a different claim from a score found by reading exact keyframe data).
- **Conditional on Task 0 Step 4's determinism finding:** if sampling is confirmed
  deterministic, the existing "Pin a reference" buttons
  (`AnimationSnapshotsPanel.tsx`'s `pin(clip.side, kind)`) work unchanged for
  `CURVE_SAMPLED` sides. If Task 0 finds it is *not* deterministic, those buttons must
  be disabled for a `CURVE_SAMPLED` side specifically, with a visible reason ("Sampled
  data isn't stable enough to detect drift reliably — pin the source
  `KeyframeSequence` instead, if one exists") — not a silent restriction, and not
  something deferred past this phase, since shipping the sampling capability without
  this guard would let a known-false-positive path reach the exact feature `ROADMAP.md`
  singles out for zero tolerance on false accusations.

## Data flow

Compare pressed → plugin reads each animation's clip type → `KeyframeSequence` takes the
existing unchanged path; `CurveAnimation` takes the new sampling path → both produce the
identical normalized shape via `readAnimation`, which also returns which path it took as
a separate 4th value (`kind`, never embedded in the normalized shape itself) → one JSON
payload (existing `source`/`candidate`/`playability` fields, unchanged, plus new
top-level `sourceKind`/`candidateKind` fields alongside them) POSTed to the existing
`/plugin/v1/motion-comparisons` endpoint (no schema-string bump, same reasoning as
Phase B) → `LocalBridgeServer` parses the new fields independently and persists them →
frontend renders the provenance qualifier alongside existing evidence.

## Error handling

- **No position/rotation channels on the curve animation:** rejected before any sampling
  is attempted, with a message naming what was found instead (e.g., only
  transparency/color channels) — mirrors `normalizeKeyframeSequence`'s existing
  zero-keyframes rejection style.
- **Sampling determinism gap (if Task 0 finds one):** disclosed per-comparison via the
  `sourceKind` field already being surfaced, and — because comparisons alone are
  low-stakes but snapshot drift-detection is not (see Global Constraints) —
  additionally enforced by disabling snapshot pinning for `CURVE_SAMPLED` sides. A
  re-export producing different comparison bytes for a `CURVE_SAMPLED` side is a
  stated, known property of sampled data, not a bug to catch; a snapshot silently
  reporting false drift from the same cause is a bug this phase must not ship.
- **`MAX_POSES`/`MAX_REQUEST_BYTES` exceeded by sampling at the chosen rate:** the
  existing `validateMotionEnvelope` limits already enforce this server-side; the plugin
  should also pre-check client-side before attempting the HTTP request, matching how
  `readAnimation`'s `KeyframeSequence` path already guards `MAX_POSES` during
  normalization rather than after.

## Testing

- **Plugin:** no Luau test framework exists in this repo and none is being introduced —
  consistent with Phase B. Pure logic (the sampling-interval math, provenance tagging)
  gets a self-check on script load, following the `Playability_selfTest`/
  `dedupeMarkerNames` precedent Phase B established. The actual curve-read-and-sample
  behavior is a manually-verified live-Studio step once Task 0's real API contract
  exists to code against.
- **Desktop bridge:** JUnit coverage for the new optional field parsing and persistence,
  following the exact pattern Phase B's `playability` field used.
- **Frontend:** vitest/RTL coverage for the new provenance qualifier rendering,
  following the `AnimationSnapshotsPanel.playability.test.tsx` pattern (including its
  `// @vitest-environment jsdom` requirement — this project scopes jsdom per-file, not
  globally, a real gap Phase B's plan didn't anticipate and had to fix mid-implementation).
- **Task 0 spike** (above) gates all of this — nothing here is built until it answers
  Steps 2 and 4 for real.

## Out of scope for v1

- **Arbitrary property curves** (transparency, color, light/camera/sound properties) —
  only position/rotation on rig-joint-equivalent paths, matching what `KeyframeSequence`
  already encodes.
- **A parallel curve-native comparison engine.** Sampling and reusing the existing
  pose-based engine is the whole point of this design; a "compare curves as curves"
  engine (e.g., comparing control points or curve shape directly) is a different,
  larger feature not attempted here.
- **Retroactively re-scoring existing comparisons** if Task 0's chosen sample rate later
  changes — matches how Phase B's engine-version changes (e.g., issue #102's v1→v2 move)
  were handled: old records keep their original data, they are not silently rewritten.
