---
type: spike-note
project: CreatorFlow
phase: B
date: 2026-08-01
tags:
  - creatorflow
  - roblox
  - phase-b
  - task0-spike
---

# Phase B Task 0 — Feasibility spike findings

Run live in Roblox Studio (Bryan, Command Bar, `Place1` baseplate, playtesting his own default R15 character). Full transcript preserved in the session; this note is the pinned contract Tasks 1–3 code against.

## Confirmed

### 1. Marker-firing does NOT survive `TimePosition` scrubbing — real-time playback is required

Test animation: `rbxassetid://507766388` (Roblox's default idle — has one authored marker, `NamedKeyframeEvent`, at 3.7s; `Length` = 3.7666666507720947s).

- **Scrub method** (`track:Play()` then loop setting `track.TimePosition = (i/samples) * track.Length` across 30 samples): `Fired: 0 times`. Confirmed dead end.
- **Real-time-poll method** (`track:Play()`, then loop `task.wait(0.1)` while `track.IsPlaying`, capped at 10s): `Fired: 2 times. Waited 10.1 seconds.` The clip loops (default idle), so 2 fires in a 10s window against a 3.77s clip is exactly the expected cadence (fires once per loop, ~3.7s and ~7.4s in).

**Decision: `PLAYBACK_METHOD = real-time-poll`.** `markersFired` ships in v1 — the `Playability_selfTest`/`markersDeclaredIn` machinery from the plan is NOT dead weight, it has a real, working mechanism to plug into. Implementation must use `Heartbeat`-driven or `task.wait`-polled real playback, never `TimePosition` scrubbing, when marker-firing matters.

Practical note for Task 1: the poll loop needs a safety cap (10s worked fine here) since `IsPlaying` never goes false on its own for a looped clip — `probePlayability`'s loop must not simply wait for `IsPlaying == false` unconditionally; cap it (e.g. a small multiple of `track.Length`, or Task 0's 10s constant) and treat "capped out" as informative, not a failure — the clip is playing, it's just also looping.

### 2. `pcall` around `LoadAnimation`/`Play` does NOT catch every real failure — some fail asynchronously

Test: `Instance.new("Animation")` with `AnimationId = "rbxassetid://1"` (a reserved/invalid ID), wrapped in `pcall(function() ... humanoid:LoadAnimation(...):Play() end)`.

Result: `ok: true, err: nil` — pcall reported success. ~130ms later, a *separate*, uncatchable line appeared in Output: `Failed to load animation with sanitized ID rbxassetid://1: Animation failed to load, assetId: https://assetdelivery.roblox.com/v1/asset?id=1&serverplaceid=0`. This is an async engine-level load failure, not a Lua error — no `pcall` anywhere in the calling script can catch it.

**Caveat on scope:** this specific test used a fabricated invalid ID. In the real Compare flow, `probePlayability` only ever runs on an asset ID that `AnimationClipProvider:GetAnimationClipAsync` already read successfully (readAnimation succeeds first) — so this exact "totally nonexistent asset" failure mode can't actually occur in production. What we could NOT test live (Bryan stopped before an R6 dummy got inserted): whether a genuine **rig-type mismatch** (an R15-authored clip forced onto an R6 skeleton) behaves the same way (async, uncatchable) or differently (synchronous pcall-catchable error, or silent partial-success with unmatched joints just not animating).

**Decision: design `probePlayability` defensively, do not depend on `pcall` alone.** Given `pcall` is confirmed unreliable for at least one real failure class, Task 1's `probePlayability` should treat a successful `pcall` as necessary but not sufficient. After `:Play()`, also check: (a) `track.Length` is a finite, positive number (not 0/NaN — a sign the clip never really loaded), and (b) `track.IsPlaying` actually became `true` at some point after `:Play()` was called (a sign playback genuinely started). Fold both into the same `ok`/`error` result the pcall path already produces — no new UI state, matching the plan's existing "one ok/error pair" design.

## Not yet pinned — deferred to Task 1

- **Exact R6/R15 stock rig asset IDs.** Not obtained this session (Toolbox/Rig Builder navigation didn't complete). Task 1's `fetchStandardRig` needs two real numeric asset IDs before it can run for real — whoever picks up Task 1 should grab these via Studio's **Avatar tab → Rig Builder** (inserts a plain default R6 or R15 rig with one click, no search needed) or the Toolbox, and hard-code them where the plan currently has `<RIG_R6_ASSET_ID>`/`<RIG_R15_ASSET_ID>` placeholders. This is a ~30-second task, not a design unknown — nothing about the architecture depends on which specific IDs are used.
- **R6/R15 rig-mismatch error behavior specifically** (vs. the invalid-ID case tested above). Not blocking, per the defensive-design decision above — `probePlayability`'s `Length`/`IsPlaying` checks are the mitigation regardless of which failure shape a mismatch turns out to take.
