// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderComponent } from '@testing-library/react';
import { Group, Scene } from 'three';

const stubs = vi.hoisted(() => ({
  /** One increment per WebGLRenderer.render — the quantity this file is about. */
  renders: 0,
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  // The gallery's turntable runs whether or not a model has arrived, so the load is left pending.
  GLTFLoader: class {
    load() {}
  },
}));

vi.mock('../motion/sceneFoundation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../motion/sceneFoundation')>();
  return {
    ...actual,
    createStudioScene: () => {
      const scene = new Scene();
      const holder = new Group();
      scene.add(holder);
      return { scene, holder, dispose() { scene.remove(holder); } };
    },
  };
});

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      info = { render: { calls: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] };
      setSize() {}
      setPixelRatio() {}
      render() { stubs.renders += 1; }
      dispose() {}
    },
  };
});

import { ModelGallery } from './ModelGallery';

const frames = new Map<number, FrameRequestCallback>();
const intersectionCallbacks: IntersectionObserverCallback[] = [];
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

/** Scroll the canvas in or out of view, which is the case this file exists for. */
function setOnScreen(onScreen: boolean) {
  intersectionCallbacks.forEach((callback) => {
    callback([{ isIntersecting: onScreen } as IntersectionObserverEntry], null as unknown as IntersectionObserver);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // jsdom has no 2d context and says so on stderr for every contact shadow. Returning null is what
  // it means anyway, and createContactShadow already handles it.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  frames.clear();
  intersectionCallbacks.length = 0;
  stubs.renders = 0;
  nextFrameId = 1;
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersectionCallbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('model gallery turntable', () => {
  it('spins continuously while it is on screen', () => {
    const view = renderComponent(<ModelGallery />);

    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(stubs.renders).toBe(3);
    expect(pendingFrames()).toBe(1);

    view.unmount();
  });

  it('stops dead once it scrolls out of view, and picks the spin back up on return', () => {
    const view = renderComponent(<ModelGallery />);
    flushFrames();
    const drawn = stubs.renders;

    // The regression under guard: this loop used to be a bare requestAnimationFrame chain with no
    // viewport test at all, so the turntable kept spinning and redrawing at the full display rate
    // for a canvas nobody had on screen.
    setOnScreen(false);
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(flushFrames()).toBe(0);
    expect(stubs.renders).toBe(drawn);

    setOnScreen(true);
    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(stubs.renders).toBe(drawn + 2);

    view.unmount();
  });

  it('leaves nothing scheduled after unmount', () => {
    const view = renderComponent(<ModelGallery />);
    flushFrames();

    view.unmount();
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(flushFrames()).toBe(0);
  });
});
