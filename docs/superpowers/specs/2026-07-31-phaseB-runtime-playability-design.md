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
already happens, rather than a new endpoint. The desktop bridge persists it
next to the comparison; the frontend renders it as a new evidence facet in
the existing VERIFIED / DECLARED / NOT_VERIFIED tri-state
(`EvidenceBasisMark.tsx`), the same model used for ownership evidence. A
failed check becomes a review lead resolved through the existing
required-reason decision flow — **never an automatic release-gate block** —
matching the standing constraint the app applies everywhere else
(`ROADMAP.md`: "a match is not proof, a mismatch is not an accusation").

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
- **Never auto-block.** A playability failure — an engine error, a marker
  that never fired, loop/priority not honored — is a review lead. Only a
  human `APPROVED`/`EXCLUDED` decision clears the gate, exactly like the
  ownership-mismatch pattern in Phase A.
- **R6 and R15 are independent facts, never merged.** A clip can play clean
  on one and error on the other; the UI shows both results separately, never
  a single collapsed pass/fail.
- **Determinism is not required here.** Unlike the manifest export (which
  must stay byte-identical across regenerations), a playability check is a
  point-in-time live-engine observation, like ownership `checkedAt` — it is
  not re-derived on export, only read from what was persisted at check time.
- **No live playback simulation ships until the Task 0 spike confirms it's
  buildable.** See Task 0 below.
- **No wire schema version bump.** `CreatorFlowAnimationBridge.lua`'s
  connect handshake does a *strict* match between its `SCHEMA` constant and
  the bridge's reported `health.schema` — any mismatch is a hard connect-time
  error (`request`/`connectButton.Activated`, not a soft compatibility
  check). Bumping `SCHEMA` would force every already-installed plugin to
  update before it could connect at all, which this phase does not need:
  the new `playability` block is purely additive and optional, so it rides
  inside the existing `creatorflow.roblox-motion/v0.1` payload unchanged.
  The bridge parses it when present, treats it as absent otherwise — no
  version negotiation required either direction.

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

- [ ] **Step 1** — In Studio, insert a stock R15 dummy (e.g. via
      `InsertService`), load a known `KeyframeSequence` with at least one
      authored `PoseMarker`, and `Humanoid:LoadAnimation` it.
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
- [ ] **Step 5** — Write the confirmed contract: which playback-driving
      method to use (scrub vs. real-time-poll), whether markers are safe to
      report on or must be cut from v1 scope, the exact error shape `pcall`
      returns, and **the exact stock rig asset ID(s) used for R6 and R15**
      (pin real numbers — `fetchStandardRig` in the Components section below
      has nothing to fetch until this is pinned). **This note is what the
      implementation plan codes against.**

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
- A pure self-test function (`Playability.selfTest()`, following the
  existing `Sha256.selfTest()` pattern) covers the marker-comparison and
  report-formatting logic that doesn't require a live rig — no new test
  framework introduced.

**Desktop bridge (`LocalBridgeServer.java`):**
- `parseMotionRequest` (already parses the v0.1 wire body) gains optional
  `playability` parsing per animation — absent means "not checked," not "a
  fault."
- Persistence extends wherever the motion-comparison record is stored, with
  a new nullable column/JSON block per animation — additive, no migration
  of existing rows required.

**Frontend:**
- A new evidence row per animation using `EvidenceBasisMark.tsx`'s existing
  tri-state pattern: `VERIFIED` when a report exists, `NOT_VERIFIED` when
  absent (old comparison, or the plugin's rig fetch failed).
- A failure surfaces the required-reason decision UI already built for
  ownership mismatches — reused, not rebuilt.

## Data flow

Compare pressed → plugin reads both animations (existing, unchanged) → for
each, `probePlayability` runs against cached R6 and R15 dummies (new) → one
JSON payload (existing pose comparison data + the new `playability` blocks)
POSTed to `/plugin/v1/motion-comparisons` (existing endpoint, additive
schema) → `LocalBridgeServer` persists it → frontend evidence view renders
the new row → a failure requires a reasoned decision before the release gate
treats that asset as resolved.

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
  self-test function on load, matching `Sha256.selfTest()`. The actual
  rig-plays-for-real behavior is a manually-verified live-Studio step,
  tagged `[live-Studio]` in the same style as `FRIEND-TEST.md`.
- **Desktop bridge:** JUnit coverage for the new optional `playability`
  parsing (present and absent cases) and its persistence, following the
  existing pattern for the motion-comparison request tests.
- **Frontend:** vitest/RTL coverage for the new evidence row (all three
  tri-state cases) and the reused decision-flow integration, following the
  existing pattern used for ownership-mismatch decisions.
- **Task 0 spike** (above) gates all of this — nothing here is built until
  it answers Steps 2 and 4.

## Out of scope for v1

- Fetching or approximating the *target experience's actual custom rig*
  (only Roblox's stock R6/R15 dummies are checked) — matches the roadmap's
  own phrasing ("the target rig (R6/R15)").
- CurveAnimation playback — Phase C's concern; the plugin already rejects
  `CurveAnimation` clips before this code would ever run.
- Any change to the release gate's auto-block rules beyond adding one more
  review-lead source.
