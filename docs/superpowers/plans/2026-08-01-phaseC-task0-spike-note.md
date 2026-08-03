---
type: spike-note
project: CreatorFlow
phase: C
status: COMPLETE — all questions answered
date: 2026-08-02
---

# Phase C Task 0 — spike findings (COMPLETE)

Run live in Roblox Studio (Bryan driving the Command Bar, guided). **Every Task 0 question
is answered against the real engine — nothing below is inferred.** This note is the
contract Task 1's `normalizeCurveAnimation` codes against; the
`<TASK_0_CONFIRMED_*>` placeholders in the implementation plan can all be replaced with
the concrete values here.

Prior desk research (`2026-08-01-phaseC-task0-prep.md`) predicted most of this from the
official docs. Everything it predicted held up. The two things it could not answer —
out-of-range behavior and composition order — are now settled empirically.

## 1. All curve classes are `Instance.new`-creatable

```
CurveAnimation      true
Vector3Curve        true
EulerRotationCurve  true
FloatCurve          true
MarkerCurve         true
```

**Consequence: test fixtures need no upload, no Robux, no Toolbox hunting.** Build the
clip in code, register it with `AnimationClipProvider:RegisterAnimationClip(clip)` for a
temporary content ID, and fetch it back through the normal
`GetAnimationClipAsync` path. Verified working end to end.

## 2. Clip-level properties work verbatim — no fallback needed

`clip.Loop`, `clip.Priority` (an `Enum.AnimationPriority`, so `.Name` works), and
`clip.Length` (seconds, float) all read correctly off a `CurveAnimation`, because they
live on the shared `AnimationClip` base. A fixture with keys at t=0 and t=1 reported
`clip.Length = 1`.

**The design spec's Step 3 contingency is dead weight and should be struck.**
`normalizeCurveAnimation` reads `clip.Loop`/`clip.Priority.Name` exactly as
`normalizeKeyframeSequence` does, and `probePlayability`'s `declaredLooped` gets a real
boolean — so the `nil`-handling change proposed in Task 1 Step 4 is **not needed**.

## 3. Sampling API — confirmed signatures and real behavior

```
Vector3Curve:GetValueAtTime(t)       -> table of 3 (per-axis); nil per axis with no keys
EulerRotationCurve:GetRotationAtTime(t) -> CFrame, rotation-only (Position always 0,0,0)
```

Observed on a fixture with position X keyed 0→4 and rotation Y keyed 0→π/2 over 1 second:

| t | `Position` result | `Rotation` result |
|---|---|---|
| -0.5 | `0, nil, nil` | identity |
| 0 | `0, nil, nil` | identity |
| 0.5 | `2, nil, nil` | 45° about Y |
| 1 | `4, nil, nil` | 90° about Y |
| 1.5 | `4, nil, nil` | 90° about Y |

Four confirmed facts from this:
- **Interpolation is correct** — t=0.5 gives exactly 2, the midpoint of 0→4.
- **Out-of-range CLAMPS** to the first/last key value. No error, no `nil`, no
  extrapolation. This was undocumented everywhere and is the safest possible answer:
  the sampler hits t=0 and t=clip.Length on every clip, so this is a hot path, not an
  edge case.
- **Channels with no keys return `nil`, not 0.** Y and Z were never keyed and come back
  `nil`. `normalizeCurveAnimation` must handle a `nil` per component — treat as 0 for the
  transform, since an unkeyed channel means "no authored motion on this axis."
- **Angles are radians.** Feeding `math.pi/2` produced exactly a 90° rotation.

## 4. Sampling is DETERMINISTIC

31 samples across the clip, serialized and compared:

```
same clip, twice:          identical = true
after register + refetch:  identical = true
```

**Consequence: `CURVE_SAMPLED_SNAPSHOTS_ALLOWED = true`.** The snapshot-pinning lockout
designed into the spec and plan (Task 2 Step 16's guard, and the disabled Pin buttons in
Task 3) exists only to protect against non-deterministic fingerprints causing a false
"this animation changed" report. That risk does not materialize — sampling is stable both
within a run and across a full register/refetch round trip.

The guard should still be **implemented** (it costs little and documents the reasoning),
but shipped with the constant set to `true`, and the frontend Pin buttons left enabled for
`CURVE_SAMPLED` sides. Do not ship a known-safe capability disabled.

## 5. Composition order — CONFIRMED against Roblox's own animator

The one question that could have silently invalidated the whole design, and the only way
to answer it was to ask the engine. Built a Motor6D rig in code, loaded the fixture through
a real `Animator`, scrubbed to t=0.5, and read `Motor6D.Transform` — the actual transform
Roblox itself produces:

```
Transform          = 2, 0, 0, 0.707093, 0, 0.707120597, 0, 1, 0, -0.707120597, 0, 0.707093
Transform.Position = 2, 0, 0
candidate A (CFrame.new(pos) * rot) = 2, 0, 0        <-- MATCH
candidate B (rot * CFrame.new(pos)) = 1.414, 0, -1.414
```

**The composition is `CFrame.new(position) * rotationCFrame`.** Position and rotation are
independent; the rotation does not rotate the translation. Guessing candidate B would have
produced plausible-looking but silently wrong transforms on every curve-sourced clip.

Note the rotation matrix matches the 45° rotation `GetRotationAtTime(0.5)` returns
directly, confirming the rotation half needs no further transformation either.

**Method note for anyone repeating this:** the animation system does **not** step in Edit
mode. The first attempt returned an identity transform because the clip never applied.
This must be run during an actual playtest (press Play first). The Command Bar runs
client-side during playtest, so a self-contained script is required — `ServerStorage` is
not reachable from there.

## Contract for Task 1

```lua
-- tree: clip -> Folder(joint path, nested) -> "Position" (Vector3Curve)
--                                          -> "Rotation" (EulerRotationCurve or RotationCurve)
local p = positionCurve:GetValueAtTime(t)          -- {x, y, z}, any element may be nil
local r = rotationCurve:GetRotationAtTime(t)       -- rotation-only CFrame
local transform = CFrame.new(p[1] or 0, p[2] or 0, p[3] or 0) * r
local components = { transform:GetComponents() }   -- 12 components, feed roundNumber as today
```

Everything else in `normalizeCurveAnimation` (the sample-time loop, `roundNumber`
rounding, `MAX_POSES` enforcement, sort-before-emit) is unchanged from the plan.

## Still open, deliberately

- **`RotationCurve` (as opposed to `EulerRotationCurve`) was not exercised.** The docs say
  a joint's `Rotation` child may be either type; only `EulerRotationCurve` was tested.
  `RotationCurve` uses `GetValueAtTime` (returning a nullable CFrame), not
  `GetRotationAtTime` — the method name differs. Task 1 must branch on `:IsA()` and handle
  both; the `RotationCurve` branch ships untested until a real asset using it turns up.
- **Sample rate** (Task 0 Step 5) was not pinned. It is a free parameter with no
  correctness risk — pick a value against `MAX_POSES = 20000` during Task 1 with a real
  multi-joint clip, since it depends on joint count, which a 1-joint fixture can't inform.
- **`MarkerCurve` placement** in a real authored clip's tree remains unobserved (the class
  is creatable, but where Studio puts it when authoring is undocumented). The plan already
  handles this correctly by discovering markers via `IsA("MarkerCurve")` over descendants
  rather than a hardcoded path, and by defaulting curve-sourced `markers` to an empty list.
