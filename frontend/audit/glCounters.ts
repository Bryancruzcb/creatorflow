import type { Page } from '@playwright/test';

/**
 * Counts real GL work from outside the app.
 *
 * Reproduces what `renderer.info.render` reports, without a production change and without asking
 * the app to expose anything. Installed via `addInitScript` so the wrappers exist before any page
 * script runs — that ordering is required for the `getContext` wrapper, not merely tidy.
 *
 * Frames are counted from requestAnimationFrame, NOT from gl.clear. HeavyAssetViewer issues two
 * autoClear'd render() calls inside one rAF — the main scene and the scissored minimap — so a
 * clear-derived count is 2x on every surface that has a minimap, and every per-frame number
 * derived from it would be half the truth.
 */

export interface GlStats {
  contexts: number;
  frames: number;
  drawCalls: number;
  callsPerFrame: number;
  linePrimitives: number;
  trianglePrimitives: number;
  linePrimitivesPerFrame: number;
  trianglePrimitivesPerFrame: number;
  maxLinePrimitivesInOneDraw: number;
}

/** Runs in the page before app code. Keep it self-contained — it is serialised across. */
export function installGlCounters() {
  const w = window as unknown as { __gl?: Record<string, number> };
  const s = { contexts: 0, frames: 0, drawCalls: 0, lines: 0, tris: 0, maxLineDraw: 0 };
  w.__gl = s as unknown as Record<string, number>;

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    const ctx = (origGetContext as (...a: unknown[]) => unknown).apply(this, args);
    if (ctx && /webgl/i.test(String(args[0]))) s.contexts += 1;
    return ctx;
  } as typeof HTMLCanvasElement.prototype.getContext;

  /**
   * Primitive counts by draw mode. LINES is what matters here: a full-mesh wireframe emits three
   * line segments per triangle with no edge dedup, which is how one overlay reached tens of
   * thousands of primitives while every individual draw call stayed small.
   */
  const tally = (mode: number, count: number, gl: WebGLRenderingContext) => {
    s.drawCalls += 1;
    if (mode === gl.LINES) {
      const n = count / 2;
      s.lines += n;
      if (n > s.maxLineDraw) s.maxLineDraw = n;
    } else if (mode === gl.LINE_STRIP || mode === gl.LINE_LOOP) {
      const n = Math.max(0, count - 1);
      s.lines += n;
      if (n > s.maxLineDraw) s.maxLineDraw = n;
    } else if (mode === gl.TRIANGLES) {
      s.tris += count / 3;
    } else if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) {
      s.tris += Math.max(0, count - 2);
    }
  };

  for (const proto of [
    (window as unknown as { WebGL2RenderingContext?: { prototype: WebGLRenderingContext } }).WebGL2RenderingContext?.prototype,
    WebGLRenderingContext.prototype,
  ]) {
    if (!proto) continue;
    const p = proto as unknown as Record<string, (...a: never[]) => unknown>;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = p[name];
      if (typeof orig !== 'function') continue;
      p[name] = function (this: WebGLRenderingContext, ...args: never[]) {
        // drawArrays(mode, first, count) | drawElements(mode, count, type, offset)
        const mode = args[0] as unknown as number;
        const count = (name.startsWith('drawArrays') ? args[2] : args[1]) as unknown as number;
        const instances = name.endsWith('Instanced') ? ((args[name.startsWith('drawArrays') ? 3 : 4] as unknown as number) || 1) : 1;
        if (typeof count === 'number') tally(mode, count * instances, this);
        return orig.apply(this, args);
      };
    }
  }

  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    origRaf((t) => {
      s.frames += 1;
      cb(t);
    });
}

export async function readGlStats(page: Page): Promise<GlStats> {
  return page.evaluate(() => {
    const s = (window as unknown as { __gl?: { contexts: number; frames: number; drawCalls: number; lines: number; tris: number; maxLineDraw: number } }).__gl;
    if (!s) return { contexts: 0, frames: 0, drawCalls: 0, callsPerFrame: 0, linePrimitives: 0, trianglePrimitives: 0, linePrimitivesPerFrame: 0, trianglePrimitivesPerFrame: 0, maxLinePrimitivesInOneDraw: 0 };
    const f = Math.max(1, s.frames);
    return {
      contexts: s.contexts,
      frames: s.frames,
      drawCalls: s.drawCalls,
      callsPerFrame: Math.round(s.drawCalls / f),
      linePrimitives: s.lines,
      trianglePrimitives: s.tris,
      linePrimitivesPerFrame: Math.round(s.lines / f),
      trianglePrimitivesPerFrame: Math.round(s.tris / f),
      maxLinePrimitivesInOneDraw: s.maxLineDraw,
    };
  });
}

/**
 * Wake the viewers.
 *
 * Every viewer here is demand-rendered: it suspends when the canvas is outside the viewport, and
 * some render nothing at all until the camera moves. A headless run that just navigates measures
 * zero and would report a broken viewer as a passing one. Scrolling a canvas into view took the
 * motion stage from 0 frames to hundreds; the drag is needed because HeavyAssetViewer only
 * invalidates on an OrbitControls change while idle.
 */
export async function wakeCanvases(page: Page) {
  await page.waitForSelector('canvas', { timeout: 20_000 }).catch(() => undefined);
  const canvases = page.locator('canvas');
  const n = await canvases.count();
  for (let i = 0; i < n; i += 1) {
    await canvases.nth(i).scrollIntoViewIfNeeded().catch(() => undefined);
  }
  const first = canvases.first();
  if (await first.count()) {
    const box = await first.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55, { steps: 8 });
      await page.mouse.up();
    }
  }
  await page.waitForTimeout(1200);
}
