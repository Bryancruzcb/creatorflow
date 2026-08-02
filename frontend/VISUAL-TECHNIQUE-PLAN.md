# Visual technique plan

The type-scale migration has its own plan in [`NEXT-IMPROVEMENTS.md`](./NEXT-IMPROVEMENTS.md).
This file is the plan for the *expressive* work — the 3D and motion techniques — so that it
survives across sessions instead of living in one conversation.

## The rule everything here is measured against

**Every effect must either communicate evidence, reveal a relationship, explain motion, establish
hierarchy, or give useful feedback.** If it does none of those, it does not ship, no matter how
good it looks.

That is not conservatism. CreatorFlow's stated worst-case output is a confident false accusation,
so any technique that adds unearned certainty, drama, or alarm to a finding is a **trust** problem,
not a taste problem. A similarity score wrapped in bloom reads as naive to exactly the technical
audience this is for.

Two corollaries that have already decided real questions:

- **Texture belongs on the marketing surface, never on the instrument.** Grain over an evidence
  ledger makes measured values look noisy. This is why `.cf-treatment` is scoped to the landing
  route.
- **Nothing may invent a number.** No fabricated progress, no percentage the code cannot actually
  compute. The decode state is indeterminate for this reason.

## Done

Landing: hero deviation field (hand-written WebGL2 isolines, candidate set dashed to match the
root-path plot's existing convention), scroll reveals with a fail-safe sweep, film treatment,
designed decode state, scrubbed workflow rail, View Transitions on the landing↔workspace swap.

3D: `motion/sceneFoundation.ts` — one light rig, image-based lighting via `RoomEnvironment`,
contact shadows, one grading pipeline. Adopted in `ModelGallery`. Motion stage no longer renders
at full rate while paused.

Assets: showcase ships compressed 107 MB → 4.6 MB and actually deployed; decoder paths fixed so
compressed assets can load at all under the Pages base.

## Next, in order

> **Status audit, 2026-07-29.** This section had gone stale in the direction that wastes the most
> time: it lists finished work as "next", and item 1 says "do this first" when item 1 is done. Each
> item below was re-checked against its own *Done when* criterion, which is why those criteria were
> written as testable conditions in the first place.
>
> | item | status | evidence |
> |---|---|---|
> | 1. `sceneFoundation` in remaining viewers | **done** (stated criterion) | `new DirectionalLight` appears only in `motion/sceneFoundation.ts`; all four viewers import it. The "visually identical" half is unverified — no gate renders one asset through all four. |
> | 2. Shader-based deviation channel | **delivered, differently** | Per-vertex distance shaded through one perceptual ramp with a legend in stated units — but as its own `heatmap` mode, not by replacing `overlay`. Overlay still superimposes two meshes. |
> | 3. Phase-spaced pose trail | **done** | Three members (`TRAIL_OPACITY = [0.5, 0.34, 0.2]`) at `TRAIL_SPACING = 0.075`; the clamp-to-zero that made frame zero silently do nothing is gone, and members with no history render nothing instead of stacking on the live pose. |
> | 4. Root-path ribbon | **partly** | Start/end markers exist (`marker(path, 'start' \| 'end')`). Vertical travel and the degenerate in-place empty state are unverified. |
> | 5. One perceptual ramp | **done** | `DEVIATION_RAMP` measured monotonic in luminance: 0.0155 → 0.0986 → 0.2139 → 0.3717 → 0.6651. `NO_DATA_HEX` (`#3a3a38`, luminance 0.0421) is distinct from the ramp maximum. |
> | 5a. Heatmap performance | **done, measured** | See below — minutes to ~0.5 s on the asset it named. |
> | 6. Type scale | **done** (2026-07-29, #93) | The audit ratchet is empty — `frontend/audit/type-floor.spec.ts`'s `UNMIGRATED` set is `[]` and all 16 surfaces are strictly enforced (`frontend/audit/README.md`). |
>
> So the real remaining work in this section is **item 4's unverified half and the
> "visually identical" check item 1 never got.** Everything else is history and is kept below for
> the reasoning, not as a to-do list.

### 1. Adopt `sceneFoundation` in the remaining viewers
`GlbComparisonViewer`, `HeavyAssetViewer`, `AnimatedAssetViewer` still build their own rigs. Their
key lights sit at 4.1 / 4.4 / 4.6 against the shared rig's 2.4, and their pixel-ratio caps differ,
so the same asset is lit and resolved differently depending on which panel you are in.

This matters more than it sounds: **these viewers exist to decide whether one model derives from
another.** Two panels lighting their subject differently is the tool inventing a difference that
is not in the data. Do this first — it is a prerequisite for judging anything below.

*Done when:* one asset rendered in all four viewers is visually identical, and no component
constructs a `DirectionalLight` outside `sceneFoundation`.

### 2. Shader-based deviation channel on the registered overlay
Today overlay mode superimposes two opaque meshes and lets interpenetration imply difference. It
reads as z-fighting, not as measurement.

Replace with: candidate rendered as the subject, per-vertex distance to the reference shaded onto
its surface as one perceptual channel, with a legend carrying real ticks and units. Registration
is already structurally guaranteed — both rigs share one scene, one mixer pair, one progress value.

*Prerequisite:* item 1, and item 5's ramp — do not ship a second jet ramp.
*Done when:* a reviewer can point at a limb and say how far it deviates, in stated units.

### 3. Phase-spaced pose trail
"Onion skin" is currently **one** ghost per side at a hard-coded 7.5% phase lag, which clamps to
zero for the first 7.5% of playback — so at the start the feature silently does nothing. Replace
with a real trail of N poses spaced across phase.

*Done when:* the trail reads as motion history at any scrub position, including frame zero.

### 4. Root-path ribbon with time direction
The root path is a flat top-down SVG polyline that discards the Y channel entirely (vertical travel
is computed and only ever printed as a number) and encodes no direction — no arrowhead, no
start/end marker, no dot tied to the scrubber.

**Ship the empty state with it.** For in-place clips the path correctly collapses to a point, and
today a green 99% match sits beside a blank chart. A confident number computed on degenerate data
is the single worst thing this view can display.

*Done when:* direction and vertical travel are visible, and degenerate input says so instead of
scoring it.

### 5. One perceptual ramp, one legend
Four incompatible ramps currently encode "how different": orange→green (frame strip),
blue→amber→coral (3D heatmap), amber→rust (server pixel diff), green/amber/red (Roblox plugin).

The 3D one is jet-family and **non-monotonic in luminance** — computed 0.2549 → 0.4618 → 0.2187,
so "no deviation" and "maximum deviation" sit within 0.036 of each other while the midpoint is the
brightest thing on the model. In greyscale the two endpoints are indistinguishable.

Also: vertices whose neighbour search finds nothing are painted the ramp maximum, so "no data" and
"maximal deviation" are the same colour.

And the semantic bug — **high similarity currently renders green.** Green reads as pass. For a
provenance tool a high score is the *review* case. The scenario pills already get this right
(`EXACT CURVE DATA 100%` is red); the readout panel contradicts them.

*Done when:* one ramp, monotonic in luminance, colour-blind safe, with a legend above 11px, and
"no data" visually distinct from "maximum".

### 5a. The deviation heatmap was too slow to use on a real component — FIXED, MEASURED

**Corrected 2026-07-29.** This section said "KNOWN, UNFIXED" and prescribed getting the search off
the main thread. That work landed and nobody came back to update this file, so the plan has been
telling readers to go and do a finished job.

What it used to say, and it was true when written: selecting **Deviation heatmap** on the
~52k-triangle ship hull left "Computing normalized surface deviation…" on screen for **minutes**
with Chrome reporting the renderer unresponsive, because it was a main-thread nearest-neighbour
search over up to 60,000 source points for every vertex of the target.

Three things fixed it, none of which changed a single reported number:

- scan only the shell at each search radius instead of rescanning the inner cells — 153 cell lookups
  per vertex down to at most 125;
- stop as soon as the best hit is closer than the next ring could possibly contain;
- **the search moved to a worker** (`motion/deviation.worker.ts`, spawned by `HeavyAssetViewer`),
  with real fractional progress on a `role="progressbar"` and `AbortSignal` cancellation. The grid
  was also rekeyed from `${x}:${y}:${z}` template literals to packed integers, removing ~10 million
  string allocations.

Measured on the asset this section named — `dutch-ship-large-01.glb`, driven through the real UI in
Chrome at 1440, timed from clicking **Deviation heatmap** to the legend appearing:

| run | time | result |
|---|---|---|
| 1 | 555 ms | mean 1.14% · max 7.70% of frame · 54,365 vertices sampled |
| 2 | 510 ms | identical |
| 3 | 506 ms | identical |

Minutes to about half a second, with the same sample count and the same figures in all three runs —
so this is the same computation, not a cheapened one. The `AbortSignal` path also means a cancelled
search now throws rather than resolving `{ mean: 0, maximum: 0, samples: 0 }`, which used to read as
a flawless match over zero evidence.

Do not "fix" any future slowness by quietly cutting the sample count. The legend reports how many
vertices were sampled, and trading measurement precision for speed without saying so is the kind of
quiet inaccuracy the rest of this work exists to remove.

**Still true, and not measured here:** this is one component of one asset. Nothing establishes the
ceiling — a pair with no near neighbours anywhere defeats the early exit, which is the case the old
note correctly worried about. `render-budget.spec.ts` does not reach the comparison modes, so no
gate holds this number.

### 6. Type scale — much bigger than this file used to claim

This item read "StressLab / system-check type-scale pass, plus two stragglers in the motion lab at
10.56px and 9.17px". That was wrong, and wrong in the direction that matters: it made the
remaining work sound like a rounding error. Measured on `main` before the `.local-*` pass:

| | |
|---|---|
| `font-size` declarations in `src/styles/` | 547 |
| using a `--text-*` token | 144 (26%) |
| hardcoded under 12px | 316 |
| hardcoded under 9.6px | 165 |
| smallest | **6.56px** (`.scene-budget-section > small`) |

Done: `.local-*` (56 declarations — the ownership-verification surface), and `.release-*` plus
`.project-run-*` (62 declarations — the release-flow surface, which held the app's smallest
rendered text at 6.08px and went from 48 offenders to 0).

Remaining, in value order:

1. `landing` — now the largest single block at 39 rules, and the surface a stranger sees first.
2. `.scene-budget` / `.scene-tree` / `.subasset-*` — HeavyAssetViewer panels (app-assets, 14).
2. `.failure-lab` / `.system-check` — StressLab. This is what the item originally named.
3. `.release-*` — release map and inspector.

**Read this before doing another one.** Authored size is not rendered size. On the `.local-*` pass,
`.local-ownership-verdict > strong` was authored at 0.66rem and actually rendered at 0.51rem,
because `.local-asset-inspector section > div strong` (0,1,3) outranks `.local-ownership-verdict >
strong` (0,1,1). Grepping font sizes tells you what someone intended; only reading computed style
off the live element tells you what ships. Expect more of these — the file is full of generic
container-descendant rules that reach into nested components.

## Rejected, with reasons — do not re-add

| technique | why not |
|---|---|
| Bloom, chromatic aberration, displacement | Distort measured geometry. The overlay asserts pixel-registration; an effect that shifts or haloes an edge undermines the claim. |
| Raymarching, SDFs, fluid sim, flow fields, particles | No quantity in this product corresponds to them. Spectacle competing with evidence. |
| `mix-blend-mode` for the overlay | Blend modes make two known colours produce a third unknown one. Difference must be computed and encoded, not implied by compositing. |
| Custom cursors, magnetic elements, kinetic typography | Read as agency work. Closer to the "AI-generated" impression than anything currently on the page. |
| Sound design | Inappropriate for a review tool used alongside Studio. |
| Art-directed light mode | Bryan chose dark-only. `color-scheme: dark`, one `:root`, zero `prefers-color-scheme` blocks. Net-new work, its own project — **ask before starting**. |

## Budget

Bryan's instruction was "go crazy, and if it lags too much we can cut back" — so frame cost is not
a blocker, but measure rather than assume. `HeavyAssetViewer` already reports real draw calls and
triangles from `renderer.info`; use it. The motion stage is the most expensive surface in the app
and the first place a regression will show.
