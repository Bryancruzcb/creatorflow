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
    prepare: async (page: import('@playwright/test').Page) => {
      const load = page.getByRole('button', { name: /Load 3D model/i }).first();
      if (await load.count()) {
        await load.click();
        await page.waitForTimeout(5000);
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
 * Not covered, stated rather than implied:
 *
 * - StressLab's animation gate. "Open rig and timeline" did not mount a context in this harness
 *   and the reason was not chased; it is a real gap, not a passing surface.
 * - HeavyAssetViewer's comparison modes, including the deviation heatmap. Reaching them needs a
 *   component match selected and a mode switched, and the heatmap additionally runs a worker.
 *   That path is where a wireframe overlay would most plausibly reappear, so it is the most
 *   valuable thing to add next.
 */
