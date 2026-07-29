# Landing dossier: a live rig instead of a page of claims

**Date:** 2026-07-28
**Surface:** `frontend/src/App.tsx` → `DossierSection`, the "Every exception arrives with context" section

## The problem

The section asserted the product's central claim and demonstrated none of it. Three tilted paper
sheets, a heading, a lead line, and three bullet points — every one of which was a statement the
reader had to take on faith, having been shown no exception and no context. It was also the most
reading-dense block on the page, in the position where a visitor decides whether to keep scrolling.

## The approach

Run the shipped comparison engine, live, against two clips on the sample rig, and colour the joints
it flags. The section's claim and the section's proof become the same object.

- **Left:** `public/assets/robot-expressive.glb`, playing `Walking`, orbitable, with a toggle to
  `WalkJump`.
- **Right:** an evidence panel that follows the selection — joint, match percentage, source,
  author, permission, decision.

Clicking a lit part of the model selects it. So does its chip in the panel, which is the keyboard
path and the reason the canvas does not need to be a focus target.

## Why this pairing

`analyzeMotionClips(Walking, WalkJump)` scores 70 overall and returns eight joints, led by
`UpperLeg.R` at 50% — the jump-off leg. The divergence is anatomically legible: a viewer who knows
nothing about motion comparison can see that the legs are where these two clips stop agreeing. A
pair scoring 12 or 99 would colour everything or nothing.

The engine already caps `trackScores` at its eight worst joints
(`motionAnalysis.ts:538`). A section titled "Every exception arrives with context" rendering
precisely the engine's own top-eight exceptions is the thesis demonstrating itself.

## Decisions worth keeping

**Nothing is illustrative.** The numbers come from the same entry point the motion lab calls, and
the provenance is read from `public/assets/robot-expressive-license.txt` — CC0 1.0 Universal, Tomás
Laulhé / Quaternius. If the engine's scoring changes, the section changes with it. A landing page
that hardcodes its numbers goes stale silently.

**Joint-to-mesh mapping is derived, not tabulated.** Twelve of the rig's fourteen meshes are rigid
props parented to the bone that drives them, so the joint is `mesh.parent`. The two hands are
skinned and sit on the scene root; those two are named explicitly, because picking a joint for a
skinned mesh by heaviest weight would be a guess dressed up as a derivation.

**three stays out of the entry chunk.** `vite.config.ts` states this as an invariant and
`MotionField` was hand-written against WebGL2 to honour it. The rig is behind `lazy()` plus an
IntersectionObserver, so nothing 3D downloads until the section is within about a screen.
`audit/bundle-split.spec.ts` now enforces it — measured 382 kB largest chunk on landing, 606 kB
arriving only after scrolling.

**Colour was solved against measured output, not chosen.** The studio rig multiplies albedo by
roughly three in linear light before ACES; sampling the rendered canvas put the rig's body at
rgb(168,168,144) from an albedo of 0.13. The neutral and ramp scales are derived backwards from the
pixel that should come out. The rig is desaturated first because its stock body material is a gold
sitting almost exactly on the warm end of `DEVIATION_RAMP`, which left the flagged joints invisible.

**Reduced motion gets the right frame, not an arbitrary one.** The mixer freezes at
`largestDifferenceProgress` — the moment the engine reports the two clips differ most.

## What was removed

- The three `.dossier-sheet` panels, the `.dossier-points` bullet list, and their CSS across
  `01-base.css`, `02-evidence.css` and `03-comparison.css`.
- `DossierArtwork.tsx`, `DossierArtwork.css` and `DossierArtwork.drift.test.ts`, which existed only
  to serve this section and had no other consumer. The extracted rotation curves in that file's
  header are preserved in git history.

## Gates

`landing` is now `heavy: true` in `audit/surfaces.ts` and has a `render-budget` target. Measured:
2 contexts, 956 triangles/frame, 6 draw calls/frame, 0 line primitives.

Adding a fourth GPU-heavy surface to a `fullyParallel` suite made the heavy-asset-viewer budget
test intermittently measure a viewer that had clicked but not yet uploaded geometry. Its `prepare`
now waits for the canvas rather than only sleeping.

## Not done

- The rig's thigh meshes are largely occluded by the torso skirt, so `UpperLeg.R` — the worst joint
  and the default selection — reads less strongly on the model than its lower leg and foot do. The
  chip and panel carry it; the model alone does not.
- `landing` remains in the type-floor `UNMIGRATED` set with 37 pre-existing sub-11px rules. The new
  subtree contributes none of them (verified at 0), but the debt was not paid down here.
