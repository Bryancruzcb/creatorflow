import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { watchReducedMotion } from '../motion/preferences';
import { createCanvasRenderLoop, type CanvasRenderLoop } from '../motion/renderLoop';

interface GlbComparisonViewerProps {
  split: number;
  mode: 'side' | 'wipe' | 'blink';
  projectUrl: string;
  sourceUrl: string;
  projectLabel: string;
  sourceLabel: string;
  fallbackUrl?: string;
  initialRotation?: number;
}

function makeScene() {
  const scene = new Scene();
  scene.background = new Color('#1a1b18');
  scene.add(new HemisphereLight('#ebe9df', '#252821', 2.8));
  const key = new DirectionalLight('#fff4d9', 4.1);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight('#81a7c8', 2.2);
  rim.position.set(-4, 1, -3);
  scene.add(rim);
  const group = new Group();
  scene.add(group);
  return { scene, group };
}

function normalizeModel(model: Group, holder: Group) {
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const scale = 1.65 / Math.max(size.x, size.y, size.z, 0.001);
  model.scale.setScalar(scale);
  model.position.copy(center).multiplyScalar(-scale);
  holder.add(model);
}

function disposeModel(group: Group) {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      material.dispose();
    });
  });
}

export function GlbComparisonViewer({ split, mode, projectUrl, sourceUrl, projectLabel, sourceLabel, fallbackUrl, initialRotation = -0.42 }: GlbComparisonViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const splitRef = useRef(split);
  const modeRef = useRef(mode);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const renderLoopRef = useRef<CanvasRenderLoop | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    splitRef.current = split;
    renderLoopRef.current?.invalidate();
  }, [split]);

  useEffect(() => {
    modeRef.current = mode;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setState('loading');
    let disposed = false;
    let ready = false;
    let dragging = false;
    let lastX = 0;
    let rotation = initialRotation;
    let lastRenderedAt = performance.now();
    let previousPhase = '';
    let reduceMotion = false;
    const project = makeScene();
    const source = makeScene();
    const camera = new PerspectiveCamera(34, 16 / 9, 0.01, 100);
    camera.position.set(0, 0.05, 3.6);
    camera.lookAt(0, 0, 0);
    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setScissorTest(true);

    const loader = new GLTFLoader();
    Promise.all([loader.loadAsync(projectUrl), loader.loadAsync(sourceUrl)])
      .then(([projectGltf, sourceGltf]) => {
        if (disposed) {
          disposeModel(projectGltf.scene);
          disposeModel(sourceGltf.scene);
          return;
        }
        normalizeModel(projectGltf.scene, project.group);
        normalizeModel(sourceGltf.scene, source.group);
        ready = true;
        setState('ready');
        renderLoopRef.current?.invalidate();
        renderLoopRef.current?.sync();
      })
      .catch(() => {
        if (!disposed) setState('error');
      });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderLoopRef.current?.invalidate();
    };

    const render = (now: number) => {
      if (disposed) return;
      const deltaSeconds = Math.min(0.05, Math.max(0, now - lastRenderedAt) / 1000);
      lastRenderedAt = now;
      if (!reduceMotion && !dragging && modeRef.current !== 'blink') rotation += deltaSeconds * 0.108;
      project.group.rotation.set(-0.12, rotation, 0.02);
      source.group.rotation.set(-0.12, rotation, 0.02);

      // WebGLRenderer applies devicePixelRatio internally to viewport/scissor
      // coordinates. clientWidth/clientHeight are intentionally used here;
      // canvas.width/canvas.height would apply the Retina scale a second time
      // and push a centered model toward the right edge.
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const projectWidth = Math.round(width * splitRef.current / 100);
      camera.aspect = width / height;
      camera.position.z = 3.6;
      camera.updateProjectionMatrix();

      if (modeRef.current === 'blink') {
        const showingProject = reduceMotion || Math.floor(performance.now() / 950) % 2 === 0;
        const phase = showingProject ? 'Project asset' : 'Source record';
        if (phase !== previousPhase && phaseRef.current) {
          phaseRef.current.textContent = phase;
          phaseRef.current.dataset.phase = showingProject ? 'project' : 'source';
          previousPhase = phase;
        }
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, width, height);
        renderer.render(showingProject ? project.scene : source.scene, camera);
        return;
      }

      if (modeRef.current === 'side') {
        const halfWidth = Math.max(1, Math.floor(width / 2));
        const rightWidth = Math.max(1, width - halfWidth);
        camera.aspect = halfWidth / height;
        camera.position.z = 3.75;
        camera.updateProjectionMatrix();
        renderer.setViewport(0, 0, halfWidth, height);
        renderer.setScissor(0, 0, halfWidth, height);
        renderer.render(project.scene, camera);
        renderer.setViewport(halfWidth, 0, rightWidth, height);
        renderer.setScissor(halfWidth, 0, rightWidth, height);
        renderer.render(source.scene, camera);
        return;
      }

      // Both assets always render through the same full-size viewport and camera.
      // Only the scissor changes, so moving the divider never reframes or enlarges
      // either model and the geometry remains registered pixel-for-pixel.
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, projectWidth, height);
      renderer.render(project.scene, camera);

      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(projectWidth, 0, width - projectWidth, height);
      renderer.render(source.scene, camera);
    };

    const renderLoop = createCanvasRenderLoop({
      canvas,
      render,
      shouldRenderContinuously: () => ready && !reduceMotion && !dragging,
      // One frame of timer delay plus the next display frame yields ~30 fps for
      // the subtle idle turn; blink only needs to check its phase a few times/s.
      continuousFrameIntervalMs: () => modeRef.current === 'blink' ? 100 : 1000 / 60,
      onActiveChange: () => { lastRenderedAt = performance.now(); },
    });
    renderLoopRef.current = renderLoop;
    const stopWatchingReducedMotion = watchReducedMotion((reduced) => {
      reduceMotion = reduced;
      renderLoop.invalidate();
      renderLoop.sync();
    });

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
      renderLoop.sync();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      rotation += (event.clientX - lastX) * 0.012;
      lastX = event.clientX;
      renderLoop.invalidate();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.classList.remove('is-dragging');
      renderLoop.invalidate();
      renderLoop.sync();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    resize();
    renderLoop.invalidate();

    return () => {
      disposed = true;
      stopWatchingReducedMotion();
      renderLoop.dispose();
      if (renderLoopRef.current === renderLoop) renderLoopRef.current = null;
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      disposeModel(project.group);
      disposeModel(source.group);
      renderer.dispose();
    };
  }, [initialRotation, projectUrl, sourceUrl]);

  return (
    <div className="glb-comparison" aria-label={`Interactive 3D comparison of ${projectLabel} and ${sourceLabel}`}>
      <canvas ref={canvasRef} />
      {state === 'loading' ? <div className="model-state"><span />Loading real GLB assets…</div> : null}
      {state === 'error' ? (
        <div className="model-fallback">
          <img src={fallbackUrl ?? '/assets/avocado-source.jpg'} alt={`${sourceLabel} source preview`} />
          <span>WebGL preview unavailable. The licensed GLB files remain attached to this record.</span>
        </div>
      ) : null}
      {state === 'ready' ? <span className="model-hint">Locked camera · drag to rotate both</span> : null}
      {state === 'ready' && mode === 'blink' ? <span ref={phaseRef} className="model-phase" data-phase="project">Project asset</span> : null}
    </div>
  );
}
