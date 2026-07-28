#!/usr/bin/env node
/**
 * Opens the motion lab in a real, foregrounded browser window and leaves it open.
 *
 * Why this exists: the motion stage suspends its render loop when `document.hidden` is true and
 * when the canvas is outside the viewport. Both hold for a CDP-driven background tab, so every
 * automated screenshot of it comes back empty — correct behaviour, useless evidence. This runs
 * headed so the deviation colouring and root-path direction can actually be looked at.
 *
 *   npm run inspect:motion
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 4178;
const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'],
  { shell: true, stdio: 'ignore' });

const wait = async () => {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

if (!await wait()) {
  console.error('preview server did not start — run `npm run build` first');
  preview.kill();
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
await page.addInitScript(() => {
  try { localStorage.setItem('creatorflow:welcomed', '1'); } catch { /* ignore */ }
});
await page.goto(`http://127.0.0.1:${PORT}/#workspace?view=motion`, { waitUntil: 'networkidle' });
await page.waitForSelector('.motion-compare-stage canvas', { timeout: 30_000 });
await page.locator('.motion-compare-stage').scrollIntoViewIfNeeded();
// Overlay is where the joint deviation channel is drawn; side-by-side does not show it.
await page.getByRole('button', { name: 'Pair overlay' }).click().catch(() => undefined);
await page.waitForTimeout(1200);

console.log(`
  Motion lab open at http://127.0.0.1:${PORT}/#workspace?view=motion

  Worth checking, none of which any automated check covers:
    1. Joint colours in overlay — dark where the clips agree, bright amber where they diverge.
       An identical pair should read as the ramp's dark end, not mid-scale.
    2. Grey joints mean "the candidate clip does not animate this bone", not "maximally
       different". They should be visibly a different thing from the bright end.
    3. Scrub from 0. The pose trail fills in one ghost at a time and draws nothing before 7.5%.
    4. Switch to Root: paths should fade from faint at the start to solid at the end, with a
       hollow marker at the first sample and a filled one at the last.

  Close the window when done.
`);

await page.waitForEvent('close', { timeout: 0 }).catch(() => undefined);
await browser.close();
preview.kill();
