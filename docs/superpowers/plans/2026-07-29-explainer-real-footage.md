# Explainer Real-Footage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the 78-second explainer so all six scenes show the real frontend, recorded with Playwright and composed in Remotion with the existing captions on top.

**Architecture:** A capture stage (`video/capture/record.mjs`) boots the built frontend on `vite preview`, drives six scripted beats against the bundled fixture data, and records one WebM per scene plus a `timings.json` of per-scene trim offsets. The Remotion project gains a `Footage` primitive (OffthreadVideo + scrim) that scenes place behind their existing text layers; scene files, names, durations, and caption strings do not change.

**Tech Stack:** Playwright (chromium, `recordVideo`), Remotion 4 (`OffthreadVideo`, `staticFile`), Vite preview server, Node 20+ on Windows.

**Spec:** `docs/superpowers/specs/2026-07-29-explainer-real-footage-design.md`

## Global Constraints

- Only `video/` changes (plus this plan file). Frontend is read-only — booted and recorded, never edited.
- Scene structure fixed: Open 8s, Scan 12s, Finding 17s, Evidence 18s, Manifest 15s, Close 8s; 1920×1080 @ 30fps; total 2340 frames.
- Caption/messaging text is preserved verbatim; the four README rules hold (similar ≠ stolen; checked/declared/decided distinct; the open-decision state is shown truthfully; the hedged "Files stay on your machine, fingerprints travel" line).
- Captures land in `video/public/captures/` and are gitignored (spec named `video/assets/`; `public/` is where Remotion's `staticFile` serves from — same gitignore intent).
- Every capture wait is a state wait (`locator.waitFor`, `waitForFunction`); explicit `waitForTimeout` is allowed ONLY for holding a settled shot on screen, never for waiting on a transition.
- Each clip records ≥ 4 seconds longer than its scene so Remotion trims the tail.
- Work on branch `video/real-footage-explainer`; commits follow the repo's plain-sentence style; one PR at the end.

---

### Task 1: Capture harness with the first beat (Open)

**Files:**
- Create: `video/capture/record.mjs`
- Modify: `video/package.json` (devDependency + script)
- Modify: `video/.gitignore` (add `public/captures/`)

**Interfaces:**
- Produces: `node capture/record.mjs [scene...]` → writes `video/public/captures/<scene>.webm` and merges `video/public/captures/timings.json` entries of shape `{ "<scene>": { "beatStartMs": number, "recordedMs": number } }`. Task 2 adds beats to the `BEATS` map; Task 3 consumes the webm files and `timings.json`.

- [ ] **Step 1: Add Playwright and the capture script to video/package.json**

In `video/package.json`, add to `"scripts"`:

```json
"capture": "node capture/record.mjs"
```

and add a `"devDependencies"` entry:

```json
"devDependencies": {
  "playwright": "^1.49.0"
}
```

Run:

```bash
cd video && npm install && npx playwright install chromium
```

Expected: install succeeds, chromium downloads (skip download if already cached).

- [ ] **Step 2: Gitignore the captures directory**

Append to `video/.gitignore`:

```
public/captures/
```

- [ ] **Step 3: Write the harness with the `open` beat**

Create `video/capture/record.mjs`:

```js
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
  server.kill();
}
```

- [ ] **Step 4: Run the open capture and verify it fails or passes loudly**

```bash
cd video && npm run capture -- open
```

Expected: frontend builds, server boots, output line `open: beat 12.0s (trim …ms)`, and both `public/captures/open.webm` and `public/captures/timings.json` exist. If a locator never appears the script must throw, not hang silently past ~60s.

- [ ] **Step 5: Commit**

```bash
git add video/package.json video/package-lock.json video/.gitignore video/capture/record.mjs
git commit -m "Add a Playwright capture harness that records the landing scene"
```

---

### Task 2: The remaining five beats

**Files:**
- Modify: `video/capture/record.mjs` (extend `BEATS`)

**Interfaces:**
- Consumes: `newRecordingPage`, `runScan`, `HOLD`, `mark()` from Task 1 (exact code above).
- Produces: `scan.webm`, `finding.webm`, `evidence.webm`, `manifest.webm`, `close.webm` + their `timings.json` entries.

- [ ] **Step 1: Add the five beats to the `BEATS` map**

Insert after the `open` beat (all locator strings verified against `frontend/src/components/PreflightWorkspace.tsx` and `MatchWorkbench.tsx` as of `1c45c8df`):

```js
  /** The scan starting and completing. The beat begins just before the click. */
  async scan(page, mark) {
    const go = await runScan(page);
    mark();
    await go();
    // Full HOLD after the animation: the explicit waits alone must reach HOLD.scan even if the
    // scan animation is instant, or captureScene's length assert becomes a coin flip.
    await page.waitForTimeout(HOLD.scan * 1000);
  },

  /** A match arrives: open the investigation workbench from a ledger match link. */
  async finding(page, mark) {
    const go = await runScan(page);
    await go();
    const matchLink = page.locator('.match-link').first();
    await matchLink.waitFor();
    mark();
    await matchLink.hover();
    await page.waitForTimeout(900);
    await matchLink.click();
    await page.locator('#match-workbench-title').waitFor(); // "Trace the finding before making the call."
    await page.locator('[aria-label="Matching source records"]').waitFor();
    await page.locator('#difference-register-title').hover(); // "Detected deltas"
    await page.waitForTimeout(HOLD.finding * 1000); // explicit waits alone must reach HOLD.finding
  },

  /** The evidence panel: checked, declared and decided for one selected asset. No clicks on decisions. */
  async evidence(page, mark) {
    const go = await runScan(page);
    await go();
    const flagged = page.locator('.match-link').first();
    await flagged.waitFor();
    const row = page.locator('.asset-select').nth(1);
    mark();
    await row.click();
    await page.locator('.decision-panel .decision-finding').waitFor();
    await page.locator('.decision-panel h3').hover();
    await page.waitForTimeout(2000);
    await page.locator('.decision-finding').hover();
    await page.waitForTimeout(HOLD.evidence * 1000 - 4000);
  },

  /** The release gate: open decisions block, resolving unblocks, the manifest exports. */
  async manifest(page, mark) {
    const go = await runScan(page);
    await go();
    const summary = page.locator('.release-summary');
    await summary.waitFor();
    mark();
    await summary.hover(); // "Release needs a decision · N need review" — the open state, on screen
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Resolve sample exceptions' }).click();
    await page.getByText('Ready to export').waitFor();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Export release manifest' }).first().click();
    await page.waitForTimeout(HOLD.manifest * 1000 - 6000); // 4s + 2s + 13s of explicit waits = HOLD.manifest
  },

  /** The workspace at rest after export. */
  async close(page, mark) {
    const go = await runScan(page);
    await go();
    await page.getByRole('button', { name: 'Resolve sample exceptions' }).click();
    await page.getByText('Ready to export').waitFor();
    mark();
    await page.mouse.move(960, 700);
    await page.waitForTimeout(HOLD.close * 1000);
  },
```

Note on the manifest beat: the drawn video showed the exported file containing `open: 1`; the web sample's gate refuses to export with open decisions, so the truthful equivalent is the on-screen "Release needs a decision" state before resolution — which this beat holds for 4 seconds. If the Manifest scene's caption text asserts something the recording now contradicts, stop and raise it at review rather than adjusting either silently.

`exportManifest` triggers a browser download; no dialog appears in chromium headless, so no handler is needed — but if the beat throws on an unexpected download event, add `page.on('download', () => {})` above the click.

- [ ] **Step 2: Run the full capture**

```bash
cd video && npm run capture
```

Expected: six `<scene>: beat …s` lines, each ≥ its `HOLD` value; `public/captures/` holds six `.webm` files plus `timings.json` with six entries.

- [ ] **Step 3: Spot-check one clip by eye**

Open `video/public/captures/finding.webm` in a media player. It must show: ledger → hover on a match link with the cursor dot visible → workbench opening. If the cursor dot is missing, the init script regressed — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add video/capture/record.mjs
git commit -m "Record all six explainer beats from the running frontend"
```

---

### Task 3: Footage primitive, wired into the Open scene

**Files:**
- Create: `video/src/Footage.tsx`
- Modify: `video/src/primitives.tsx` (transparent Root variant)
- Modify: `video/src/scenes/Open.tsx`
- Modify: `video/tsconfig.json` (only if `resolveJsonModule` is not already on)

**Interfaces:**
- Consumes: `public/captures/<scene>.webm` + `timings.json` from Task 2.
- Produces: `<Footage scene="open" durationInFrames={n} pushIn?: boolean, dim?: number>` — used by every scene in Task 4. `Root` gains an optional `transparent?: boolean` prop.

- [ ] **Step 1: Enable JSON imports if needed**

Check `video/tsconfig.json` for `"resolveJsonModule": true`; add it under `compilerOptions` if absent.

- [ ] **Step 2: Write `video/src/Footage.tsx`**

```tsx
import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { FPS } from './theme';
import { useProgress } from './primitives';
import timings from '../public/captures/timings.json';

type SceneName = keyof typeof timings;

/**
 * A real-UI clip behind a scene's text. Trims to the moment the scripted beat
 * started (timings.json, written by the capture harness), covers the frame, and
 * lays a left-weighted scrim so captions read over arbitrary UI pixels.
 */
export const Footage: React.FC<{
  scene: SceneName;
  durationInFrames: number;
  pushIn?: boolean;
  dim?: number;
}> = ({ scene, durationInFrames, pushIn = false, dim = 0.55 }) => {
  const zoom = 1 + (pushIn ? 0.05 * useProgress(0, durationInFrames) : 0);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <OffthreadVideo
          muted
          src={staticFile(`captures/${scene}.webm`)}
          trimBefore={Math.round((timings[scene].beatStartMs / 1000) * FPS)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `linear-gradient(90deg, rgba(17,18,16,${Math.min(dim + 0.3, 0.95)}) 0%, rgba(17,18,16,${dim}) 45%, rgba(17,18,16,0.12) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 3: Add the transparent Root variant in `video/src/primitives.tsx`**

Change the `Root` component signature and background line to:

```tsx
export const Root: React.FC<{ children: React.ReactNode; opacity?: number; transparent?: boolean }> = ({
  children,
  opacity = 1,
  transparent = false,
}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      background: transparent ? 'transparent' : c.desk,
      /* …rest of the style object unchanged… */
```

(Only the `background` value and the props change; every other style line stays.)

- [ ] **Step 4: Convert `Open.tsx`**

Keep the `Kicker`, `Heading`, and `Sub` elements and their exact text and delays. Delete the drawn file-grid `<div>` and the `{shown} files…` counter block. Wrap in footage:

```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Footage } from '../Footage';
import { Root, Kicker, Heading, Sub, useExit } from '../primitives';
import { sec } from '../theme';

export const Open: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const exit = useExit(durationInFrames);
  return (
    <AbsoluteFill style={{ opacity: exit }}>
      <Footage scene="open" durationInFrames={durationInFrames} pushIn />
      <Root transparent>
        {/* existing Kicker/Heading/Sub JSX, verbatim from the current file */}
      </Root>
    </AbsoluteFill>
  );
};
```

The comment placeholder above is for this plan only — in the real file, paste the current text elements verbatim.

- [ ] **Step 5: Render a still and look at it**

```bash
cd video && npx remotion still src/index.ts Explainer open-check.png --frame=120
```

Expected: `open-check.png` shows the real landing page behind the "Before you publish" text, scrim keeping it readable. Delete the png after checking; do not commit it.

- [ ] **Step 6: Commit**

```bash
git add video/src/Footage.tsx video/src/primitives.tsx video/src/scenes/Open.tsx video/tsconfig.json
git commit -m "Put real landing footage behind the opening scene"
```

---

### Task 4: Convert the remaining five scenes

**Files:**
- Modify: `video/src/scenes/Scan.tsx`, `Finding.tsx`, `Evidence.tsx`, `Manifest.tsx`, `Close.tsx`

**Interfaces:**
- Consumes: `<Footage>` and `Root transparent` exactly as defined in Task 3.

- [ ] **Step 1: Convert each scene with the same pattern as Open**

For each file: keep every `Kicker`/`Heading`/`Sub`/text element and its delays verbatim; delete the drawn visual blocks listed below; wrap in `<AbsoluteFill style={{ opacity: exit }}>` + `<Footage scene="…" durationInFrames={durationInFrames} />` + `<Root transparent>`.

| Scene | Delete (the drawn content) | Keep (the claim) |
|---|---|---|
| Scan | The `Panel label="Scanning project"` file list | Heading + the "Files stay on your machine, fingerprints travel" line |
| Finding | The SVG curve comparison | Heading + closing "Similar is not stolen." at full contrast |
| Evidence | The linked-rows panel visuals | Heading + the checked/declared/human row *text* if it lives outside the panel; if the rows are the only carrier of checked/declared/decided wording, keep the rows as a slim caption list (text only, no drawn panel chrome) so the distinction stays on screen |
| Manifest | The drawn manifest file panel | Heading + artefact caption; per the Task 2 note, raise at review if any kept caption contradicts the recording |
| Close | The drawn end composition | End text |

- [ ] **Step 2: Render one still per scene and look at all five**

```bash
cd video && for f in 300 700 1300 1800 2250; do npx remotion still src/index.ts Explainer check-$f.png --frame=$f; done
```

Expected: each png shows real UI footage behind the scene's caption; every messaging line above is present and readable. Delete the pngs after checking.

- [ ] **Step 3: Commit**

```bash
git add video/src/scenes
git commit -m "Show the real product in every scene instead of drawn slides"
```

---

### Task 5: Full render, verification, docs, PR

**Files:**
- Modify: `video/README.md`

- [ ] **Step 1: Render both artefacts**

```bash
cd video && npm run render && npm run render:gif
```

Expected: both commands exit 0.

- [ ] **Step 2: Verify the built artefact, not the source**

```bash
cd video && ffprobe -v error -show_entries format=duration -of csv=p=0 out/creatorflow-explainer.mp4
```

Expected duration: `78.0` ±0.1s. If `ffprobe` is unavailable, open the file's Properties → Details in Explorer and confirm 1:18. Then watch the mp4 start to finish once — captions readable over footage in all six scenes, "Similar is not stolen" lands at full contrast, the "Release needs a decision" state is visible in the Manifest scene.

- [ ] **Step 3: Update `video/README.md`**

Replace the build commands block with:

```sh
npm install
npx playwright install chromium
npm run capture    # records real UI footage -> public/captures/ (needs frontend deps installed)
npm run studio     # live editor at localhost:3000
npm run render     # -> out/creatorflow-explainer.mp4
npm run render:gif
```

Add one sentence under the script table: "Every scene plays real recorded UI behind its captions; `npm run capture` regenerates the footage from the running frontend, and a capture that fails means the product flow it films has drifted."

- [ ] **Step 4: Commit and open the PR**

```bash
git add video/README.md
git commit -m "Document the capture step in the video README"
git push -u origin video/real-footage-explainer
gh pr create --title "Rebuild the explainer on real UI footage" --body "$(cat <<'EOF'
The explainer's six scenes now play Playwright-recorded footage of the actual frontend (sample preflight flow) behind the existing captions, replacing the hand-drawn slide content. Script, durations, and all four messaging rules are unchanged; capture is deterministic (state waits, fixture data) and a broken product flow breaks the capture loudly instead of recording the wrong thing.

Spec: docs/superpowers/specs/2026-07-29-explainer-real-footage-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `main`.
