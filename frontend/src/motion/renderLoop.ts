export interface CanvasRenderLoop {
  /** Render as soon as the canvas is visible, even when the loop is otherwise idle. */
  invalidate: () => void;
  /** Reconcile the scheduler after a dynamic continuous-render condition changes. */
  sync: () => void;
  dispose: () => void;
  }
interface CanvasRenderLoopOptions {
  canvas: HTMLCanvasElement;
  render: (now: number) => void;
  shouldRenderContinuously?: () => boolean;
  continuousFrameIntervalMs?: () => number;
  onActiveChange?: (active: boolean) => void;
  rootMargin?: string;
}

function isNearViewport(element: Element) {
  const rect = element.getBoundingClientRect();
  const margin = 160;
  return rect.bottom >= -margin
    && rect.right >= -margin
    && rect.top <= window.innerHeight + margin
    && rect.left <= window.innerWidth + margin;
}

/**
 * A visibility-aware, demand-capable frame scheduler for canvas renderers.
 *
 * It completely suspends work for hidden tabs and offscreen canvases. Static
 * scenes render only when invalidated; animated scenes can opt into a throttled
 * continuous cadence without maintaining a permanent requestAnimationFrame loop.
 */
export function createCanvasRenderLoop({
  canvas,
  render,
  shouldRenderContinuously = () => false,
  continuousFrameIntervalMs = () => 0,
  onActiveChange,
  rootMargin = '160px',
}: CanvasRenderLoopOptions): CanvasRenderLoop {
  let disposed = false;
  let frame = 0;
  let timer = 0;
  let invalidated = true;
  let pageVisible = document.visibilityState !== 'hidden';
  let canvasVisible = isNearViewport(canvas);
  let active = pageVisible && canvasVisible;

  const clearScheduledWork = () => {
    if (frame) cancelAnimationFrame(frame);
    if (timer) window.clearTimeout(timer);
    frame = 0;
    timer = 0;
  };

  const schedule = (delay = 0) => {
    if (disposed || !active || frame || timer) return;
    if (delay > 4) {
      timer = window.setTimeout(() => {
        timer = 0;
        schedule();
      }, delay);
      return;
    }
    frame = requestAnimationFrame((now) => {
      frame = 0;
      if (disposed || !active) return;
      const needsFrame = invalidated || shouldRenderContinuously();
      invalidated = false;
      if (needsFrame) render(now);
      if (invalidated) schedule();
      else if (shouldRenderContinuously()) schedule(Math.max(0, continuousFrameIntervalMs()));
    });
  };

  const setActive = (next: boolean) => {
    if (next === active) return;
    active = next;
    clearScheduledWork();
    onActiveChange?.(active);
    if (active) {
      invalidated = true;
      schedule();
    }
  };

  const onDocumentVisibility = () => {
    pageVisible = document.visibilityState !== 'hidden';
    setActive(pageVisible && canvasVisible);
  };

  const intersectionObserver = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(([entry]) => {
      canvasVisible = entry.isIntersecting;
      setActive(pageVisible && canvasVisible);
    }, { rootMargin, threshold: 0.01 });

  intersectionObserver?.observe(canvas);
  document.addEventListener('visibilitychange', onDocumentVisibility);
  schedule();

  return {
    invalidate() {
      if (disposed) return;
      invalidated = true;
      // Demand renders should not wait behind a continuous-loop throttle.
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      schedule();
    },
    sync() {
      if (disposed || !active) return;
      if (invalidated || shouldRenderContinuously()) schedule();
      else clearScheduledWork();
    },
    dispose() {
      disposed = true;
      clearScheduledWork();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', onDocumentVisibility);
    },
  };
}
