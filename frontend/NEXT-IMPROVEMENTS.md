# Frontend improvements — what is actually still open

> **Rewritten 2026-07-26.** The previous version of this file said the browser "does not yet call
> the Java scanner or persist human decisions", and listed the typed local bridge, SSE scan
> streaming, SQLite persistence and workspace-state restore as future work. All of that shipped.
> Its P0–P3 plan was also a roadmap for a *generic heavy-asset workbench*, which the
> [strategic redirect](../docs/STRATEGIC-REDIRECT.md) deliberately deferred — so the repo was
> carrying two contradictory roadmaps.

**The product roadmap lives in [`docs/ROADMAP.md`](../docs/ROADMAP.md).** This file is only the
frontend's own housekeeping list: work that is real, still open, and not covered there.

**The 3D and motion technique plan lives in [`VISUAL-TECHNIQUE-PLAN.md`](./VISUAL-TECHNIQUE-PLAN.md)**
— what is done, what is next and in what order, and which techniques were rejected and why. Read
the rejected list before adding a visual effect; several were turned down for trust reasons rather
than taste, and the reasoning is not obvious from the code.

## Type-scale migration — in progress

A type scale, weight, leading and tracking token set now exists in `styles.css`'s `:root`, plus
notes on the elevation tokens. **Step 1 (defining them) is done and changed no rendering.** What
remains is adopting them, which is the part that changes how the app looks.

The problem being fixed: there was no scale at all. 667 `font-size` declarations used **77 distinct
values**, with the sub-1rem band populated in ~0.01rem steps — 0.38, 0.39, 0.40, 0.41 … — which at
a 16px root is 0.16px apart. Those are not hierarchy levels, they are one-off guesses. 88% of sizes
sat under 12px and 57% under 10px, so nothing could be emphasised by size. Weight had collapsed the
same way: `500` appeared 169 times against 3 for true bold.

Rough mapping when migrating a surface:

| old range | token | notes |
|---|---|---|
| 0.38–0.55rem | `--text-3xs` | below legibility today; this is the floor now |
| 0.56–0.66rem | `--text-2xs` | mono labels, table headers |
| 0.67–0.76rem | `--text-xs` | secondary text, captions |
| 0.77–0.9rem | `--text-sm` | dense body, table cells |
| ~1rem | `--text-md` | body |
| 1.1–1.35rem | `--text-lg` / `--text-xl` | panel headings |
| 1.5–2.5rem | `--text-xl` / `--text-2xl` | section headings |
| clamp(...) heroes | `--text-display` | |

Adopt **one surface per PR**, so any regression is scoped and revertible: evidence ledger → nav
rail → panels → motion lab chrome. Do not do it in one sweep.

Two rules that matter more than the mapping:

- **Nothing renders below `--text-3xs` (11px).** The 6–10px text currently in the UI is the defect.
- **Mono is for measurement.** `var(--font-mono)` is applied 269 times against 3 for the sans face,
  including on layout containers like `.asset-browser` and `.dossier-sheet`. It is doing atmosphere
  rather than encoding meaning, and because it is on everything it can no longer mark what is a
  measured value. Restrict it to numerals, IDs, hashes and deltas.

## Still open

1. **`src/styles.css` is a ~11.7k-line monolith** with four `*.premium.css` override files beside
   it, and contains verified-dead selectors. Splitting it into tokens plus feature-scoped styles is
   the largest cleanup left in this workspace. The token layer above is the first step of it.
2. **`MotionComparisonLab.tsx`'s `MotionStage` renders every animation frame while visible**, even
   when paused and static, instead of using the demand-aware scheduler in `motion/renderLoop.ts`
   (which `AnimatedAssetViewer`, `GlbComparisonViewer` and `HeavyAssetViewer` already use). An
   IntersectionObserver and a visibilitychange handler stop it offscreen or on a hidden tab, so this
   is wasted work rather than a runaway loop.
3. **`HeavyAssetViewer.tsx` is large enough to be worth decomposing** (renderer lifecycle, asset
   loader, scene index, comparison renderer, heatmap worker, budget estimator, overlays).
4. **No accessibility gate** — axe-style checks plus a keyboard-only pass over the local project
   workspace are worth adding.

## Not open, contrary to older notes

- The browser **does** call the Java scanner: `src/bridge/localBridge.ts` talks to the desktop
  `LocalBridgeServer` over a same-origin, CSRF-protected loopback session, with scan progress over
  SSE (resuming from `Last-Event-ID`) and a polling fallback.
- Human decisions, source evidence, releases, motion snapshots, plugin pairings and ownership
  verifications **are** persisted in SQLite, append-only where it matters.
- Manifest validation runs against **build-time compiled** JSON Schema validators
  (`src/manifest/validators.generated.js`). Ajv's runtime `compile()` cannot be used at all here:
  the desktop app serves this bundle under `script-src 'self'`, and runtime codegen is a blank
  page. `npm run schema:check` fails if the committed validators drift from the schemas.

## Standing constraint

WebGL does not expose allocated, free, or total VRAM, so any memory figure in the viewers stays
explicitly labeled an estimate. That was true when this file was first written and is still true.
