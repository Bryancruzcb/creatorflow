/**
 * Records real-UI footage for the explainer, one WebM per scene, plus timings.json
 * with the ms offset where each scene's setup ends and the scripted beat begins
 * (Remotion trims to that offset). Boots the built frontend on vite preview the
 * same way frontend/playwright.config.ts does.
 *
 * Usage: node capture/record.mjs [scene ...]   (no args = all scenes)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, '..', '..', 'frontend');
const OUT = path.resolve(here, '..', 'public', 'captures');
const URL_BASE = 'http://127.0.0.1:4175';
const SIZE = { width: 1920, height: 1080 };

/** Scene lengths from video/src/Explainer.tsx, plus 4s of trim margin each. */
const HOLD = { open: 12, scan: 16, finding: 21, evidence: 22, manifest: 19, close: 12 };

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} -> ${code}`))));
  });
}

/**
 * `spawn(..., { shell: true })` puts a cmd.exe between us and vite, and .kill() only
 * reaches that shell — vite survives and keeps holding port 4175, so the next run
 * loses the --strictPort race against a server we thought we had stopped. Kill the
 * whole tree on Windows, and wait for it, so the finally block really does clean up.
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

/** A visible cursor dot — headless recordings otherwise show hover effects with no pointer. */
const FAKE_CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;' +
      'background:rgba(241,240,234,.9);border:2px solid rgba(17,18,16,.8);pointer-events:none;' +
      'transform:translate(-50%,-50%);transition:transform .08s;top:-40px;left:-40px';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => { dot.style.top = e.clientY + 'px'; dot.style.left = e.clientX + 'px'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'translate(-50%,-50%) scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'translate(-50%,-50%)'; }, true);
  });
`;

/** Shared setup: suppress the first-visit welcome dialog (same fix as frontend e2e). */
async function newRecordingPage(browser) {
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: SIZE },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem('creatorflow:welcomed', '1'); } catch {}
  });
  await page.addInitScript(FAKE_CURSOR);
  return { context, page };
}

/** Runs the sample preflight scan and waits for it to finish. Setup for scan/finding/evidence/manifest/close. */
async function runScan(page) {
  await page.goto(`${URL_BASE}/#sample-preflight`);
  const start = page.getByRole('button', { name: 'Start local scan' }).first();
  await start.waitFor({ state: 'visible' });
  return async () => {
    await start.click();
    await page.locator('[role="progressbar"][aria-label="Simulated preflight walkthrough progress"]').waitFor();
    await page.waitForFunction(() => {
      const bar = document.querySelector('[aria-label="Simulated preflight walkthrough progress"]');
      return bar && bar.getAttribute('aria-valuenow') === '100';
    });
    await page.locator('[aria-label="Creative asset preflight ledger"]').waitFor();
  };
}

const BEATS = {
  /** Landing page at rest. The push-in happens in Remotion, not here. */
  async open(page, mark) {
    await page.goto(`${URL_BASE}/`);
    await page.getByRole('button', { name: 'Open workspace' }).first().waitFor();
    mark();
    await page.mouse.move(960, 540);
    await page.waitForTimeout(HOLD.open * 1000);
  },
};

async function captureScene(browser, name, timings) {
  const { context, page } = await newRecordingPage(browser);
  const t0 = Date.now();
  let beatStartMs = 0;
  const mark = () => { beatStartMs = Date.now() - t0; };
  await BEATS[name](page, mark);
  const recordedMs = Date.now() - t0;
  const video = page.video();
  await context.close();
  const tmp = await video.path();
  renameSync(tmp, path.join(OUT, `${name}.webm`));
  timings[name] = { beatStartMs, recordedMs };
  const beatSeconds = (recordedMs - beatStartMs) / 1000;
  if (beatSeconds < HOLD[name]) throw new Error(`${name}: beat only ${beatSeconds.toFixed(1)}s, needs ${HOLD[name]}s`);
  console.log(`${name}: beat ${beatSeconds.toFixed(1)}s (trim ${beatStartMs}ms)`);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BEATS);
for (const name of wanted) if (!BEATS[name]) throw new Error(`unknown scene: ${name}`);

mkdirSync(OUT, { recursive: true });
console.log('building frontend…');
await run('npm', ['run', 'build'], FRONTEND);
const server = spawn('npm', ['run', 'preview', '--', '--port', '4175', '--strictPort'], { cwd: FRONTEND, shell: true, stdio: 'ignore' });
try {
  await waitForServer(URL_BASE);
  const browser = await chromium.launch();
  const timingsPath = path.join(OUT, 'timings.json');
  const timings = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, 'utf8')) : {};
  for (const name of wanted) await captureScene(browser, name, timings);
  writeFileSync(timingsPath, JSON.stringify(timings, null, 2));
  await browser.close();
} finally {
  await stopServer(server);
}
