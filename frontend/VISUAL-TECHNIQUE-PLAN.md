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

### 5a. The deviation heatmap is too slow to use on a real component — KNOWN, UNFIXED

Found by finally driving the view on a real asset, which only became possible once the showcase
ships were actually deployed. Selecting **Deviation heatmap** on the ~52k-triangle ship hull leaves
"Computing normalized surface deviation…" on screen for **minutes**, and Chrome reports the
renderer as unresponsive. It is a main-thread nearest-neighbour search over up to 60,000 source
points for every vertex of the target.

Two exact optimisations are already in (neither changes the result):

- scan only the shell at each search radius instead of rescanning the inner cells — 153 cell
  lookups per vertex down to at most 125;
- stop as soon as the best hit is closer than the next ring could possibly contain.

They help, and they are not enough: the early-exit only pays off when a near neighbour exists, and
the whole point of this view is components that differ. The grid was also rekeyed from
`${x}:${y}:${z}` template literals to packed integers, removing ~10 million string allocations.

**The real fix is to get it off the main thread** — a worker, or chunking across frames with real
progress — not further micro-optimisation. Until then the feature is effectively unusable on
anything large, and the "Computing…" state is indefinite rather than slow.

Do not "fix" this by quietly cutting the sample count. The legend reports how many vertices were
sampled, and trading measurement precision for speed without saying so is the kind of quiet
inaccuracy the rest of this work exists to remove.

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

Done: `.local-*` (56 declarations — the ownership-verification surface).

Remaining, in value order:

1. `.scene-budget` / `.scene-tree` / `.subasset-*` — HeavyAssetViewer panels, includes the 6.56px floor.
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
