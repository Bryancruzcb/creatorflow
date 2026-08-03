// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvasRenderLoop } from './renderLoop';

/**
 * A hand-driven animation clock, because the property under test is "how many frames were asked
 * for", and a real rAF cannot answer that. Every request lands in `frames` and only runs when a
 * test flushes it, so `flushFrames()` returning 0 is a hard statement that the loop has stopped —
 * not a statement that it was slow.
 *
 * setTimeout is faked as well, since the continuous cadence throttles through a timer and a
 * suspended loop must not be holding one.
 */
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let clock = 0;

function pendingFrames() {
  return frames.size;
}

function flushFrames(step = 16) {
  clock += step;
  const due = [...frames.values()];
  frames.clear();
  due.forEach((callback) => callback(clock));
  return due.length;
}

function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames.clear();
  nextFrameId = 1;
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});

afterEach(() => {
  setPageHidden(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('canvas render loop', () => {
  it('renders once on start and then costs nothing at all', () => {
    const render = vi.fn();
    const loop = createCanvasRenderLoop({ canvas: document.createElement('canvas'), render });

    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(1);
    // The whole point of the scheduler: a static scene holds neither a frame nor a timer.
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(flushFrames()).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);

    loop.dispose();
  });

  it('renders exactly one frame per demand', () => {
    const render = vi.fn();
    const loop = createCanvasRenderLoop({ canvas: document.createElement('canvas'), render });
    flushFrames();

    loop.invalidate();
    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(flushFrames()).toBe(0);

    // Repeated demands between frames coalesce into one frame, so a burst of events cannot
    // multiply into a burst of renders.
    loop.invalidate();
    loop.invalidate();
    loop.invalidate();
    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(3);

    loop.dispose();
  });

  it('keeps a frame in flight for as long as the caller reports continuous work', () => {
    const render = vi.fn();
    let playing = true;
    const loop = createCanvasRenderLoop({
      canvas: document.createElement('canvas'),
      render,
      shouldRenderContinuously: () => playing,
    });

    flushFrames();
    flushFrames();
    flushFrames();
    expect(render).toHaveBeenCalledTimes(3);
    expect(pendingFrames()).toBe(1);

    // Pausing is not enough on its own — the caller has to say the condition changed.
    playing = false;
    loop.sync();
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(flushFrames()).toBe(0);
    expect(render).toHaveBeenCalledTimes(3);

    loop.dispose();
  });

  it('restarts from a standstill when continuous work resumes', () => {
    const render = vi.fn();
    let playing = false;
    const loop = createCanvasRenderLoop({
      canvas: document.createElement('canvas'),
      render,
      shouldRenderContinuously: () => playing,
    });
    flushFrames();
    expect(pendingFrames()).toBe(0);

    playing = true;
    loop.sync();
    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(3);

    loop.dispose();
  });

  it('throttles the continuous cadence through a timer', () => {
    const render = vi.fn();
    const loop = createCanvasRenderLoop({
      canvas: document.createElement('canvas'),
      render,
      shouldRenderContinuously: () => true,
      continuousFrameIntervalMs: () => 100,
    });

    expect(flushFrames()).toBe(1);
    // The next frame waits behind the interval rather than being requested immediately.
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(99);
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(2);

    loop.dispose();
  });

  it('does not make a demand render wait behind the continuous throttle', () => {
    const render = vi.fn();
    const loop = createCanvasRenderLoop({
      canvas: document.createElement('canvas'),
      render,
      shouldRenderContinuously: () => true,
      continuousFrameIntervalMs: () => 1000,
    });
    flushFrames();

    loop.invalidate();
    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(2);

    loop.dispose();
  });

  it('stops entirely while the page is hidden, and resumes with a fresh frame', () => {
    const render = vi.fn();
    const active: boolean[] = [];
    const loop = createCanvasRenderLoop({
      canvas: document.createElement('canvas'),
      render,
      shouldRenderContinuously: () => true,
      onActiveChange: (next) => active.push(next),
    });
    flushFrames();

    setPageHidden(true);
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(flushFrames()).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);

    setPageHidden(false);
    expect(flushFrames()).toBe(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(active).toEqual([false, true]);

    loop.dispose();
  });

  it('cancels everything it owns on dispose', () => {
    const render = vi.fn();
    const loop = createCanvasRenderLoop({
      canvas: document.createElement('canvas'),
      render,
      shouldRenderContinuously: () => true,
    });
    flushFrames();

    loop.dispose();
    expect(pendingFrames()).toBe(0);
    // A demand arriving after teardown must not resurrect the loop.
    loop.invalidate();
    expect(pendingFrames()).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
