import { expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * The evidence rig's geometry at devicePixelRatio 1.5 — the one configuration where it broke.
 *
 * Found on a real machine, not in review: on a 150%-scaled Windows laptop the landing rig
 * rendered a robot ~1.5× too large, head filling the window, clip buttons pushed below the fold.
 * The chain: `renderer.setSize` writes the canvas's width/height ATTRIBUTES as CSS pixels ×
 * pixelRatio; an in-flow canvas with `height: 100%` is circular with the row that sizes it, and a
 * reflow that consults the canvas's natural (attribute) height inflates the row ×pixelRatio — the
 * ResizeObserver then writes a bigger attribute still, locking the blow-up in. At pixel ratio 1
 * the attribute equals the CSS size, so no DPR-1 machine could ever show it.
 *
 * Honesty note, so nobody trusts this gate for more than it does: the triggering reflow could NOT
 * be reproduced in headless Chrome — not by resize storms, clip switches, forced `height: auto`,
 * or DPR emulation — so this spec cannot fail-then-pass across the fix. What actually closes the
 * bug is structural: the canvas is absolutely positioned (`DossierStage.css`), which removes it
 * from intrinsic sizing in every browser at every pixel ratio. This gate pins the healthy
 * equilibrium that surrounds that structure — buffer at CSS × dpr, viewport sized by the panel's
 * row, transport inside the figure — so a regression that manages to lock the geometry again, or
 * a return of the aspect-ratio-era self-sizing, fails loudly at the pixel ratio where it matters.
 */

const landing = surfaces.find((surface) => surface.id === 'landing');
if (!landing) throw new Error('rig-stability: the landing surface is gone from surfaces.ts');

test.describe('evidence rig viewport stability', () => {
  test.use({ deviceScaleFactor: 1.5, viewport: { width: 1280, height: 630 } });

  test('the viewport is sized by the panel row, not by its own buffer, at devicePixelRatio 1.5', async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, landing);
    // The rig chunk is lazy: `.evidence-rig` does not exist until the section is approached, so
    // the first scroll target is the section, which is in the eager bundle.
    await page.locator('#product').scrollIntoViewIfNeeded();
    await page.waitForSelector('.evidence-rig[data-status="ready"]', { timeout: 60_000 });
    await page.locator('.evidence-rig').scrollIntoViewIfNeeded();
    // Settle: fonts, the loading→ready swap, and the resize they cause have all landed by now.
    await page.waitForTimeout(1500);

    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector('.evidence-rig-canvas') as HTMLCanvasElement;
      const panel = document.querySelector('.evidence-rig-panel') as HTMLElement;
      return {
        canvasH: canvas.getBoundingClientRect().height,
        canvasW: canvas.getBoundingClientRect().width,
        panelH: panel.getBoundingClientRect().height,
        attrW: canvas.width,
        attrH: canvas.height,
        dpr: window.devicePixelRatio,
      };
    });

    // The buffer must carry the pixel ratio (sharp rendering)…
    expect(geometry.attrH).toBeGreaterThanOrEqual(Math.floor(geometry.canvasH * geometry.dpr) - 2);
    expect(geometry.attrW).toBeGreaterThanOrEqual(Math.floor(geometry.canvasW * geometry.dpr) - 2);
    // …and must never leak back into layout: the viewport's height is the panel's row, full stop.
    expect(Math.abs(geometry.canvasH - geometry.panelH)).toBeLessThanOrEqual(6);
  });

  test('the transport stays inside the viewport figure', async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, landing);
    await page.locator('#product').scrollIntoViewIfNeeded();
    await page.waitForSelector('.evidence-rig[data-status="ready"]', { timeout: 60_000 });
    await page.locator('.evidence-rig').scrollIntoViewIfNeeded();

    // The clip buttons are the section's only interaction affordance; the blow-up shoved them
    // below the fold, which read as the section having no controls at all.
    const inside = await page.evaluate(() => {
      const figure = document.querySelector('.evidence-rig-viewport')!.getBoundingClientRect();
      const transport = document.querySelector('.evidence-rig-transport')!.getBoundingClientRect();
      return transport.bottom <= figure.bottom + 1 && transport.top >= figure.top - 1;
    });
    expect(inside).toBe(true);
  });
});
