import { expect, test } from '@playwright/test';
import { installGlCounters, readGlStats, wakeCanvases } from './glCounters';
import { open, surfaces } from './surfaces';

/**
 * Does the 3D actually render, and how much is it drawing?
 *
 * Until this existed, ~3,400 lines across six viewers had no automated verification of any kind:
 * HeavyAssetViewer (1,143 lines), ModelGallery, GlbComparisonViewer, AnimatedAssetViewer and
 * StressLab had zero test files referencing them, and MotionComparisonLab's three only covered
 * pure functions. Every serious rendering defect found in review lived in that untested band.
 *
 * The first assertion here is the one that matters and the one nothing had: that a viewer submits
 * geometry at all. A viewer that silently renders nothing looked identical to a working one.
 */

/** Measured on this build; see the table in audit/README.md. */
const TARGETS = [
  {
    id: 'landing',
    label: 'landing dossier rig',
    /**
     * Scroll to the section before measuring.
     *
     * The rig is held back behind an IntersectionObserver so three is not downloaded by a visitor
     * who never reaches the section, and `createCanvasRenderLoop` suspends it again whenever it is
     * offscreen. Measuring from the top of the page therefore reports zero contexts and zero
     * frames — which is correct behaviour and would read here as a broken viewer.
     */
    prepare: async (page: import('@playwright/test').Page) => {
      await page.locator('#product').scrollIntoViewIfNeeded();
      await page.waitForSelector('.evidence-rig-canvas', { timeout: 20_000 });
      await page.waitForTimeout(2500);
    },
  },
  {
    id: 'app-gallery',
    label: 'model gallery',
    prepare: null as null | ((page: import('@playwright/test').Page) => Promise<void>),
  },
  {
    id: 'app-motion',
    label: 'animation compare',
    /**
     * Scrub to mid-clip before measuring.
     *
     * Found by canarying this gate: reintroducing the wireframe trail defect did NOT trip it,
     * because at phase 0 no trail member has any history and none are attached to the scene. The
     * test was measuring a stage with its most expensive feature switched off and reporting a
     * pass. A budget that never exercises the thing it budgets is worse than no budget.
     */
    prepare: async (page: import('@playwright/test').Page) => {
      const slider = page.locator('.motion-compare-transport input[type=range]').first();
      if (await slider.count()) {
        await slider.evaluate((el: HTMLInputElement) => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          set.call(el, '0.6');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForTimeout(1200);
      }
    },
  },
  {
    id: 'app-assets',
    label: 'heavy asset viewer',
    // The heavy viewer is opt-in: the surface renders a list and a still until you ask for the
    // model. Measuring without this click reports zero and would read as a broken viewer.
    /**
     * Waits for the canvas rather than only sleeping.
     *
     * The fixed 5s settle was enough while three GPU-heavy surfaces ran concurrently. The landing
     * rig makes four, and under that much contention this occasionally measured a viewer that had
     * clicked but not yet uploaded its geometry — reported as "no geometry was submitted", which
     * reads like the defect the gate exists to catch rather than the timing artefact it was.
     */
    prepare: async (page: import('@playwright/test').Page) => {
      const load = page.getByRole('button', { name: /Load 3D model/i }).first();
      if (await load.count()) {
        await load.click();
        await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => undefined);
        await page.waitForTimeout(6000);
      }
    },
  },
];

/**
 * Per FRAME, not per draw call.
 *
 * This is the correction that makes the budget meaningful. The wireframe overlay removed from the
 * motion lab emitted 58,266 line primitives across 114 draw calls — about 511 per call, which
 * slides comfortably under any sane per-draw ceiling. Only the per-frame total separates it from
 * legitimate work.
 *
 * Measured on this build: the motion stage draws 101 line primitives per frame with its skeleton
 * trail and both rigs' scope skeletons; the gallery and heavy viewer draw none. 2,000 is roughly
 * twenty times the observed maximum and thirty times below the historical defect, which is the
 * kind of gap that does not flake.
 */
const MAX_LINE_PRIMITIVES_PER_FRAME = 2000;

for (const target of TARGETS) {
  const surface = surfaces.find((s) => s.id === target.id);
  test(`renders · ${target.label}`, async ({ page }) => {
    /**
     * These four are the slowest tests in the suite and do not fit the 30s default on CI.
     *
     * Each one loads a surface, waits out a settle, drives an interaction and then waits again for
     * frames to accumulate. The landing rig is the worst of them: it additionally fetches the
     * ~600 kB renderer chunk it is deliberately code-split behind, decodes a glTF and runs the
     * comparison engine before it draws anything. On a software rasteriser that overran 30s and
     * failed at `readGlStats` — a timeout, not a rendering fault, but indistinguishable from one
     * in the report.
     */
    test.setTimeout(150_000);
    expect(surface, `${target.id} is not in surfaces.ts`).toBeTruthy();
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Before goto: the getContext wrapper has to exist before any page script runs.
    await page.addInitScript(installGlCounters);
    await open(page, surface!);
    if (target.prepare) await target.prepare(page);
    await wakeCanvases(page);

    const gl = await readGlStats(page);
    console.log(
      `  [gl] ${target.id} ctx=${gl.contexts} frames=${gl.frames} calls/f=${gl.callsPerFrame} `
      + `lines/f=${gl.linePrimitivesPerFrame} tris/f=${gl.trianglePrimitivesPerFrame} `
      + `maxLineDraw=${gl.maxLinePrimitivesInOneDraw}`,
    );

    expect(gl.contexts, `${target.label}: no WebGL context was created`).toBeGreaterThanOrEqual(1);
    expect(gl.frames, `${target.label}: no frames were rendered`).toBeGreaterThan(0);
    expect(
      gl.trianglePrimitivesPerFrame,
      `${target.label}: a WebGL context exists and frames ran, but no geometry was submitted — `
      + 'the viewer is drawing nothing',
    ).toBeGreaterThan(0);

    expect(
      gl.linePrimitivesPerFrame,
      `${target.label}: ${gl.linePrimitivesPerFrame} line primitives per frame exceeds `
      + `${MAX_LINE_PRIMITIVES_PER_FRAME}. A full-mesh wireframe overlay looks exactly like this — `
      + 'the one removed from the motion lab drew 58,266 across 114 calls.',
    ).toBeLessThanOrEqual(MAX_LINE_PRIMITIVES_PER_FRAME);
  });
}

/**
 * The deviation heatmap: the one comparison mode that computes before it draws.
 *
 * This path was named in this file's own "not covered" note as "the most likely place a wireframe
 * overlay would reappear", and it stayed uncovered because reaching it needs an asset chosen, a
 * component match selected, a mode switched, and then a worker to finish. It is worth the setup for
 * two independent reasons.
 *
 * ONE: it draws. Every other target here proves a viewer submits geometry; this proves the heatmap
 * does too, and holds the same per-frame line budget that the removed full-mesh wireframe would
 * blow through.
 *
 * TWO, and the reason this exists at all: it is the only check on how long the search takes.
 * VISUAL-TECHNIQUE-PLAN 5a recorded this feature as unusable — "Computing normalized surface
 * deviation..." on screen for MINUTES with Chrome reporting the renderer unresponsive — because the
 * nearest-neighbour search ran on the main thread. Moving it to a worker took it to ~0.5s on the
 * 54,365-vertex ship, measured three times. Nothing guarded that number, so nothing would notice it
 * going back.
 *
 * The ceiling is deliberately loose. This runs on a software rasteriser on CI against a real glTF
 * and a real worker, so a tight bound would flake and a flaky gate gets deleted. It is not
 * asserting 0.5s; it is asserting the difference between "half a second" and "minutes", which is
 * the regression that actually matters and the one that shipped before.
 */
/**
 * This mode gets its own line ceiling, an order of magnitude above the 2,000 the other targets use.
 *
 * That is not the budget being relaxed to fit — it is the two views measuring different things. The
 * motion lab's 2,000 bounds a SKELETON overlay, which is tens of lines by nature; app-motion sits at
 * 116. Here the overlay traces the feature edges of a 54,365-vertex hull, and the floor for that is
 * thousands however it is drawn. Measured on the shipped ship: 20,907 at a 32-degree threshold,
 * 15,547 at 45, 11,571 at 60, 9,099 at 75. Sixty is what ships, keeping hard features and silhouette
 * while dropping interior tessellation.
 *
 * 30,000 is therefore set to catch the failure that actually occurred — a full-mesh wireframe at
 * 115,251 — with room for the legitimate overlay, rather than to a number that would force the
 * reference surface to be deleted to satisfy it.
 */
const HEATMAP_MAX_LINE_PRIMITIVES = 30_000;

const HEATMAP_CEILING_MS = 45_000;

test('renders · deviation heatmap', async ({ page }) => {
  test.setTimeout(180_000);
  const surface = surfaces.find((s) => s.id === 'app-assets');
  expect(surface, 'app-assets is not in surfaces.ts').toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(installGlCounters);
  await open(page, surface!);

  // The heaviest shipped asset, which is the one 5a's claim was made about.
  const assets = page.locator('.heavy-asset-list button');
  const count = await assets.count();
  let picked = false;
  for (let i = 0; i < count; i += 1) {
    const label = await assets.nth(i).innerText().catch(() => '');
    if (/ship/i.test(label)) { await assets.nth(i).click(); picked = true; break; }
  }
  expect(picked, `no ship asset in the list of ${count} — the fixture set changed`).toBe(true);
  await page.waitForTimeout(3000);

  const matchMap = page.getByRole('button', { name: /match map/i });
  if (await matchMap.count() && await matchMap.isEnabled()) await matchMap.click();
  await page.waitForTimeout(1500);

  const findings = page.locator('.subasset-match-list button, .subasset-matches button');
  expect(await findings.count(), 'no component matches to compare — the match fixture changed').toBeGreaterThan(0);
  await findings.first().click();
  await page.waitForTimeout(800);

  const compare = page.getByRole('button', { name: /compare pair/i });
  expect(await compare.count(), 'the Compare pair control is gone').toBeGreaterThan(0);
  await compare.click();
  await page.waitForTimeout(4000);

  const heatmap = page.getByRole('button', { name: /deviation heatmap/i });
  expect(await heatmap.count(), 'the Deviation heatmap mode is gone').toBeGreaterThan(0);

  const started = Date.now();
  await heatmap.click();
  /**
   * Waiting on the legend, not on a timeout, because the legend only renders once `heatmapStats`
   * exists — i.e. once the worker returned a real result. A cancelled or failed search throws
   * rather than resolving, so this cannot pass on a fabricated zero.
   */
  await page.locator('.surface-heatmap-legend').waitFor({ state: 'visible', timeout: HEATMAP_CEILING_MS });
  const elapsed = Date.now() - started;

  const legend = (await page.locator('.surface-heatmap-legend small').first().innerText()).split('\n').join(' ');
  await wakeCanvases(page);
  const gl = await readGlStats(page);

  console.log(
    `  [gl] deviation-heatmap ready=${elapsed}ms ctx=${gl.contexts} frames=${gl.frames} `
    + `calls/f=${gl.callsPerFrame} lines/f=${gl.linePrimitivesPerFrame} `
    + `tris/f=${gl.trianglePrimitivesPerFrame}
       legend: ${legend}`,
  );

  expect(elapsed, `the heatmap took ${elapsed}ms. 5a recorded this as minutes before the search `
    + 'moved to a worker; this ceiling exists to notice it going back.').toBeLessThan(HEATMAP_CEILING_MS);

  expect(gl.contexts, 'no WebGL context').toBeGreaterThanOrEqual(1);
  expect(gl.frames, 'no frames rendered').toBeGreaterThan(0);
  expect(
    gl.trianglePrimitivesPerFrame,
    'the heatmap mode submitted no geometry — it is shading per-vertex deviation onto a surface, '
    + 'so zero triangles means nothing is being measured on screen',
  ).toBeGreaterThan(0);

  /**
   * Bounded on BOTH sides, because each end is a real defect this mode has already had.
   *
   * Above: a full-mesh wireframe on the reference surface, which is what this measured on its first
   * run — 115,251 line primitives per frame.
   * Below: zero, which is what the first attempt at fixing that produced. The replacement edges
   * were parented to a mesh that was then hidden, and `visible` is inherited in three, so the
   * overlay never drew. That reads as a comfortable pass against a ceiling while the reference
   * surface has silently vanished from the view.
   */
  expect(
    gl.linePrimitivesPerFrame,
    `the heatmap drew ${gl.linePrimitivesPerFrame} line primitives per frame against a ceiling of `
    + `${HEATMAP_MAX_LINE_PRIMITIVES}. A full-mesh wireframe on the reference surface looks exactly `
    + 'like this: that is what this measured on its first run, at 115,251.',
  ).toBeLessThanOrEqual(HEATMAP_MAX_LINE_PRIMITIVES);

  expect(
    gl.linePrimitivesPerFrame,
    'the heatmap drew no line primitives at all. The reference surface is meant to render as '
    + 'feature edges behind the shaded candidate; zero means it is not being drawn, which passes '
    + 'a ceiling check while losing the only cue for where the reference extends past the target.',
  ).toBeGreaterThan(0);

  // The legend reports what was actually sampled. A search that quietly sampled far fewer vertices
  // would be fast for the wrong reason, and 5a explicitly warns against buying speed that way.
  expect(legend, 'the legend no longer reports a sample count').toMatch(/vertices sampled/);
});

/**
 * Not covered, stated rather than implied:
 *
 * - StressLab's animation gate. "Open rig and timeline" did not mount a context in this harness
 *   and the reason was not chased; it is a real gap, not a passing surface.
 * - HeavyAssetViewer's comparison modes, including the deviation heatmap. Reaching them needs a
 *   component match selected and a mode switched, and the heatmap additionally runs a worker.
 *   That path is where a wireframe overlay would most plausibly reappear, so it is the most
 *   valuable thing to add next.
 */
