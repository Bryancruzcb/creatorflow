/**
 * Captures the two current-UI screenshots the root README shows, by driving the sample
 * preflight workspace in a production build the same way a visitor would:
 *
 *   docs/screenshots/preflight-blocked.png   the release gate refusing, before any decision
 *   docs/screenshots/preflight-evidence.png  the match investigation, both real GLBs rendered
 *
 * Needs the frontend dependencies installed, `npx playwright install chromium`, and the five
 * gitignored Khronos `*-source.glb` files in public/assets/ plus `npm run assets:derive` — see
 * public/assets/ASSET-PROVENANCE.md. Without the models the comparison viewer falls back to a
 * still image, so the evidence capture fails rather than pass that off as a 3D comparison.
 *
 * Usage: node frontend/scripts/capture-readme-shots.mjs
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..');
const OUT = path.resolve(FRONTEND, '..', 'docs', 'screenshots');
// 4175 belongs to video/capture/record.mjs; a second fixed port lets both scripts coexist.
const PORT = 4176;
const URL_BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1600, height: 1000 };

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} -> ${code}`))));
  });
}

/**
 * `spawn(..., { shell: true })` puts a cmd.exe between us and vite, and .kill() only reaches
 * that shell — vite survives and keeps holding the port, so the next run loses the
 * --strictPort race against a server we thought we had stopped. Kill the whole tree on
 * Windows, and wait for it, so the finally block really does clean up.
 */
function stopServer(child) {
  if (process.platform !== 'win32' || child.pid === undefined) {
    child.kill();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      .on('exit', resolve)
      .on('error', resolve);
  });
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url); if (res.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`frontend never came up at ${url}`);
}

/**
 * Both panels are taller than the viewport, and the site header is sticky, so an element
 * screenshot scrolls the panel under the header and photographs the nav bar sitting on top of
 * it. Scrolling the panel to just below the header first, and then clipping the full-page
 * capture to the panel's own box, leaves the header outside the frame — and keeps the WebGL
 * canvas on screen, which the comparison viewer's render loop requires to keep drawing.
 */
async function shootPanel(page, selector, file) {
  const header = await page.locator('.site-header').boundingBox();
  const clearance = header?.height ?? 0;
  const { clip, stickyBottom } = await page.evaluate(({ selector, clearance }) => {
    const el = document.querySelector(selector);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - clearance, behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    return {
      clip: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
      stickyBottom: window.scrollY + clearance,
    };
  }, { selector, clearance });
  // Subpixel layout leaves the panel a fraction of a pixel high; anything more than that is the
  // page having run out of scroll, which would put the nav bar inside the frame.
  const intrusion = stickyBottom - clip.y;
  if (intrusion > 1) throw new Error(`${selector} stops ${intrusion.toFixed(1)}px short of clearing the sticky header`);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, clip });
  console.log(`${file}: ${Math.round(clip.width)}x${Math.round(clip.height)} css px`);
}

/** A fresh workspace per shot: the sample scan only offers "Start local scan" from its idle state. */
async function newWorkspacePage(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('creatorflow:welcomed', '1'); } catch {}
  });
  return { context, page };
}

/** Runs the sample preflight scan and waits for it to finish. */
async function runScan(page) {
  await page.goto(`${URL_BASE}/#sample-preflight`);
  const start = page.getByRole('button', { name: 'Start local scan' }).first();
  await start.waitFor({ state: 'visible' });
  await start.click();
  await page.locator('[role="progressbar"][aria-label="Simulated preflight walkthrough progress"]').waitFor();
  await page.waitForFunction(() => {
    const bar = document.querySelector('[aria-label="Simulated preflight walkthrough progress"]');
    return bar && bar.getAttribute('aria-valuenow') === '100';
  });
  await page.locator('[aria-label="Creative asset preflight ledger"]').waitFor();
}

/** The workspace with the scan finished and nothing decided yet: the gate is shut. */
async function captureBlocked(page) {
  await runScan(page);
  // The results pane fades in; capturing mid-fade would ship a washed-out frame.
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.preflight-layout')).opacity === '1');
  const summary = page.locator('.release-summary');
  await summary.getByText('Release needs a decision').waitFor();
  const counts = (await summary.innerText()).replace(/\n/g, ' · ');
  console.log(`release bar reads: ${counts}`);
  await shootPanel(page, '.preflight-app', 'preflight-blocked.png');
}

/** The investigation opened from a ledger finding, with both GLBs loaded and side by side. */
async function captureEvidence(page) {
  await runScan(page);
  const finding = page.locator('.match-link').first();
  await finding.waitFor();
  await finding.click();
  await page.locator('#match-workbench-title').waitFor();
  await page.locator('[aria-label="Matching source records"]').waitFor();
  // The viewer reports 'ready' only once both GLBs have parsed; the hint is that state on screen.
  await page.locator('.glb-comparison .model-hint').waitFor({ timeout: 120_000 });
  if (await page.locator('.model-fallback').count() > 0) {
    throw new Error('the comparison viewer is showing its still-image fallback — provision the source GLBs and run `npm run assets:derive`');
  }
  await page.waitForTimeout(1200); // hold one settled frame of the idle turn
  await shootPanel(page, '.match-workbench', 'preflight-evidence.png');
}

mkdirSync(OUT, { recursive: true });
console.log('building frontend…');
await run('npm', ['run', 'build'], FRONTEND);
const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], { cwd: FRONTEND, shell: true, stdio: 'ignore' });
try {
  await waitForServer(URL_BASE);
  const browser = await chromium.launch();
  for (const capture of [captureBlocked, captureEvidence]) {
    const { context, page } = await newWorkspacePage(browser);
    await capture(page);
    await context.close();
  }
  await browser.close();
} finally {
  await stopServer(server);
}
