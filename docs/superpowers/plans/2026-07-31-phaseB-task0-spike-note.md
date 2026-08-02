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

## 3. R6/R15 rig-topology mismatch produces NO error signal at all — a real v1 accuracy gap

Tested directly: inserted a Toolbox "R6 [Dummy]" rig into the workspace, forced the R15 idle animation (`rbxassetid://507766388`) onto its `Humanoid` via `LoadAnimation`/`Play`, wrapped in `pcall`.

Result: `ok: true, err: nil` — and unlike the invalid-ID case (finding #2), **no delayed async warning appeared either.** Roblox does not error, synchronously or asynchronously, when an animation's channels don't match a rig's joint names — it silently ignores the channels that don't bind and animates whatever (if anything) does. The clip "plays" from the engine's point of view; nothing signals that it's structurally wrong for this rig.

**Consequence: `probePlayability`'s three checks (pcall success, `Length > 0`, `IsPlaying` transitions) would ALL still pass for this exact case.** `track.Length` comes from the clip's own authored duration, independent of rig compatibility. `IsPlaying` reflects whether the timeline is advancing, not whether any joint is actually moving. None of the defensive checks from finding #2 catch this. A genuinely rig-incompatible animation would be reported as `{ ok: true }` — a false "plays clean."

**Decision: this is a stated v1 limitation, not something built around.** A real fix would mean comparing the clip's declared joint paths (already available from `normalizeKeyframeSequence`'s per-pose `jointPath` data) against each stock rig's known Motor6D joint-name set, and flagging zero/near-zero overlap as incompatible — a real, buildable idea, but a structural-compatibility check, not a playback probe, and meaningfully more scope than this phase set out to build. Not implementing it in v1. The honesty-ceiling language in the spec/plan needs to say plainly that a `VERIFIED`/`ok:true` result confirms the clip *loaded and ran* on the stock rig, not that every joint it targets actually exists on that rig — matching the same non-overclaiming discipline already applied to "Priority honored" and "target rig vs. the experience's actual custom rig."

## Not yet pinned — deferred to Task 1

- **Exact R6/R15 stock rig asset IDs.** Not obtained this session — the R6 dummy used for finding #3 above was inserted via the Toolbox as a one-off scene object, not fetched by ID via `InsertService` (which is what `fetchStandardRig` needs at runtime). Whoever picks up Task 1 should grab these via Studio's **Avatar tab → Rig Builder** (inserts a plain default R6 or R15 rig with one click, no search needed) or the Toolbox's "Copy Asset ID" option, and hard-code them where the plan currently has `RIG_ASSET_IDS = { R6 = 0, R15 = 0 }` TODO placeholders. This is a ~30-second task, not a design unknown — nothing about the architecture depends on which specific IDs are used.
