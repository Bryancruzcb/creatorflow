# Audits

Standing quality gates that run against **rendered** pages, not against source.

```
npm run test:audit          # both gates, all 16 surfaces
npm run harness             # just the harness, at http://127.0.0.1:4176
```

## Why these exist

Both gates were added after review findings that `vitest`, `tsc` and the e2e suite could not
possibly have caught:

- A verdict headline authored at `16px` **rendered at `12px`**, because
  `.local-asset-inspector section > div strong` (0,1,3) outranks `.local-ownership-verdict >
  strong` (0,1,1). Grepping declarations reported it as fixed.
- A `<small>` inside a 12px `<dd>` rendered at 10px. There is no `10px` anywhere in the source —
  it comes from the UA's `font-size: smaller`.
- A colour channel that was the sole carrier of a measurement, with no text alternative.
- A progress readout injected into an `aria-live` region, announcing ~41 times per run.

The common thread: **authored is not rendered.** These read computed style and the accessibility
tree off live pages.

## `type-floor.spec.ts`

Asserts no visible text renders below **11px** (`--text-3xs`, the floor set in
`NEXT-IMPROVEMENTS.md`).

Surfaces listed in `UNMIGRATED` are known debt: they log their count and smallest size to CI
output instead of failing. **It is a ratchet — entries come off as surfaces migrate, and nothing
may be added.** A regression on an already-clean surface fails immediately.

Current debt, largest first: `app-project` (49 rules, smallest 6.08px), `landing` (40),
`app-assets` (17), `app-overview` (11). Migration order is in
[`../VISUAL-TECHNIQUE-PLAN.md`](../VISUAL-TECHNIQUE-PLAN.md) item 6.

## `render-budget.spec.ts`

Does the 3D actually render, and how much is it drawing?

Before this, ~3,400 lines across six viewers had **no automated verification of any kind** —
`HeavyAssetViewer` (1,143 lines), `ModelGallery`, `GlbComparisonViewer`, `AnimatedAssetViewer` and
`StressLab` had zero test files referencing them, and `MotionComparisonLab`'s three covered only
pure functions. Every serious rendering defect found in review lived in that band.

`glCounters.ts` wraps `drawElements` / `drawArrays` / `getContext` / `requestAnimationFrame` via
`addInitScript`, which reproduces `renderer.info.render` from outside with no production change.

Frames come from rAF, **not** from `gl.clear`: `HeavyAssetViewer` issues two autoClear'd `render()`
calls per frame (main scene plus scissored minimap), so a clear-derived count is 2x and every
per-frame number derived from it would be half the truth.

Measured on this build at 1440:

| surface | frames | calls/f | lines/f | tris/f |
|---|---|---|---|---|
| model gallery | ~520 | 3 | 0 | ~826 |
| animation compare | ~87 | 45 | ~116 | ~6,300 |
| heavy asset viewer | ~87 | 19 | 0 | ~3,136 |

**The line budget is per frame, not per draw call.** The wireframe overlay removed from the motion
lab emitted 58,266 line primitives across 114 calls — about 511 each, which slides under any sane
per-draw ceiling. Reintroducing that defect measured 57,028 lines/frame with a
`maxLinePrimitivesInOneDraw` of only **1,710**: a 2,048 per-draw ceiling would have passed it.

Verified by canary: with the defect injected the gate fails with the real number; restored, it
passes. It also caught a flaw in itself first — at phase 0 no trail member has history, so the
original spec measured the stage with its most expensive feature switched off. It now scrubs to
mid-clip before measuring.

Viewers are demand-rendered and suspend offscreen, so `wakeCanvases` scrolls each canvas into view
and drags once; without it every surface measures zero and a broken viewer reads as a pass.

**Not covered, stated rather than implied:** StressLab's animation gate did not mount a context in
this harness, and `HeavyAssetViewer`'s comparison modes (including the deviation heatmap) are not
reached. That heatmap path is where a wireframe overlay would most plausibly reappear.

## `overflow.spec.ts`

Asserts nothing overflows its container, at **390 / 820 / 1280**. All 48 checks assert — there is
no baseline.

Added after the landing dossier shipped broken on a phone: three absolutely positioned sheets at
percentage widths, fine at 1440, and at 390px each was ~226px so every panel clipped its own text.
The other gates run at 1440 only, so a layout that fails only when narrow was invisible to every
check in the repo. They ask *is this readable*; this asks *does it fit*.

**Correcting this file's own history.** An earlier version of this section said the workspace shell
"does not collapse on a phone" and blamed a 224px fixed nav rail. That was measured false. The
shell already collapses at 48rem in `06-local.css` — `.product-workspace` becomes `display: block`
and the sidebar a full-width row.

The real 231px was one declaration: a `@media (max-width: 48rem)` override pinning the proof ribbon
to `repeat(5, minmax(7.6rem, 1fr))`, which lays 608px of tracks inside a 366px ribbon. It was
identical on all nine views because the ribbon is shell chrome, and `app-settings` measured 0 only
because that view renders no ribbon — which the old note read as "settings is fine".

Measured at 390px after the fix: `121.3px x3`, ribbon height **157px**. That is up from 99px, and
worth stating plainly — showing five proof steps on a 390px screen costs vertical space. The
`7.6rem` the first attempt proposed would have given two 182px tracks and a **216px** ribbon, so
`7rem` is a measurement, not a preference.

Both fixes are proven load-bearing by mutation: reverting only the ribbon rule produces exactly
nine `231px` failures; reverting only `.stress-pack-rows` produces exactly one, `app-overview` at
16px.

## `a11y.spec.ts`

Runs axe-core restricted to **accessible-name and announceability rules**, on all 16 surfaces.

Deliberately not a full WCAG sweep. A gate that fails on 200 pre-existing colour-contrast
findings gets switched off within a week, and a gate that is off catches nothing. Contrast,
landmarks and heading order deserve their own pass with their own baseline.

Verified to actually fail: injecting `<button></button>`, an `<img>` with no `alt`, and a bare
`<input>` produces `button-name`, `image-alt` and `label` violations. Worth re-checking if this
ever goes green after a large refactor — `withRules` silently evaluates nothing if a rule name is
misspelled.

## The harness (`../harness/`)

`LocalEvidenceView`, `LocalProjectOverview`, `LocalScanView`, `LocalReleasesView` and
`LocalSourcesBoundary` are gated on a live desktop bridge (`activeLocal && bridgeClient` in
`ProductWorkspace`). They never render in `npm run preview`, never render on the deployed site,
and were reachable by no automated check of any kind. The harness mounts them against a stub
bridge so they can be measured and audited like everything else.

It is a **separate Vite root** (`vite.harness.config.ts`); `npm run build` never sees it, and
nothing under `src/` imports it. That matters because it ships fabricated evidence records, and
this product's worst-case output is a confident false claim.

Fixtures are deliberately unflattering — long paths, a group-owned asset, a blocked release,
scan warnings. A harness seeded with short tidy strings only proves the layout survives short
tidy strings.

**Adding a scene:** add it to `harness/main.tsx`, then to `surfaces` in `audit/surfaces.ts`.
`stubClient` validates against a `REQUIRED` list of every method the local views call, and throws
naming the missing one — regenerate that list with:

```sh
grep -oE 'client\.[a-zA-Z]+' src/components/LocalProjectWorkspace.tsx | sort -u
```
