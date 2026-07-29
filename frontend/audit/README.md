# Audits

Standing quality gates that run against **rendered** pages, not against source.

```
npm run test:audit          # all eight gates, all 16 surfaces
npm run harness             # just the harness, at http://127.0.0.1:4176
```

## Why these exist

Each gate was added after a review finding that `vitest`, `tsc` and the e2e suite could not
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

Current debt, measured on `8e996db2`: **84 rules across 10 of 16 surfaces.**

| surface | rules | smallest |
|---|---|---|
| `landing` | 39 | 7.2px |
| `app-assets` | 14 | 7.84px |
| `app-overview` | 8 | 7.68px |
| `app-settings` | 8 | 9.6px |
| `app-evidence` | 4 | 9.92px |
| `app-stress` | 4 | 10.4px |
| `app-releases` | 3 | 9.12px |
| `app-gallery` | 2 | 9.92px |
| `app-motion` | 1 | 9.17px |
| `app-sources` | 1 | 8.96px |

`app-project` is **not** on this list any more: it was the largest block at 48 rules and held the
app's smallest rendered text at 6.08px, and it is now migrated and strictly enforced. An earlier
version of this section still listed it as the biggest debt, which is how a ratchet quietly starts
lying about which end it is at. Migration order is in
[`../VISUAL-TECHNIQUE-PLAN.md`](../VISUAL-TECHNIQUE-PLAN.md) item 6; `landing` is both the largest
remaining block and the first surface a stranger sees.

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

## `keyboard.spec.ts`

Keyboard behaviour of the first-run dialog. Five assertions, deliberately narrow.

`WorkspaceWelcome` rendered `role="dialog" aria-modal="true"` and handled Escape, and did nothing
else a modal has to do. `aria-modal` tells assistive tech the rest of the page is inert while the
DOM let Tab walk straight out of it — the announcement and the behaviour disagreed, which is worse
than not claiming modality at all.

Four of the five failed before the fix; only Escape passed. Restoration needed a stated target
before it could pass at all: the dialog opens from localStorage during mount, so nothing was ever
focused to return to. The workspace main region now carries `tabIndex={-1}` and receives focus, so
a keyboard user resumes at the content the dialog was covering.

**Scope, stated rather than implied.** A full keyboard audit — tab-order walks across all sixteen
surfaces, focus-indicator detection, generic trap detection — was rejected in review for bundling
four independent mechanisms, and because the proposed trap detector caught exactly one trap shape
(a `Tab` that leaves the active element unchanged) while reading as though it caught all of them.
Tab order, focus visibility and roving-tabindex behaviour across the app remain untested.

## `a11y.spec.ts`

Runs axe-core restricted to **accessible-name and announceability rules**, on all 16 surfaces.

Deliberately not a full WCAG sweep. A gate that fails on hundreds of pre-existing colour-contrast
findings gets switched off within a week, and a gate that is off catches nothing. Landmarks and
heading order still deserve their own pass with their own baseline.

Contrast has since got one — see below. This section used to justify the exclusion with "200
pre-existing findings", a number nobody had measured; the real figure was 332, and counting them
properly is what showed they were only fourteen colour pairs, which is what made the gate
tractable at all.

Verified to actually fail: injecting `<button></button>`, an `<img>` with no `alt`, and a bare
`<input>` produces `button-name`, `image-alt` and `label` violations. Worth re-checking if this
ever goes green after a large refactor — `withRules` silently evaluates nothing if a rule name is
misspelled.

## `contrast.spec.ts`

Colour contrast at the real WCAG AA thresholds, on all 16 surfaces — **baselined on colour pairs,
not on surfaces.**

That distinction is the whole gate. There were 332 findings across the sixteen surfaces, and they
were **fourteen distinct colour pairs**: the colour layer is tokenised, so the same few pairs
repeat everywhere. A surface-level baseline would have exempted every page in the app and tested
nothing. A pair-level one still fails the moment a new bad colour appears anywhere — and it
emptied out almost entirely when one token moved, because twelve of the fourteen were `--ink-dim`
on a near-black background. Raising that token took the list from fourteen pairs to two.

Ratios in `KNOWN_PAIRS` are recomputed from the hex at assertion time, so the numbers in the file
cannot drift from the colours in it. Same ratchet rule as the other gates: entries come off when a
token is fixed, nothing goes on.

**The baseline is now empty — zero findings across zero pairs, on all sixteen surfaces.** The last
two entries were one token failing in opposite directions at once: `--blue` was both a filled-button
background (needs to be darker so white text clears 4.5:1) and an accent text colour on dark
surfaces (needs to be lighter). No single value satisfies both, so it was split into `--blue-solid`
(48%, bounded by `--ink` sitting on it) and `--blue-accent` (67%, bounded by the lightest surface it
can land on) rather than moved.

An empty ratchet is a gate that can stop working without anyone noticing, so it is canaried:
reverting `--blue-accent` to the old value fails it, naming the element and the measured ratio.

Nodes axe cannot resolve — text over the WebGL hero, over gradients, over images — are reported
separately and budgeted, but **only on surfaces with no live canvas.** On canvas surfaces the count
depends on what the renderer has painted when axe looks: the landing hero measured 66 solo and 79
under parallel workers, same build. A budget on a number that moves is a flaky gate, and a flaky
gate gets deleted.

## `state-contrast.spec.ts`

The same WCAG AA thresholds, on all 16 surfaces, in three interaction states: **`:hover`, focus
(`:focus` + `:focus-visible` + `:focus-within` together, which is what one keyboard-focused element
actually matches) and `:active`.**

A page renders in its default state and axe has no notion of hovering, so until this gate no hover
style had ever been measured by anything. That gap was not hypothetical: `.button-primary:hover` put
`--ink` on the light blue at **2.81:1** — worse than the 3.66:1 default that `contrast.spec.ts` did
flag — and it was found by hand while splitting `--blue`, which is not a repeatable process.

Hover is applied with Chrome's `CSS.forcePseudoState`, the same thing DevTools' "force element
state" uses, not with a real mouse. Playwright's `hover()` runs full actionability checks and scrolls
elements into view: **1459ms per element**, about eleven minutes across sixteen surfaces. Forcing is
**17ms**, applies the real cascade, and shows up in computed style — same answer, ~84x cheaper. The
whole gate runs in about 19 seconds.

Which elements to force is read off `document.styleSheets` at runtime, never from a list in the
file. A gate that hardcodes which components have hover styles goes stale the first time somebody
adds one, and goes stale silently.

**Forcing them all at once is deliberate, and sound per state for a reason that was measured rather
than assumed.** Classifying every state rule by shape:

| state | self | descendant | sibling |
|---|---|---|---|
| `:hover` | 90 | 9 | 0 |
| `:focus-visible` | 32 | 0 | **1** |
| `:focus-within` | 2 | 2 | 0 |
| `:focus` | 2 | 0 | 0 |
| `:active` | 5 | 2 | 0 |

**self** and **descendant** are always safe: all three states propagate up the ancestor chain, so
"a node's own state plus its ancestors'" is exactly what a real interaction on it produces.
**sibling** (`.a:focus + .b`) is the one unsound shape, because it needs `.a` stated while `.b` may
also be stated, and focus and active are singular. Exactly one exists and it sets only `outline` /
`outline-offset`, which the colour rule never reads — so the gate **enforces** that rather than
trusting it: give that rule a colour and the gate fails saying so.

### How much each state actually covers

Worth knowing before reading a green tick as reassurance — the three are not equal:

| state | rules that set a colour | what the gate is doing |
|---|---|---|
| `:hover` | **83** | live coverage |
| `:active` | **3** | live coverage |
| focus | **0** | prospective only |

Every one of the 25 focus rules sets `outline`, `box-shadow` or a transform — **none changes a text
or background colour.** So the focus gate finds nothing today, and that is a fact about the
stylesheets, not evidence they are good. Its value is the day someone adds a focus colour.

It also does **not** answer the question that actually matters for focus: whether the focus ring
itself is visible enough. That is WCAG 1.4.11, and it is gated separately by
[`focus-ring.spec.ts`](#focus-ringspects) — which found a button whose ring never rendered at all.

For the record, since this section used to end by calling 1.4.11 ungated: `--focus` (`#6daae7`)
measures 5.89–7.65:1 against the four page surfaces and 2.66:1 against `--blue-solid`, but
`outline-offset: 3px` draws the ring outside the button onto the page surface, so that last figure
is not a live failure.

### Verified to fail — four canaries

- **Reverting `--blue-solid-hover`** fails it with `#f1f0ea on #6f93b8 = 2.81:1`, while
  `contrast.spec.ts` passes all 16. That gap is the whole argument for the gate existing.
- **Regressing `.button-primary:active`** to a light fill fails it with `2.60:1`.
- **Adding a low-contrast focus colour** fails it with `#4a4a4a on #111210 = 2.12:1` — the
  prospective coverage, demonstrated rather than asserted.
- **Breaking selector extraction** fails it for measuring nothing. For a gate with an empty
  baseline the dangerous failure is not a wrong answer, it is a vacuous green.

The sibling-rule guard was canaried too, and **the canary did not fire** — `:focus` was matching as
a prefix of `:focus-visible`, so the guard read the tail as `-visible + i` and skipped the one rule
it existed to watch. Fixed, re-canaried, fires now. A guard that has never been seen to fail is a
guard nobody has tested.

`:visited` and `:target` are not covered; neither is styled anywhere in this app.

## `focus-ring.spec.ts`

WCAG 1.4.11 on the focus ring itself: **3:1** against whatever it is drawn on. Three, not 4.5 — a
ring is a graphical object, not text.

`state-contrast.spec.ts` measures text colour while an element is focused and finds nothing, because
none of the 25 focus rules in this app changes a text or background colour. **They all set
`outline`.** So the entire focus treatment — the thing a keyboard user navigates by — was measured
by nothing, and "focus: 0 findings" was reporting on rules that do not exist rather than the ones
that do. axe has no rule for this; it is computed from the rendered page.

`outline-offset` decides what "against" means. A positive offset draws the ring outside the element,
so the adjacent colour is what is behind it; zero or negative overlaps the element, so its own
background counts too and the worse of the two is asserted. Colours are composited **by the browser
on a canvas** rather than parsed here — computed styles come back as `lab()`/`oklab()`, alpha is
possible at every layer, and reimplementing colour conversion plus compositing in a test is how a
gate ends up confidently wrong.

### It asserts two different things

**Ring contrast**, and **that focusing an element changes it at all.** The second exists because of
what the first found.

`.release-mode-research` carried a decorative dashed outline authored at `(0,2,0)`, and the global
`button:focus-visible` is `(0,1,1)`. The decoration won, so that button showed **no focus ring at
all** — a keyboard user got a 1px dashed amber line at **2.01:1**, identical to its resting state.
Contrast measurement alone would have read the decoration and reported the button as fine, which is
why the gate diffs the focused and unfocused signatures. `.release-map-node.selected` had the same
`(0,2,0)` defect and was found by reading the stylesheets — the gate missed it only because no node
is selected on load. Both are fixed.

### What it counts instead of asserting

Only an app-authored outline is honestly measurable, so two cases are budgeted per surface rather
than asserted, the same shape `contrast.spec.ts` uses for nodes axe cannot resolve:

- **The UA ring** (`outline-style: auto`). Chrome paints an adaptive two-tone ring and the computed
  `outline-color` does not describe it — it reports `rgb(16, 16, 16)`, which against a near-black
  surface would be a confident ~1:1 failure that is not real. A gate that invents failures gets
  switched off as fast as one that misses them.
- **No outline of its own.** Every such element here is an `input` whose affordance is drawn on a
  sibling or on its wrapper via `:focus-within`.

The budget assertion is not theoretical: it fired on first run, on three surfaces, against numbers
that had been guessed rather than measured.

### Not covered, and this one is load-bearing

**Only `outline` is measured.** A focus affordance built from `box-shadow`, `border-color` or a
wrapper's `:focus-within` is counted as unmeasurable, not checked. `CSS.forcePseudoState` also does
not propagate to ancestors, so a wrapper's `:focus-within` never renders while this gate looks —
`.product-search` uses exactly that pattern. Those elements are in the budget, which caps the hole
without pretending to close it.

Verified to fail three ways: dimming `--focus` (`#1e2f41 on #111210 = 1.38:1`, ×16), removing the
specificity fix (`1 unchanged when focused [button.release-mode-research]`), and breaking the
focusable selector (`no focusable element was found`).

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
