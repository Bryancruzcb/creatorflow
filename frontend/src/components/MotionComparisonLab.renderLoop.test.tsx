// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as renderComponent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { AnimationClip, Bone, Group, QuaternionKeyframeTrack, Scene } from 'three';

/**
 * Shared between the module mocks and the tests. Declared through `vi.hoisted` because `vi.mock`
 * factories are hoisted above the imports and would otherwise read these before initialisation.
 */
const stubs = vi.hoisted(() => ({
  /** Every pending GLTFLoader callback, so a test decides when the rig "arrives". */
  loads: [] as Array<(gltf: unknown) => void>,
  /** One increment per WebGLRenderer.render — the quantity this whole file is about. */
  renders: 0,
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(_url: string, onLoad: (gltf: unknown) => void) { stubs.loads.push(onLoad); }
  },
}));

/**
 * The studio helpers drive a real WebGL context (PMREM, tone mapping), which jsdom has none of.
 * Only the scene graph matters here, so it is handed over directly.
 */
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
      setClearColor() {}
      render() { stubs.renders += 1; }
      dispose() {}
    },
  };
});

// Imported after the mocks purely for reading order; vitest hoists every vi.mock above it.
import { MotionStage } from './MotionComparisonLab';

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

/** Run frames until the stage stops asking for them, and report how many it took. */
function settle(limit = 20) {
  let total = 0;
  for (let index = 0; index < limit && pendingFrames() > 0; index += 1) total += flushFrames();
  return total;
}

/**
 * A rig with one animated bone chain. It has to be a real hierarchy with a real clip: the stage
 * binds mixers, clones trail members and rebuilds skeleton line buffers off the loaded scene, and
 * an empty stand-in would skip the exact per-frame work whose cost is the subject here.
 */
function rigGltf() {
  const scene = new Group();
  const hips = new Bone();
  hips.name = 'Hips';
  const spine = new Bone();
  spine.name = 'Spine';
  hips.add(spine);
  scene.add(hips);
  const track = new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068]);
  return { scene, animations: [new AnimationClip('Walk', 1, [track])] };
}

// Stable identities: the stage's setup effect keys on its callbacks, so fresh closures per
// rerender would tear down and rebuild the whole scene instead of exercising the loop.
const onReady = vi.fn();
const onProgress = vi.fn();

// Typed off the component rather than inferred, so an override can widen back to the full union
// ('overlay', 'upper') instead of being pinned to whatever the defaults below happen to say.
type StageProps = ComponentProps<typeof MotionStage>;

const baseProps: StageProps = {
  glbUrl: '/rig.glb',
  sourceName: 'Walk',
  candidateName: 'Walk',
  analysisMode: 'shape',
  previewFocus: 'full',
  previewLayout: 'side',
  showOnion: false,
  previewQuality: 'balanced',
  onReady,
  progress: 0.2,
  playing: false,
  onProgress,
};

/** Mount the stage, deliver the rig, and run every frame the arrival asked for. */
function mountStage(overrides: Partial<StageProps> = {}) {
  const view = renderComponent(<MotionStage {...baseProps} {...overrides} />);
  const deliver = stubs.loads.at(-1);
  if (!deliver) throw new Error('the stage never asked for a rig');
  deliver(rigGltf());
  settle();
  return {
    ...view,
    show: (next: Partial<StageProps> = {}) => view.rerender(<MotionStage {...baseProps} {...overrides} {...next} />),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames.clear();
  stubs.loads.length = 0;
  stubs.renders = 0;
  nextFrameId = 1;
  clock = 0;
  onReady.mockClear();
  onProgress.mockClear();
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
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe() {
      this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('motion stage frame scheduling', () => {
  it('holds no frames at all while paused and untouched', () => {
    const view = mountStage({ playing: false });
    const drawn = stubs.renders;
    expect(drawn).toBeGreaterThan(0);

    // This is the regression under guard. The stage used to fall back to a 90ms setTimeout when
    // paused, so a static pose kept re-skinning four rigs and rebuilding two skeleton buffers at
    // ~11fps for as long as it stayed on screen. Neither a frame nor a timer may be outstanding.
    expect(pendingFrames()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(flushFrames()).toBe(0);
    expect(stubs.renders).toBe(drawn);

    view.unmount();
  });

  it('runs a frame per display tick while playing', () => {
    const view = mountStage({ playing: true });
    const drawn = stubs.renders;

    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(stubs.renders).toBe(drawn + 3);
    expect(pendingFrames()).toBe(1);

    view.unmount();
  });

  it('stops the loop on pause after one settling frame, and restarts it on resume', () => {
    const view = mountStage({ playing: true });
    flushFrames();
    expect(pendingFrames()).toBe(1);

    view.show({ playing: false });
    // Exactly one: the frame that reports the final phase back to the controls. Then nothing.
    expect(settle()).toBe(1);
    // And it really reports the phase the canvas is showing. The 90ms throttle would otherwise
    // strand the readout, the slider and the scrubber behind the pose, with no later frame coming.
    expect(onProgress.mock.calls.at(-1)?.[0]).toBeGreaterThan(baseProps.progress);
    const paused = stubs.renders;
    vi.advanceTimersByTime(10_000);
    expect(flushFrames()).toBe(0);
    expect(stubs.renders).toBe(paused);

    view.show({ playing: true });
    expect(flushFrames()).toBe(1);
    expect(flushFrames()).toBe(1);
    expect(stubs.renders).toBe(paused + 2);

    view.unmount();
  });

  it('draws one frame when the playhead is scrubbed while paused', () => {
    const view = mountStage({ playing: false, progress: 0.2 });
    const drawn = stubs.renders;

    view.show({ progress: 0.6 });
    expect(pendingFrames()).toBe(1);
    expect(settle()).toBe(1);
    expect(stubs.renders).toBe(drawn + 1);
    expect(pendingFrames()).toBe(0);

    view.unmount();
  });

  it('draws one frame when the view changes while paused', () => {
    const view = mountStage({ playing: false });
    const drawn = stubs.renders;

    view.show({ previewLayout: 'overlay' });
    expect(settle()).toBe(1);

    view.show({ previewFocus: 'upper', showOnion: true });
    expect(settle()).toBe(1);

    expect(stubs.renders).toBe(drawn + 2);
    expect(pendingFrames()).toBe(0);

    view.unmount();
  });

  it('draws the rig once it arrives, without leaving a loop running behind it', () => {
    const view = renderComponent(<MotionStage {...baseProps} playing={false} />);
    settle();
    const beforeRig = stubs.renders;

    stubs.loads.at(-1)?.(rigGltf());
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(settle()).toBe(1);
    expect(stubs.renders).toBe(beforeRig + 1);
    expect(pendingFrames()).toBe(0);

    view.unmount();
  });
});
