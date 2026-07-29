import { expect, test } from '@playwright/test';
import { APP } from './surfaces';

/**
 * three.js must not reach the landing page until someone scrolls to the rig.
 *
 * `vite.config.ts` states the invariant — "three.js is left alone; it is already code-split into
 * the lazy 3D-viewer chunks and must stay that way" — and `MotionField` was hand-written against
 * WebGL2 with no library specifically to honour it. Until now nothing checked it, which was
 * tolerable while every 3D viewer lived behind the workspace route.
 *
 * The dossier section changed that. The landing page now mounts a real rig, so a single static
 * import in the wrong file would put roughly 620 kB of renderer in front of first paint, and the
 * page would still look and behave correctly in every other test. This is the gate for that.
 *
 * Deliberately not asserted by chunk name: `sceneFoundation-*.js` is a build artefact whose name
 * and composition are rollup's to choose, and a gate that hardcodes it breaks on rechunking
 * rather than on regression.
 */

/**
 * DECODED bytes, not `content-length`.
 *
 * The first draft of this gate read the header and passed vacuously: the preview server serves
 * these chunks compressed, so three arrived as 157 kB against a 450 kB ceiling and the assertion
 * could never have fired. A gate that cannot fail is worse than no gate, because it is read as
 * coverage. `response.body()` is the decoded payload and is what the numbers below refer to.
 *
 * three is ~620 kB decoded; the largest legitimate eager chunk is the app entry at ~390 kB.
 */
const EAGER_CHUNK_CEILING = 450 * 1024;

interface Script { name: string; bytes: number; phase: 'eager' | 'scrolled' }

test('landing does not download the renderer before the rig is reached', async ({ page }) => {
  // Loads the page twice over in effect — once eagerly, then again for the chunk the scroll pulls
  // in — and decodes every script body to measure it. Well past the 30s default on a CI runner.
  test.setTimeout(120_000);
  const pending: Promise<void>[] = [];
  const scripts: Script[] = [];
  let phase: Script['phase'] = 'eager';

  page.on('response', (response) => {
    const url = response.url();
    if (!url.endsWith('.js')) return;
    const at = phase;
    pending.push(
      response.body()
        .then((body) => { scripts.push({ name: url.split('/').pop() ?? url, bytes: body.length, phase: at }); })
        // A body that cannot be read (redirect, aborted) is not evidence either way.
        .catch(() => undefined),
    );
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await Promise.all(pending);

  const eager = scripts.filter((script) => script.phase === 'eager');
  const tooBig = eager.filter((script) => script.bytes > EAGER_CHUNK_CEILING);
  console.log(`  [bundle] landing loaded ${eager.length} scripts, largest `
    + `${Math.round(Math.max(0, ...eager.map((s) => s.bytes)) / 1024)} kB decoded`);

  expect(
    tooBig.map((s) => `${s.name} (${Math.round(s.bytes / 1024)} kB)`),
    'a chunk far larger than the app entry was downloaded before the dossier section was reached. '
    + 'This is what a static import of three — or of a module that pulls it in — looks like.',
  ).toEqual([]);

  /**
   * The other half of the claim.
   *
   * A gate that only proved absence would go green if the rig stopped mounting altogether, which
   * is the most likely way for this section to break.
   */
  phase = 'scrolled';
  await page.locator('#product').scrollIntoViewIfNeeded();
  await page.waitForSelector('.evidence-rig-canvas', { timeout: 20_000 });
  await page.waitForTimeout(2000);
  await Promise.all(pending);

  const scrolled = scripts.filter((script) => script.phase === 'scrolled');
  console.log(`  [bundle] scrolling pulled ${scrolled.length} more scripts, largest `
    + `${Math.round(Math.max(0, ...scrolled.map((s) => s.bytes)) / 1024)} kB decoded`);

  expect(
    scrolled.some((script) => script.bytes > EAGER_CHUNK_CEILING),
    'the renderer chunk never arrived after scrolling to the dossier — either the rig no longer '
    + 'mounts, or three has been folded into a chunk the page already had.',
  ).toBe(true);
});
