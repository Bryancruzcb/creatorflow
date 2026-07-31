---
type: design-spec
project: CreatorFlow
phase: B
status: approved-in-chat
date: 2026-07-31
tags:
  - creatorflow
  - roblox
  - phase-b
  - runtime-playability
---

# Phase B — Runtime playability probe

**Goal:** turn "does this animation actually play on the target rig" from an
unanswered question into evidence the release-preflight workflow can show —
without ever promising more certainty than a live Roblox engine check
actually gives.

**Why this phase, why now:** `docs/ROADMAP.md` ordered the post-redirect
phases A → E from "completes the core" to "expands scope." Phase A
(ownership verification) shipped 2026-07-24. Phases B–E were written as
*validation-gated* — meant to be prioritized by what a real friend-test user
tripped on. That friend test was cancelled by the project owner on
2026-07-30 and will not happen. Phase B was chosen to build next anyway,
picked over C/D/E because it is the most self-contained: no new data format
(unlike C), no dependency-upgrade grab-bag to re-scope (unlike D), and no
conflict with the product's local-first positioning (unlike E — see
`STRATEGIC-REDIRECT.md`).

**Architecture:** the Studio plugin (`CreatorFlowAnimationBridge.lua`)
already reads both animations in a Compare action via
`AnimationClipProvider:GetAnimationClipAsync`. This phase adds a playback
probe right after that read: load the same clip onto a cached Roblox-stock
R6 and R15 dummy rig, play it, and observe what the *real* Roblox animation
engine does. The result — one `PlayabilityReport` per animation, per rig —
rides along in the same `/plugin/v1/motion-comparisons` submission that
already happens, rather than a new endpoint, as a new top-level sibling
field (not nested inside `source`/`candidate` — see Components below for
why). The desktop bridge persists it next to the comparison record; the
frontend renders it as new evidence on that comparison's detail view, next
to the score/verdict/mirrored labels that already display there.

**v1 does not wire this into the release gate.** The release gate
(`ReleaseGate.java`) reads per-asset ownership/decision state off scanned
`AssetEntry` rows, which are bound to a local file. A Studio Compare has no
such binding today — its source/candidate are two Roblox asset IDs typed
into text boxes, tied to no scanned file (`animation_comparisons` is keyed
by `project_id` + the two raw asset IDs only, with no `scan_asset_id`
column — unlike `ownership_verifications`, which Phase A built specifically
to attach to a scanned asset). Building that binding is a real feature in
its own right, not something to absorb unplanned into this phase. So for
v1, a playability failure is **visible evidence on the comparison record**,
not a gate-blocking review lead — honest about what's actually wired up,
matching the standing constraint the app applies everywhere else
(`ROADMAP.md`: "a match is not proof, a mismatch is not an accusation") by
not claiming enforcement that doesn't exist. Gate integration, if wanted,
is a natural follow-up once (or if) motion comparisons gain the same
scan-asset binding ownership verification already has.

**Tech stack:** Luau (Studio plugin,
`roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua`), Java 21
(desktop bridge, `LocalBridgeServer.java` + persistence), React 19 +
TypeScript (frontend evidence view).

## Global constraints

- **Honesty ceiling.** A `VERIFIED` playability result means "this clip
  played on a live Roblox-stock R6/R15 dummy without an engine error, in
  Studio, at this point in time." It does **not** mean the animation will
  behave identically on the target experience's actual custom rig, if one
  differs from Roblox's stock skeletons — that gap is out of scope for v1
  and must be stated in the UI copy, the same way ownership `VERIFIED` is
  scoped to "the facts were obtained," not "you have the right to use this."
- **Never auto-block; v1 doesn't gate-block at all.** A playability failure
  — an engine error, a marker that never fired, loop not honored — is
  surfaced as evidence on the comparison record, not fed into the release
  gate (see Architecture: no scan-asset binding exists for motion
  comparisons today). If gate integration is built later, it must follow
  the same rule as ownership: a human decision, never the check result
  itself, clears the gate.
- **R6 and R15 are independent facts, never merged.** A clip can play clean
  on one and error on the other; the UI shows both results separately, never
  a single collapsed pass/fail.
- **"Priority honored" is not a claim v1 can make.** `Animation.Priority`
  only has an observable effect when two tracks with different priorities
  play concurrently on the same rig — a single clip played alone on a
  scratch rig has nothing to out-prioritize. v1 records the clip's
  *declared* `Priority` value (already read today, unchanged) but does not
  claim to have verified it's behaviorally honored. `ROADMAP.md`'s "respects
  loop/priority/markers" phrasing is only fully met for loop and markers;
  this is a stated v1 limitation, not a silent gap.
- **Determinism is not required here.** Unlike the manifest export (which
  must stay byte-identical across regenerations), a playability check is a
  point-in-time live-engine observation, like ownership `checkedAt` — it is
  not re-derived on export, only read from what was persisted at check time.
- **No live playback simulation ships until the Task 0 spike confirms it's
  buildable.** See Task 0 below.
- **No wire schema version bump — and `playability` must be a top-level
  sibling field, not nested inside `source`/`candidate`.**
  `CreatorFlowAnimationBridge.lua`'s connect handshake does a *strict* match
  between its `SCHEMA` constant and the bridge's reported `health.schema` —
  any mismatch is a hard connect-time error, so bumping `SCHEMA` would force
  every already-installed plugin to update before it could connect at all.
  This phase does not need that: `creatorflow.roblox-motion/v0.1` stays as
  the schema string. But the payload's `source`/`candidate` fields are
  parsed by `LocalBridgeServer.parseMotionRequest` via
  `json.treeToValue(body.get("source"), NormalizedAnimation.class)`, and the
  bridge's `ObjectMapper` does not disable Jackson's default
  `FAIL_ON_UNKNOWN_PROPERTIES` — so adding a `playability` key *inside*
  `source`/`candidate` would throw `UnrecognizedPropertyException` on every
  submission from an updated plugin, not degrade gracefully. `playability`
  ships as a new **top-level** key alongside `schema`/`source`/`candidate`
  in the POST body (an object keyed `source`/`candidate`, each holding that
  animation's R6/R15 results), parsed by its own optional
  `body.get("playability")` read in `parseMotionRequest` — entirely
  independent of `NormalizedAnimation`, so the core motion-comparison type
  (and its Java/TS parity tests) are untouched by this phase.

## Task 0 (GATE) — Feasibility spike: does marker-firing survive scrubbed playback?

**Nothing past this task is built until the spike answers this.** The one
technical unknown that decides the whole approach: Roblox's `MarkerReached`
event is documented to fire during normal `AnimationTrack:Play()`
progression. Whether it *also* fires reliably when the probe advances
`TimePosition` programmatically (needed to walk the full timeline without
waiting real Studio wall-clock time) is unconfirmed.

**Files:** none committed — a throwaway script in Studio's command bar or a
scratch plugin, findings written to a short note (mirrors
`docs/superpowers/plans/2026-07-23-phaseA-task0-spike-note.md`).

- [ ] **Step 1** — In Studio, find and pin the exact stock R6 and R15 dummy
      rig asset IDs to use (e.g. via `InsertService`'s catalog, or the same
      rigs Roblox's own Animation Editor uses). Insert the R15 one, load a
      known `KeyframeSequence` with at least one authored `PoseMarker`, and
      `Humanoid:LoadAnimation` it.
- [ ] **Step 2** — Call `:Play()`, then advance `TimePosition` across evenly
      spaced samples (e.g. 30 samples across the clip's declared duration).
      Connect `MarkerReached` before playing; record whether it fires for
      every authored marker, some, or none.
- [ ] **Step 3** — If markers do **not** reliably fire under scrubbing, try
      the alternative: play at normal speed with
      `Heartbeat`-driven polling of `track.TimePosition` instead of manual
      scrubbing, and re-test. Record whether this is fast enough to be
      practical inside a plugin action (should complete in well under a
      second per clip, not real wall-clock duration).
- [ ] **Step 4** — Confirm engine errors are catchable: intentionally load a
      KeyframeSequence authored for the wrong rig type (e.g. an R15 clip
      forced onto an R6 dummy) and confirm `pcall` around
      `Humanoid:LoadAnimation`/`:Play()` actually surfaces a catchable error
      rather than a silent no-op.
- [ ] **Step 5** — Write the confirmed contract: the rig asset IDs pinned in
      Step 1, which playback-driving method to use (scrub vs.
      real-time-poll), whether markers are safe to report on or must be cut
      from v1 scope, and the exact error shape `pcall` returns. **This note
      is what the implementation plan codes against.**

**Completion test:** the note has a clear answer for Steps 2 and 4. If
marker-firing cannot be made reliable by Step 3's fallback, `markersFired`
is cut from the v1 `PlayabilityReport` and only `ok`/`error`/`loopHonored`/
`durationMeasured` ship — re-scope, don't block the rest of the phase on it.

## Components

**Plugin (`CreatorFlowAnimationBridge.lua`):**
- `fetchStandardRig(rigType: "R6" | "R15")` — fetches and caches a stock
  dummy via `InsertService` once per Studio session (not per Compare); a
  fetch failure is non-fatal (see Error handling).
- `probePlayability(clip: KeyframeSequence, rigType) -> PlayabilityResult`
  — clones the cached rig into a scratch container, loads and plays the
  clip per the Task 0 spike's confirmed method, wrapped in `pcall`, always
  destroys the clone before returning (success or failure).
- Wired into the existing `compareButton.Activated` handler, right after
  each `readAnimation` call — runs for both source and candidate, both rig
  types (4 probes per Compare).
- Pure logic (marker-list comparison, report formatting) gets a small
  self-check called once at script load. Note: this is a **new** pattern for
  this file, not an existing one — `Sha256.selfTest()` lives in
  `roblox-plugin/src/Sha256.luau`, part of the frozen legacy plugin tree,
  not `desktop-bridge/CreatorFlowAnimationBridge.lua` (which is a single
  flat `--!nonstrict` script with no modules and no self-test convention of
  its own today). This phase introduces the pattern to this file; it isn't
  following one already there.

**Desktop bridge (`LocalBridgeServer.java`):**
- `parseMotionRequest` gains a separate, independent read of an optional
  top-level `playability` key from the request body — absent means "not
  checked," not "a fault." This does **not** touch `NormalizedAnimation` or
  the `source`/`candidate` parsing path (see the schema constraint above for
  why: `FAIL_ON_UNKNOWN_PROPERTIES` would reject it there).
- Persistence extends the `animation_comparisons` row (`V005` migration)
  with a new nullable JSON column — additive, no migration of existing rows
  required, and no change to that table's existing keying (still
  `project_id` + the two raw asset IDs; see the gate-scope note above for
  why this table has no scan-asset link).

**Frontend:**
- A new evidence block on the comparison record's detail view (where
  score/verdict/mirrored/exact-curve-data already render), using
  `EvidenceBasisMark.tsx`'s existing tri-state visual language: `VERIFIED`
  when a report exists for that rig, `NOT_VERIFIED` when absent (old
  comparison, or the plugin's rig fetch failed). This is display-only in
  v1 — no decision-required flow, since that flow is built around
  gate-scoped `AssetEntry` decisions, a different object this data isn't
  bound to (see Architecture).

## Data flow

Compare pressed → plugin reads both animations (existing, unchanged) → for
each, `probePlayability` runs against cached R6 and R15 dummies (new) → one
JSON payload (existing `source`/`candidate` pose data, unchanged, plus a new
top-level `playability` object) POSTed to `/plugin/v1/motion-comparisons`
(existing endpoint, no schema-string bump) → `LocalBridgeServer` parses
`playability` independently and persists it on the comparison row →
frontend renders it on that comparison's evidence view. A failure is
visible there; it does not touch the release gate in v1 (see Architecture).

## Error handling

- **Rig fetch failure** (`InsertService` unreachable or asset missing):
  playability for that rig type reads `NOT_VERIFIED` with the reason
  "could not fetch a test rig" — Compare still completes and stores the
  comparison data exactly as it does today. Mirrors the ownership
  `UNVERIFIABLE` pattern (Phase A): an honest "could not check," never a
  false `VERIFIED`.
- **Per-rig engine error** (clip fails to load/play on that specific rig):
  captured as `{ ok: false, error: <engine message> }`, shown as-is — not
  swallowed, not retried silently.
- **Partial result** (clean on R6, errors on R15): both shown independently,
  per the "never merged" constraint above.
- **Cleanup is defensive**: rig-clone destruction happens in all paths
  (success, engine error, or an error inside the probe itself) so a script
  fault mid-check can't leave orphaned rigs in the workspace.

## Testing

- **Plugin:** no Luau test framework exists in this repo and none is being
  introduced. Pure logic (marker-list comparison, report formatting) gets a
  self-check on script load — a new convention for this file (see
  Components: `Sha256.selfTest()` is not actually precedent within
  `CreatorFlowAnimationBridge.lua`, it lives in the frozen legacy plugin).
  The actual rig-plays-for-real behavior is a manually-verified live-Studio
  step, tagged `[live-Studio]` in the same style as `FRIEND-TEST.md`.
- **Desktop bridge:** JUnit coverage for the new optional `playability`
  parsing (present and absent cases) and its persistence, following the
  existing pattern for the motion-comparison request tests.
- **Frontend:** vitest/RTL coverage for the new evidence block on the
  comparison detail view (all three tri-state cases, R6 and R15 shown and
  tested independently), following the existing pattern used for that
  view's other evidence marks.
- **Task 0 spike** (above) gates all of this — nothing here is built until
  it answers Steps 2 and 4.

## Out of scope for v1

- Fetching or approximating the *target experience's actual custom rig*
  (only Roblox's stock R6/R15 dummies are checked) — matches the roadmap's
  own phrasing ("the target rig (R6/R15)").
- CurveAnimation playback — Phase C's concern; the plugin already rejects
  `CurveAnimation` clips before this code would ever run.
- **Release-gate integration.** No scan-asset binding exists for motion
  comparisons today (see Architecture); wiring playability into the gate
  needs that binding built first, which is a separate feature, not a hidden
  sub-task of this one.
- **Verifying that `Priority` is behaviorally honored.** v1 records the
  declared value only (see Global Constraints); confirming it's respected
  would need a competing second track on the probe rig, which isn't built
  here.
