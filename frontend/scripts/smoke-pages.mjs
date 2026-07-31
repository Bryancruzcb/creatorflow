/**
 * Smoke-tests the built bundle the way GitHub Pages will serve it.
 *
 * Grades whatever `dist/` already holds — it never builds — so in CI it runs between the build
 * and the artifact upload and checks the exact bytes that ship. It previews at the same
 * VITE_BASE_PATH the build used and drives the sample project to the match workbench, which is
 * the one view that fails quietly: if the Khronos GLBs are missing from the deploy, the page
 * still renders, the viewer just swaps in its "WebGL preview unavailable" still image.
 *
 * Usage: npm run smoke:pages   (after `npm run build`, with the same VITE_BASE_PATH)
 */
// From @playwright/test, not `playwright` — the latter is only a transitive install here.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4176; // 4175 belongs to the e2e suite; keep them able to run at once
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = process.env.VITE_BASE_PATH ?? '/';
const SITE = `${ORIGIN}${BASE}`;

if (!existsSync(path.join(FRONTEND, 'dist', 'index.html'))) {
  throw new Error('dist/index.html is missing — run `npm run build` first; this script only grades an existing build.');
}

/**
 * `shell: true` puts a cmd.exe between us and vite on Windows, and .kill() only reaches that
 * shell — vite survives holding the port and the next run loses the --strictPort race. Same
 * tree-kill the capture harness needed.
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
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`preview server never came up at ${url}`);
}

// One command string rather than an args array: with `shell: true` the array form is
// deprecated (DEP0190) and only adds warning noise to the CI log.
const server = spawn(`npm run preview -- --port ${PORT} --strictPort`, {
  cwd: FRONTEND,
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: BASE },
});

const failures = [];
let browser;
try {
  await waitForServer(SITE);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(90_000);
  await page.addInitScript(() => {
    try { localStorage.setItem('creatorflow:welcomed', '1'); } catch {}
  });

  // Any 404 here is the base-path trap vite.config.ts describes: the page renders, its runtime
  // fetches do not. Worth failing on whatever 404s, not only on the models.
  const models = new Map();
  page.on('response', (response) => {
    const url = response.url();
    if (url.endsWith('.glb')) models.set(url, response.status());
    if (response.status() >= 400) failures.push(`${response.status()} ${url}`);
  });

  await page.goto(`${SITE}#sample-preflight`);
  const start = page.getByRole('button', { name: 'Start local scan' }).first();
  await start.waitFor({ state: 'visible' });
  await start.click();
  await page.waitForFunction(() => document
    .querySelector('[aria-label="Simulated preflight walkthrough progress"]')
    ?.getAttribute('aria-valuenow') === '100');
  await page.locator('[aria-label="Creative asset preflight ledger"]').waitFor();

  await page.locator('.match-link').first().click();
  await page.locator('#match-workbench-title').waitFor();

  // Wait on either outcome rather than only the good one, so a fallback reports itself
  // immediately instead of arriving as a timeout on the ready state.
  await page.locator('.glb-comparison .model-hint, .glb-comparison .model-fallback').first().waitFor();
  if (await page.locator('.glb-comparison .model-fallback').count() > 0) {
    failures.push('the match workbench served its still-image fallback instead of the 3D comparison');
  }
  if (await page.locator('.glb-comparison .model-hint').count() === 0) {
    failures.push('the 3D comparison never reached its ready state');
  }

  const served = [...models.entries()];
  if (served.length < 2) {
    failures.push(`expected the workbench to request two GLBs, saw ${served.length}: ${served.map(([url]) => url).join(', ')}`);
  }
  for (const [url, status] of served) {
    if (status !== 200) failures.push(`${status} for ${url}`);
    if (!url.startsWith(SITE)) failures.push(`${url} was not requested under ${SITE}`);
  }
  console.log(`GLBs served: ${served.map(([url, status]) => `${status} ${url.slice(SITE.length)}`).join(', ')}`);
} finally {
  if (browser) await browser.close();
  await stopServer(server);
}

if (failures.length > 0) {
  console.error(`Pages smoke failed at ${SITE}:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Pages smoke passed at ${SITE}: real 3D comparison rendered from the deployed GLBs.`);
