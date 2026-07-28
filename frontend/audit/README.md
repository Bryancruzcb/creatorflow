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

## `overflow.spec.ts`

Asserts nothing overflows its container, at **390 / 820 / 1280**.

Added after the landing dossier shipped broken on a phone: three absolutely positioned sheets at
percentage widths, fine at 1440, and at 390px each was ~226px so every panel clipped its own text
and the manifest ran off the screen. The other two gates run at 1440 only, so a layout that fails
only when narrow was invisible to every check in the repo. They ask *is this readable*; this asks
*does it fit*.

`UNRESPONSIVE` lists the workspace views, which overflow by exactly 231px at phone width — the
224px nav rail is a fixed column at every width. Making the workspace responsive is a real project,
so it is recorded and logged rather than skipped. Same ratchet rule: entries come off, none go on.

The landing page is deliberately **not** on that list. It is the surface a creator is most likely
to open on a phone.

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
