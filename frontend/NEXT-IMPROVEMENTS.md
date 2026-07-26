# Frontend improvements — what is actually still open

> **Rewritten 2026-07-26.** The previous version of this file said the browser "does not yet call
> the Java scanner or persist human decisions", and listed the typed local bridge, SSE scan
> streaming, SQLite persistence and workspace-state restore as future work. All of that shipped.
> Its P0–P3 plan was also a roadmap for a *generic heavy-asset workbench*, which the
> [strategic redirect](../docs/STRATEGIC-REDIRECT.md) deliberately deferred — so the repo was
> carrying two contradictory roadmaps.

**The product roadmap lives in [`docs/ROADMAP.md`](../docs/ROADMAP.md).** This file is only the
frontend's own housekeeping list: work that is real, still open, and not covered there.

## Still open

1. **`src/styles.css` is a ~11.7k-line monolith** with four `*.premium.css` override files beside
   it, and contains verified-dead selectors. Splitting it into tokens plus feature-scoped styles is
   the largest cleanup left in this workspace. Deliberately *not* scheduled before the friend test:
   it is invisible to a user and risks visual regressions in the one flow being validated.
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
