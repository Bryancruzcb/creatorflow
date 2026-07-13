import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { prefersReducedMotion, watchReducedMotion } from '../motion/preferences';
import { createCanvasRenderLoop, type CanvasRenderLoop } from '../motion/renderLoop';
import type { MotionFixture } from '../stressLabData';

export interface MotionTelemetry {
  decodeMs: number;
  firstRenderMs: number;
  bones: number;
  morphTargets: number;
  triangles: number;
  clips: number;
  drawCalls: number;
  materials: number;
  textures: number;
}

interface AnimatedAssetViewerProps {
  fixture: MotionFixture;
  onTelemetry?: (telemetry: MotionTelemetry) => void;
}

function dispose(group: Group) {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => { if (value instanceof Texture) value.dispose(); });
      material.dispose();
    });
  });
}

export function AnimatedAssetViewer({ fixture, onTelemetry }: AnimatedAssetViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const clipsRef = useRef<AnimationClip[]>([]);
  const actionRef = useRef<AnimationAction | null>(null);
  const renderLoopRef = useRef<CanvasRenderLoop | null>(null);
  const playingRef = useRef(true);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [clipIndex, setClipIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(1);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<MotionTelemetry | null>(null);

  useEffect(() => {
    playingRef.current = playing;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let lastFrame = performance.now();
    let lastUiUpdate = 0;
    const started = performance.now();
    const shouldAutoPlay = !prefersReducedMotion();
    setStatus('loading');
    setClipIndex(0);
    playingRef.current = shouldAutoPlay;
    setPlaying(shouldAutoPlay);
    setTime(0);
    setDuration(1);
    setClipNames([]);
    setMetrics(null);
    const scene = new Scene();
    scene.background = new Color('#171916');
    scene.add(new HemisphereLight('#edf0e8', '#20251f', 2.8));
    const key = new DirectionalLight('#fff0ce', 4.6);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new DirectionalLight('#6f9fc7', 2.2);
    rim.position.set(-5, 2, -4);
    scene.add(rim);
    const holder = new Group();
    scene.add(holder);
    const camera = new PerspectiveCamera(36, 16 / 9, 0.01, 200);
    camera.position.set(2.8, 1.65, 3.7);
    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 1;
    controls.maxDistance = 9;
    controls.target.set(0, 0, 0);

    new GLTFLoader().load(fixture.url, (gltf) => {
      if (disposed) {
        dispose(gltf.scene);
        return;
      }
      const decodeMs = performance.now() - started;
      const box = new Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const scale = 2.5 / Math.max(size.x, size.y, size.z, 0.001);
      gltf.scene.scale.setScalar(scale);
      gltf.scene.position.copy(center).multiplyScalar(-scale);
      holder.add(gltf.scene);
      let bones = 0;
      let morphTargets = 0;
      let triangles = 0;
      const materials = new Set<unknown>();
      const textures = new Set<Texture>();
      gltf.scene.traverse((child) => {
        if (child instanceof Bone) bones += 1;
        if (!(child instanceof Mesh)) return;
        morphTargets = Math.max(morphTargets, child.geometry.morphAttributes.position?.length ?? 0);
        triangles += Math.round((child.geometry.index?.count ?? child.geometry.attributes.position?.count ?? 0) / 3);
        const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
        meshMaterials.forEach((material) => {
          materials.add(material);
          Object.values(material).forEach((value) => { if (value instanceof Texture) textures.add(value); });
        });
      });
      const mixer = new AnimationMixer(gltf.scene);
      mixerRef.current = mixer;
      clipsRef.current = gltf.animations;
      setClipNames(gltf.animations.map((clip, index) => clip.name || `Clip ${index + 1}`));
      const firstClip = gltf.animations[0];
      if (firstClip) {
        const action = mixer.clipAction(firstClip);
        action.play();
        action.paused = !playingRef.current;
        actionRef.current = action;
        setDuration(firstClip.duration || 1);
      }
      renderer.render(scene, camera);
      const telemetry = {
        decodeMs,
        firstRenderMs: performance.now() - started,
        bones,
        morphTargets,
        triangles,
        clips: gltf.animations.length,
        drawCalls: renderer.info.render.calls,
        materials: materials.size,
        textures: textures.size,
      };
      setMetrics(telemetry);
      onTelemetry?.(telemetry);
      setStatus('ready');
      renderLoopRef.current?.invalidate();
      renderLoopRef.current?.sync();
    }, undefined, () => { if (!disposed) setStatus('error'); });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      renderLoopRef.current?.invalidate();
    };
    const render = (now: number) => {
      const elapsed = Math.max(0, (now - lastFrame) / 1000);
      const delta = elapsed > 0.25 ? 0 : Math.min(0.05, elapsed);
      lastFrame = now;
      if (playingRef.current) mixerRef.current?.update(delta);
      controls.update();
      renderer.render(scene, camera);
      if (now - lastUiUpdate > 120 && actionRef.current) {
        lastUiUpdate = now;
        setTime(actionRef.current.time);
      }
    };
    const renderLoop = createCanvasRenderLoop({
      canvas,
      render,
      shouldRenderContinuously: () => playingRef.current && Boolean(actionRef.current),
      onActiveChange: () => { lastFrame = performance.now(); },
    });
    renderLoopRef.current = renderLoop;
    const onControlsChange = () => renderLoop.invalidate();
    controls.addEventListener('change', onControlsChange);
    const stopWatchingReducedMotion = watchReducedMotion((reduced) => {
      if (!reduced || !playingRef.current) return;
      playingRef.current = false;
      if (actionRef.current) actionRef.current.paused = true;
      setPlaying(false);
      renderLoop.invalidate();
      renderLoop.sync();
    });
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    renderLoop.invalidate();
    return () => {
      disposed = true;
      stopWatchingReducedMotion();
      renderLoop.dispose();
      if (renderLoopRef.current === renderLoop) renderLoopRef.current = null;
      observer.disconnect();
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      clipsRef.current = [];
      actionRef.current = null;
      dispose(holder);
      renderer.dispose();
    };
  }, [fixture, onTelemetry]);

  function selectClip(index: number) {
    const mixer = mixerRef.current;
    const clip = clipsRef.current[index];
    if (!mixer || !clip) return;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    action.paused = !playing;
    actionRef.current = action;
    setClipIndex(index);
    setDuration(clip.duration || 1);
    setTime(0);
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }

  function togglePlayback() {
    const next = !playing;
    setPlaying(next);
    if (actionRef.current) actionRef.current.paused = !next;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }

  function scrub(value: number) {
    if (actionRef.current) actionRef.current.time = value;
    setTime(value);
    renderLoopRef.current?.invalidate();
  }

  return (
    <div className="motion-viewer">
      <div className="motion-stage">
        <img src={fixture.previewUrl} alt="" aria-hidden="true" />
        <canvas ref={canvasRef} aria-label={`Interactive animated preview of ${fixture.name}`} />
        {status === 'loading' ? <div className="motion-state"><span />Decoding rig, clips, and morph targets…</div> : null}
        {status === 'error' ? <div className="motion-state motion-state-error">The fixture could not be decoded in this browser.</div> : null}
        {metrics ? <div className="motion-runtime-readout"><span>{metrics.bones} bones</span><span>{metrics.morphTargets} morphs</span><span>{metrics.drawCalls} draw calls</span><span>{metrics.triangles.toLocaleString()} triangles</span></div> : null}
      </div>
      <div className="motion-transport">
        <button type="button" onClick={togglePlayback} disabled={status !== 'ready'} aria-label={playing ? 'Pause animation' : 'Play animation'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button type="button" onClick={() => scrub(0)} disabled={status !== 'ready'} aria-label="Restart animation"><RotateCcw size={14} /></button>
        <label><span>Timeline</span><input type="range" min="0" max={duration} step="0.01" value={Math.min(time, duration)} onChange={(event) => scrub(Number(event.target.value))} disabled={status !== 'ready'} /></label>
        <output>{time.toFixed(1)} / {duration.toFixed(1)}s</output>
      </div>
      <div className="motion-clips" aria-label="Animation clips">
        {clipNames.map((name, index) => <button key={`${name}-${index}`} type="button" className={index === clipIndex ? 'selected' : ''} onClick={() => selectClip(index)}>{name}</button>)}
      </div>
    </div>
  );
}
