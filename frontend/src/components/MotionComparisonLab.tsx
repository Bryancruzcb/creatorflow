import { AlertTriangle, Check, ChevronDown, Clock3, Fingerprint, FolderTree, GitCompare, Pause, Play, RotateCcw, ScanSearch } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ACESFilmicToneMapping,
  AnimationClip,
  AnimationMixer,
  Bone,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  LoopOnce,
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
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LocalBridgeClient, type LocalMotionComparison, type LocalPluginPairing, type LocalProjectSummary } from '../bridge/localBridge';
import { AnimationSnapshotsPanel } from './AnimationSnapshotsPanel';
import { MotionScenarioPicker } from './MotionScenarioPicker';
import { motionScenarios } from '../motion/motionScenarios';
import {
  analyzeMotionClips,
  type MotionAnalysisMode,
  type MotionAnalysisOptions,
  type MotionAnalysisResult,
  type MotionJointScope,
  type RootPathClipResult,
  trackMatchesJointScope,
} from '../motion/motionAnalysis';
import { useWorkspacePreferences } from '../preferences/workspacePreferences';
import { MetadataInspector } from './MetadataInspector';
import { RobloxProjectExample } from './RobloxProjectExample';
import './MotionComparisonLab.premium.css';

type MotionCategory = 'Locomotion' | 'States' | 'Actions' | 'Gestures';
type PreviewLayout = 'side' | 'overlay';

interface MotionClipOption {
  name: string;
  category: MotionCategory;
  description: string;
}

const clipCatalog: MotionClipOption[] = [
  { name: 'Idle', category: 'Locomotion', description: 'Looping neutral motion' },
  { name: 'Walking', category: 'Locomotion', description: 'Reference walk cycle' },
  { name: 'Running', category: 'Locomotion', description: 'Faster locomotion cycle' },
  { name: 'WalkJump', category: 'Locomotion', description: 'Walk-to-jump transition' },
  { name: 'Jump', category: 'Locomotion', description: 'Authored jump action' },
  { name: 'Sitting', category: 'States', description: 'Sitting pose transition' },
  { name: 'Standing', category: 'States', description: 'Standing pose transition' },
  { name: 'Death', category: 'States', description: 'Fall and rest state' },
  { name: 'Dance', category: 'Actions', description: 'Full-body dance action' },
  { name: 'Punch', category: 'Actions', description: 'Upper-body strike' },
  { name: 'Wave', category: 'Gestures', description: 'One-arm greeting' },
  { name: 'Yes', category: 'Gestures', description: 'Affirmative head motion' },
  { name: 'No', category: 'Gestures', description: 'Negative head motion' },
  { name: 'ThumbsUp', category: 'Gestures', description: 'Positive hand gesture' },
];

const analysisModes: Array<{ id: MotionAnalysisMode; label: string; detail: string }> = [
  { id: 'shape', label: 'Motion shape', detail: 'Normalize each duration to compare the sequence of poses independently of playback speed.' },
  { id: 'timing', label: 'Timing drift', detail: 'Put both clips on the same authored clock to reveal when poses stop lining up.' },
  { id: 'loop', label: 'Loop seam', detail: 'Compare endpoint pose closure and incoming/outgoing joint velocity to find a visible loop pop.' },
  { id: 'root', label: 'Root path', detail: 'Align available root or body-translation paths, then compare travel and drift.' },
];

const jointScopes: Array<{ id: MotionJointScope; label: string }> = [
  { id: 'full', label: 'Full body' },
  { id: 'upper', label: 'Upper' },
  { id: 'lower', label: 'Lower' },
  { id: 'root', label: 'Root' },
];

export function compareClips(source: AnimationClip, candidate: AnimationClip, options?: MotionAnalysisOptions): MotionAnalysisResult {
  return analyzeMotionClips(source, candidate, options);
}

export function trailProgress(mode: MotionAnalysisMode, progress: number) {
  return mode === 'loop' ? 0 : Math.max(0, progress - 0.075);
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

function tintClone(group: Group, tint: Color, amount: number) {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const clones = materials.map((material) => {
      const next = material.clone();
      if ('color' in next && next.color instanceof Color) next.color.lerp(tint, amount);
      if ('emissive' in next && next.emissive instanceof Color) {
        next.emissive.copy(tint);
        next.emissiveIntensity = Math.max(next.emissiveIntensity ?? 0, amount * 0.45);
      }
      return next;
    });
    child.material = Array.isArray(child.material) ? clones : clones[0];
  });
}

function makeOnionSkin(group: Group, tint: Color) {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const ghosts = materials.map((material) => {
      const next = material.clone();
      next.transparent = true;
      next.opacity = 0.34;
      next.depthTest = false;
      next.depthWrite = false;
      if ('wireframe' in next) next.wireframe = true;
      if ('color' in next && next.color instanceof Color) next.color.copy(tint);
      if ('emissive' in next && next.emissive instanceof Color) {
        next.emissive.copy(tint);
        next.emissiveIntensity = 0.72;
      }
      return next;
    });
    child.material = Array.isArray(child.material) ? ghosts : ghosts[0];
    child.renderOrder = 5;
  });
}

interface ScopeSkeleton {
  line: LineSegments<BufferGeometry, LineBasicMaterial>;
  position: Float32BufferAttribute;
  segments: Array<{ child: Bone; parent: Bone }>;
  start: Vector3;
  end: Vector3;
}

function makeScopeSkeleton(model: Group, tint: Color): ScopeSkeleton {
  const segments: ScopeSkeleton['segments'] = [];
  model.traverse((child) => {
    if (child instanceof Bone && child.parent instanceof Bone) segments.push({ child, parent: child.parent });
  });
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(new Float32Array(Math.max(6, segments.length * 6)), 3);
  position.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setDrawRange(0, 0);
  const material = new LineBasicMaterial({ color: tint, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
  const line = new LineSegments(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 6;
  return { line, position, segments, start: new Vector3(), end: new Vector3() };
}

function updateScopeSkeleton(skeleton: ScopeSkeleton, scope: MotionJointScope) {
  const values = skeleton.position.array as Float32Array;
  let offset = 0;
  for (const segment of skeleton.segments) {
    if (!trackMatchesJointScope(segment.child.name, scope)) continue;
    segment.parent.getWorldPosition(skeleton.start);
    segment.child.getWorldPosition(skeleton.end);
    values[offset] = skeleton.start.x;
    values[offset + 1] = skeleton.start.y;
    values[offset + 2] = skeleton.start.z;
    values[offset + 3] = skeleton.end.x;
    values[offset + 4] = skeleton.end.y;
    values[offset + 5] = skeleton.end.z;
    offset += 6;
  }
  skeleton.position.needsUpdate = true;
  skeleton.line.geometry.setDrawRange(0, offset / 3);
  skeleton.line.material.opacity = scope === 'full' ? 0.34 : 0.92;
}

function setGroupOpacity(group: Group, opacity: number) {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 1;
    }
  });
}

function MotionStage({ sourceName, candidateName, analysisMode, previewFocus, previewLayout, showOnion, previewQuality, onReady, progress, playing, onProgress }: {
  sourceName: string;
  candidateName: string;
  analysisMode: MotionAnalysisMode;
  previewFocus: MotionJointScope;
  previewLayout: PreviewLayout;
  showOnion: boolean;
  previewQuality: 'battery' | 'balanced' | 'sharp';
  onReady: (clips: AnimationClip[]) => void;
  progress: number;
  playing: boolean;
  onProgress: (progress: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(progress);
  const playingRef = useRef(playing);
  const selectionRef = useRef({ sourceName, candidateName, analysisMode, previewFocus, previewLayout, showOnion, previewQuality });
  const mixersRef = useRef<{
    source: AnimationMixer;
    candidate: AnimationMixer;
    sourceGhost: AnimationMixer;
    candidateGhost: AnimationMixer;
    sourceModel: Group;
    candidateModel: Group;
    sourceModelGhost: Group;
    candidateModelGhost: Group;
    baseX: number;
    sourceClip: AnimationClip;
    candidateClip: AnimationClip;
    selectionKey: string;
    previewLayout: PreviewLayout;
    previewQuality: 'battery' | 'balanced' | 'sharp';
    sourceScope: ScopeSkeleton;
    candidateScope: ScopeSkeleton;
  } | null>(null);
  const gltfAnimationsRef = useRef<AnimationClip[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => {
    selectionRef.current = { sourceName, candidateName, analysisMode, previewFocus, previewLayout, showOnion, previewQuality };
  }, [analysisMode, candidateName, previewFocus, previewLayout, previewQuality, showOnion, sourceName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stopped = false;
    let frame = 0;
    let inViewport = true;
    let pageVisible = !document.hidden;
    let last = performance.now();
    let lastUi = 0;
    setStatus('loading');
    const scene = new Scene();
    scene.background = new Color('#151713');
    scene.add(new HemisphereLight('#e9eee5', '#20231f', 3));
    const key = new DirectionalLight('#ffe6bb', 4.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new DirectionalLight('#7ba8ca', 2.5);
    rim.position.set(-5, 3, -4);
    scene.add(rim);
    const holder = new Group();
    scene.add(holder);
    const camera = new PerspectiveCamera(34, 16 / 8, 0.01, 100);
    camera.position.set(0, 0.3, 6.1);
    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const qualityCap = (quality: 'battery' | 'balanced' | 'sharp') => quality === 'battery' ? 1 : quality === 'sharp' ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(devicePixelRatio, qualityCap(selectionRef.current.previewQuality)));
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.minDistance = 3.5;
    controls.maxDistance = 10;

    new GLTFLoader().load('/assets/robot-expressive.glb', (gltf) => {
      if (stopped) return;
      const source = gltf.scene;
      const candidate = cloneSkeleton(gltf.scene) as Group;
      const sourceGhost = cloneSkeleton(gltf.scene) as Group;
      const candidateGhost = cloneSkeleton(gltf.scene) as Group;
      tintClone(source, new Color('#d6b273'), 0.14);
      tintClone(candidate, new Color('#7298b8'), 0.24);
      makeOnionSkin(sourceGhost, new Color('#e4bd76'));
      makeOnionSkin(candidateGhost, new Color('#75b9e6'));
      const box = new Box3().setFromObject(source);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const scale = 2.45 / Math.max(size.x, size.y, size.z, 0.001);
      for (const [index, model] of [source, candidate, sourceGhost, candidateGhost].entries()) {
        model.scale.setScalar(scale);
        model.position.copy(center).multiplyScalar(-scale);
        model.position.x += index === 0 || index === 2 ? -1.45 : 1.45;
        if (index > 1) model.position.z += 0.025;
        holder.add(model);
        model.updateMatrixWorld(true);
      }
      const sourceMixer = new AnimationMixer(source);
      const candidateMixer = new AnimationMixer(candidate);
      const sourceGhostMixer = new AnimationMixer(sourceGhost);
      const candidateGhostMixer = new AnimationMixer(candidateGhost);
      const initial = selectionRef.current;
      const sourceScope = makeScopeSkeleton(source, new Color('#f1bf69'));
      const candidateScope = makeScopeSkeleton(candidate, new Color('#6fc7ff'));
      scene.add(sourceScope.line, candidateScope.line);
      const sourceClip = gltf.animations.find((clip) => clip.name === initial.sourceName) ?? gltf.animations[0];
      const candidateClip = gltf.animations.find((clip) => clip.name === initial.candidateName) ?? sourceClip;
      const playOnce = (mixer: AnimationMixer, clip: AnimationClip) => {
        const action = mixer.clipAction(clip);
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      };
      playOnce(sourceMixer, sourceClip);
      playOnce(candidateMixer, candidateClip);
      playOnce(sourceGhostMixer, sourceClip);
      playOnce(candidateGhostMixer, candidateClip);
      sourceGhost.visible = initial.showOnion;
      candidateGhost.visible = initial.showOnion;
      const baseX = -center.x * scale;
      const applyLayout = (layout: PreviewLayout) => {
        const offset = layout === 'overlay' ? 0 : 1.45;
        source.position.x = baseX - offset;
        sourceGhost.position.x = baseX - offset;
        candidate.position.x = baseX + offset;
        candidateGhost.position.x = baseX + offset;
        setGroupOpacity(source, layout === 'overlay' ? 0.72 : 1);
        setGroupOpacity(candidate, layout === 'overlay' ? 0.58 : 1);
      };
      applyLayout(initial.previewLayout);
      mixersRef.current = {
        source: sourceMixer,
        candidate: candidateMixer,
        sourceGhost: sourceGhostMixer,
        candidateGhost: candidateGhostMixer,
        sourceModel: source,
        candidateModel: candidate,
        sourceModelGhost: sourceGhost,
        candidateModelGhost: candidateGhost,
        baseX,
        sourceClip,
        candidateClip,
        selectionKey: `${initial.sourceName}:${initial.candidateName}`,
        previewLayout: initial.previewLayout,
        previewQuality: initial.previewQuality,
        sourceScope,
        candidateScope,
      };
      gltfAnimationsRef.current = gltf.animations;
      onReady(gltf.animations);
      setStatus('ready');
    }, undefined, () => { if (!stopped) setStatus('error'); });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const schedule = () => {
      if (!stopped && inViewport && pageVisible && frame === 0) frame = requestAnimationFrame(render);
    };
    const render = (now: number) => {
      frame = 0;
      if (stopped || !inViewport || !pageVisible) return;
      const delta = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (playingRef.current) progressRef.current = (progressRef.current + delta / 2.7) % 1;
      const runtime = mixersRef.current;
      if (runtime) {
        const selection = selectionRef.current;
        const selectionKey = `${selection.sourceName}:${selection.candidateName}`;
        if (selectionKey !== runtime.selectionKey) {
          const desiredSource = gltfAnimationsRef.current.find((clip) => clip.name === selection.sourceName) ?? runtime.sourceClip;
          const desiredCandidate = gltfAnimationsRef.current.find((clip) => clip.name === selection.candidateName) ?? runtime.candidateClip;
          runtime.source.stopAllAction();
          runtime.candidate.stopAllAction();
          runtime.sourceGhost.stopAllAction();
          runtime.candidateGhost.stopAllAction();
          runtime.sourceClip = desiredSource;
          runtime.candidateClip = desiredCandidate;
          runtime.selectionKey = selectionKey;
          for (const [mixer, clip] of [
            [runtime.source, desiredSource],
            [runtime.candidate, desiredCandidate],
            [runtime.sourceGhost, desiredSource],
            [runtime.candidateGhost, desiredCandidate],
          ] as Array<[AnimationMixer, AnimationClip]>) {
            const action = mixer.clipAction(clip);
            action.setLoop(LoopOnce, 1);
            action.clampWhenFinished = true;
            action.play();
          }
        }
        if (selection.previewLayout !== runtime.previewLayout) {
          runtime.previewLayout = selection.previewLayout;
          const offset = selection.previewLayout === 'overlay' ? 0 : 1.45;
          runtime.sourceModel.position.x = runtime.baseX - offset;
          runtime.sourceModelGhost.position.x = runtime.baseX - offset;
          runtime.candidateModel.position.x = runtime.baseX + offset;
          runtime.candidateModelGhost.position.x = runtime.baseX + offset;
          setGroupOpacity(runtime.sourceModel, selection.previewLayout === 'overlay' ? 0.72 : 1);
          setGroupOpacity(runtime.candidateModel, selection.previewLayout === 'overlay' ? 0.58 : 1);
        }
        if (selection.previewQuality !== runtime.previewQuality) {
          runtime.previewQuality = selection.previewQuality;
          renderer.setPixelRatio(Math.min(devicePixelRatio, qualityCap(selection.previewQuality)));
          resize();
        }
        runtime.sourceModelGhost.visible = selection.showOnion;
        runtime.candidateModelGhost.visible = selection.showOnion;
        const authoredWindow = Math.max(runtime.sourceClip.duration, runtime.candidateClip.duration);
        const sharedSeconds = progressRef.current * authoredWindow;
        const sourceTime = selection.analysisMode === 'timing'
          ? Math.min(sharedSeconds, runtime.sourceClip.duration)
          : progressRef.current * runtime.sourceClip.duration;
        const candidateTime = selection.analysisMode === 'timing'
          ? Math.min(sharedSeconds, runtime.candidateClip.duration)
          : progressRef.current * runtime.candidateClip.duration;
        runtime.source.setTime(sourceTime);
        runtime.candidate.setTime(candidateTime);
        runtime.sourceModel.updateMatrixWorld(true);
        runtime.candidateModel.updateMatrixWorld(true);
        updateScopeSkeleton(runtime.sourceScope, selection.previewFocus);
        updateScopeSkeleton(runtime.candidateScope, selection.previewFocus);
        const ghostProgress = trailProgress(selection.analysisMode, progressRef.current);
        runtime.sourceGhost.setTime(ghostProgress * runtime.sourceClip.duration);
        runtime.candidateGhost.setTime(ghostProgress * runtime.candidateClip.duration);
      }
      controls.update();
      renderer.render(scene, camera);
      if (now - lastUi > 90) {
        lastUi = now;
        onProgress(progressRef.current);
      }
      schedule();
    };
    const stageObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      last = performance.now();
      if (inViewport) schedule();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }, { rootMargin: '160px' });
    stageObserver.observe(canvas);
    const handleVisibility = () => {
      pageVisible = !document.hidden;
      last = performance.now();
      if (pageVisible) schedule();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    schedule();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      stageObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      controls.dispose();
      mixersRef.current?.source.stopAllAction();
      mixersRef.current?.candidate.stopAllAction();
      mixersRef.current?.sourceGhost.stopAllAction();
      mixersRef.current?.candidateGhost.stopAllAction();
      mixersRef.current?.sourceScope.line.geometry.dispose();
      mixersRef.current?.sourceScope.line.material.dispose();
      mixersRef.current?.candidateScope.line.geometry.dispose();
      mixersRef.current?.candidateScope.line.material.dispose();
      mixersRef.current = null;
      dispose(holder);
      renderer.dispose();
    };
  }, [onProgress, onReady]);

  return (
    <div className="motion-compare-stage">
      <canvas ref={canvasRef} aria-label="Synchronized 3D comparison of source and candidate animation" />
      <div className="motion-stage-grid" aria-hidden="true" />
      <div className="motion-stage-labels" aria-hidden="true"><span>Reference · {sourceName}</span><span>Candidate · {candidateName}</span></div>
      <div className="motion-stage-focus"><span>Skeleton focus</span><strong>{jointScopes.find((item) => item.id === previewFocus)?.label}</strong></div>
      <div className="motion-stage-axis" aria-hidden="true" />
      <div className="motion-stage-calibration" aria-hidden="true"><span>{analysisMode === 'timing' ? 'Shared authored clock' : analysisMode === 'loop' ? 'End pose + start outline' : analysisMode === 'root' ? 'Measured channel · root translation' : 'Normalized joint space'}</span><span>{previewLayout === 'overlay' ? 'Reference + candidate overlay' : 'Reference + candidate side by side'} · {showOnion ? analysisMode === 'loop' ? 'solid = end · wireframe = start' : 'solid = current · wireframe = previous' : 'pose outline hidden'}</span></div>
      {status === 'loading' ? <div className="motion-stage-state"><span />Loading licensed 14-clip rig and animation curves…</div> : null}
      {status === 'error' ? <div className="motion-stage-state motion-stage-state-error">The motion fixture could not be decoded.</div> : null}
    </div>
  );
}

function scoreStyle(score: number) {
  const hue = 32 + score * 0.85;
  return { '--motion-score': score / 100, '--motion-hue': hue } as CSSProperties;
}

function RootPathPlot({ source, candidate, sourceName, candidateName }: {
  source: RootPathClipResult;
  candidate: RootPathClipResult;
  sourceName: string;
  candidateName: string;
}) {
  if (!source.available || !candidate.available) {
    return <div className="motion-root-unavailable"><ScanSearch size={17} /><span><strong>Root translation is unavailable.</strong><small>The local fixture needs a Body, Hips, Pelvis, Root, or HumanoidRootPart position track in both clips.</small></span></div>;
  }
  const all = [...source.points, ...candidate.points];
  const xs = all.map((point) => point.x);
  const zs = all.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const horizontalSpan = Math.max(maxX - minX, maxZ - minZ);
  const span = Math.max(horizontalSpan, 0.05);
  const proxyLabel = (trackName: string | null) => trackName && /(?:body|hips?|pelvis)/i.test(trackName) && !/(?:humanoidrootpart|rootmotion|(?:^|[\[\]./_-])root(?:$|[\[\]./_-]))/i.test(trackName)
    ? 'Body/Hips translation proxy'
    : 'Explicit root translation';
  const toPoints = (path: RootPathClipResult) => path.points.map((point) => {
    const x = 8 + ((point.x - minX) / span) * 84;
    const y = 58 - ((point.z - minZ) / span) * 48;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div className="motion-root-plot">
      <svg viewBox="0 0 100 66" role="img" aria-label={`Top-down root paths for ${sourceName} and ${candidateName}`}>
        <path d="M8 58H92M8 42H92M8 26H92M8 10H92M8 10V58M36 10V58M64 10V58M92 10V58" />
        <polyline className="source" points={toPoints(source)} />
        <polyline className="candidate" points={toPoints(candidate)} />
      </svg>
      <div><span><i className="source" />{sourceName}</span><span><i className="candidate" />{candidateName}</span><small>Top-down X/Z path · origins aligned</small><small>{proxyLabel(source.trackName)} · {source.trackName}</small><small>{proxyLabel(candidate.trackName)} · {candidate.trackName}</small></div>
      <dl className="motion-root-metrics">
        <div><dt>{sourceName}</dt><dd><span>Displacement <strong>{source.displacement.toFixed(2)}</strong></span><span>Path length <strong>{source.pathLength.toFixed(2)}</strong></span><span>Drift <strong>{source.drift.toFixed(2)}</strong></span><span>Vertical travel <strong>{source.verticalTravel.toFixed(2)}</strong></span></dd></div>
        <div><dt>{candidateName}</dt><dd><span>Displacement <strong>{candidate.displacement.toFixed(2)}</strong></span><span>Path length <strong>{candidate.pathLength.toFixed(2)}</strong></span><span>Drift <strong>{candidate.drift.toFixed(2)}</strong></span><span>Vertical travel <strong>{candidate.verticalTravel.toFixed(2)}</strong></span></dd></div>
      </dl>
      {horizontalSpan < 0.005 ? <p className="motion-root-in-place"><strong>In-place fixture:</strong> X/Z travel stays at the origin, so the top-down lines collapse to a point. Vertical body motion remains visible in the metrics; a Studio-supplied root channel would draw the actual travel path.</p> : null}
    </div>
  );
}

function clipJointCount(clip: AnimationClip | undefined) {
  if (!clip) return 0;
  return new Set(clip.tracks.map((track) => track.name.replace(/\.(?:position|quaternion|scale|morphTargetInfluences).*$/, ''))).size;
}

export function MotionComparisonLab({ bridgeClient, project }: { bridgeClient: LocalBridgeClient | null; project: LocalProjectSummary | null }) {
  const { preferences } = useWorkspacePreferences();
  const [workspaceMode, setWorkspaceMode] = useState<'pair' | 'project'>('pair');
  const [sourceName, setSourceName] = useState('Walking');
  const [candidateName, setCandidateName] = useState('Running');
  const [analysisMode, setAnalysisMode] = useState<MotionAnalysisMode>(preferences.analysisMode);
  const [jointScope, setJointScope] = useState<MotionJointScope>(preferences.jointScope);
  const [previewFocus, setPreviewFocus] = useState<MotionJointScope>(preferences.jointScope);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout>('side');
  const [category, setCategory] = useState<'All' | MotionCategory>('All');
  const [clips, setClips] = useState<AnimationClip[]>([]);
  const [playing, setPlaying] = useState(() => preferences.autoplay && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [showOnion, setShowOnion] = useState(preferences.poseTrail);
  const [progress, setProgress] = useState(0);
  const [pairing, setPairing] = useState<LocalPluginPairing | null>(null);
  const [pairingState, setPairingState] = useState<'idle' | 'creating' | 'error'>('idle');
  const [copiedField, setCopiedField] = useState<'endpoint' | 'token' | null>(null);
  const [comparisons, setComparisons] = useState<LocalMotionComparison[]>([]);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  const investigationRef = useRef<HTMLElement>(null);
  const selectedSourceCatalogClip = clipCatalog.find((item) => item.name === sourceName) ?? clipCatalog[1];
  const selectedCatalogClip = clipCatalog.find((item) => item.name === candidateName) ?? clipCatalog[2];
  const selectedAnalysisMode = analysisModes.find((item) => item.id === analysisMode) ?? analysisModes[0];
  const effectiveJointScope: MotionJointScope = analysisMode === 'root' ? 'root' : jointScope;
  const visibleCatalog = category === 'All' ? clipCatalog : clipCatalog.filter((item) => item.category === category);
  const sourceClip = clips.find((clip) => clip.name === sourceName);
  const candidateClip = clips.find((clip) => clip.name === candidateName);
  const result = useMemo(() => sourceClip && candidateClip ? compareClips(sourceClip, candidateClip, {
    mode: analysisMode,
    jointScope: effectiveJointScope,
    sampleCount: preferences.sampleCount,
    reviewThreshold: preferences.reviewThreshold,
  }) : null, [analysisMode, candidateClip, effectiveJointScope, preferences.reviewThreshold, preferences.sampleCount, sourceClip]);
  const latestComparison = comparisons[0];
  const scenarioScores = useMemo(() => {
    const scores: Record<string, { exactCurveData: boolean; primaryValue: number | null } | null> = {};
    for (const scenario of motionScenarios) {
      const scenarioSource = clips.find((clip) => clip.name === scenario.source);
      const scenarioCandidate = clips.find((clip) => clip.name === scenario.candidate);
      if (!scenarioSource || !scenarioCandidate) {
        scores[scenario.id] = null;
        continue;
      }
      const scored = compareClips(scenarioSource, scenarioCandidate, {
        mode: 'shape',
        jointScope: 'full',
        sampleCount: preferences.sampleCount,
        reviewThreshold: preferences.reviewThreshold,
      });
      scores[scenario.id] = { exactCurveData: scored.exactCurveData, primaryValue: scored.primaryValue };
    }
    return scores;
  }, [clips, preferences.sampleCount, preferences.reviewThreshold]);

  // The pair selectors keep source and candidate distinct; a re-upload scenario is exactly the
  // same curves under two IDs, so scenarios set both sides directly instead of going through them.
  function loadScenario(source: string, candidate: string) {
    setSourceName(source);
    setCandidateName(candidate);
    resetPlayback();
  }

  useEffect(() => {
    if (!bridgeClient || !project) {
      setComparisons([]);
      return;
    }
    let active = true;
    const refresh = () => {
      void bridgeClient.listMotionComparisons(project.projectId, 10).then((page) => {
        if (active) {
          setComparisons(page.items);
          setBridgeMessage(null);
        }
      }).catch(() => {
        if (active) setBridgeMessage('CreatorFlow could not refresh the Studio evidence inbox.');
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [bridgeClient, project]);

  useEffect(() => { setAnalysisMode(preferences.analysisMode); }, [preferences.analysisMode]);
  useEffect(() => {
    setJointScope(preferences.jointScope);
    setPreviewFocus(preferences.jointScope);
  }, [preferences.jointScope]);
  useEffect(() => { setShowOnion(preferences.poseTrail); }, [preferences.poseTrail]);

  async function createPairing() {
    if (!bridgeClient || !project) return;
    setPairingState('creating');
    setBridgeMessage(null);
    try {
      const nextPairing = await bridgeClient.createPluginPairing(project.projectId);
      setPairing(nextPairing);
      setPairingState('idle');
    } catch {
      setPairingState('error');
      setBridgeMessage('The desktop bridge could not create a Studio pairing. Restart CreatorFlow and try again.');
    }
  }

  async function copyPairing(value: string, field: 'endpoint' | 'token') {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1800);
    } catch {
      setPairingState('error');
      setBridgeMessage('Clipboard access was blocked. Select the field and copy it manually.');
    }
  }

  function resetPlayback() {
    setProgress(0);
    setPlaying(preferences.autoplay && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function chooseCandidate(name: string) {
    if (name === sourceName) {
      setSourceName(candidateName);
      setCandidateName(name);
    } else {
      setCandidateName(name);
    }
    resetPlayback();
  }

  function chooseSource(name: string) {
    if (name === candidateName) {
      setCandidateName(sourceName);
      setSourceName(name);
    } else {
      setSourceName(name);
    }
    resetPlayback();
  }

  function chooseAnalysisMode(next: MotionAnalysisMode) {
    setAnalysisMode(next);
    setPreviewFocus(next === 'root' ? 'full' : jointScope);
    setProgress(next === 'loop' ? 1 : 0);
    setPlaying(next !== 'loop' && preferences.autoplay && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function chooseJointScope(next: MotionJointScope) {
    setPreviewFocus(next);
    if (analysisMode !== 'root') setJointScope(next);
  }

  function swapPair() {
    setSourceName(candidateName);
    setCandidateName(sourceName);
    resetPlayback();
  }

  function jumpToLargestDifference() {
    if (!result) return;
    setPlaying(false);
    setProgress(result.mode === 'loop' ? 1 : result.largestDifferenceProgress);
  }

  function openProjectClip(name: string) {
    const nextCandidate = clipCatalog.some((clip) => clip.name === name) ? name : 'Walking';
    setCandidateName(nextCandidate);
    if (nextCandidate === sourceName) setSourceName(nextCandidate === 'Walking' ? 'Running' : 'Walking');
    setProgress(0);
    setWorkspaceMode('pair');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => investigationRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })));
  }

  return (
    <div className="motion-comparison-lab motion-darkroom">
      <header className="motion-lab-header motion-darkroom-header">
        <div className="motion-darkroom-intro">
          <span>Roblox animation evidence · local by default</span>
          <h1>Put two motions under the same light.</h1>
          <p>CreatorFlow keeps motion shape, authored timing, loop quality, and root travel as separate signals so a Roblox team can inspect the right evidence before it ships.</p>
        </div>
        <aside><Fingerprint size={18} /><span><strong>{workspaceMode === 'pair' ? 'Motion darkroom' : 'Project context'}</strong><small>{workspaceMode === 'pair' ? `${preferences.sampleCount} samples · raw files stay local` : '427 Instances · fictional Studio snapshot'}</small></span></aside>
        <nav className="motion-scope-switch" aria-label="Animation evidence view">
          <button type="button" aria-pressed={workspaceMode === 'pair'} onClick={() => setWorkspaceMode('pair')}><GitCompare size={16} /><span><strong>Pair compare</strong><small>One rig · two clips</small></span></button>
          <button type="button" aria-pressed={workspaceMode === 'project'} onClick={() => setWorkspaceMode('project')}><FolderTree size={16} /><span><strong>Studio project</strong><small>Full hierarchy · findings</small></span></button>
        </nav>
      </header>

      {workspaceMode === 'pair' ? <>
        <MotionScenarioPicker
          sourceName={sourceName}
          candidateName={candidateName}
          onSelect={loadScenario}
          scenarioScores={scenarioScores}
          result={result}
        />
        <section className="motion-investigation" ref={investigationRef} aria-label="Animation comparison workbench">
          <div className="motion-view-column">
            <header className="motion-workbench-toolbar">
              <div className="motion-pair-controls">
                <label className="motion-candidate-select motion-reference-select"><span>Reference clip</span><select value={sourceName} onChange={(event) => chooseSource(event.target.value)}>{clipCatalog.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><small>{selectedSourceCatalogClip.description}</small></label>
                <button className="motion-swap-pair" type="button" onClick={swapPair} aria-label={`Swap ${sourceName} and ${candidateName}`} title="Swap reference and candidate"><GitCompare size={15} /></button>
                <label className="motion-candidate-select"><span>Candidate clip</span><select value={candidateName} onChange={(event) => chooseCandidate(event.target.value)}>{clipCatalog.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><small>{selectedCatalogClip.description}</small></label>
              </div>
              <div className="motion-analysis-modes" role="group" aria-label="Inspect animation clips by">
                <span>Inspect by</span>
                <div>{analysisModes.map((item) => <button key={item.id} type="button" aria-pressed={analysisMode === item.id} onClick={() => chooseAnalysisMode(item.id)} title={item.detail}>{item.label}</button>)}</div>
              </div>
              <div className="motion-joint-scopes" role="group" aria-label="Joint scope">
                <span>{analysisMode === 'root' ? 'Preview focus' : 'Analyze joints'}<small>{analysisMode === 'root' ? 'Score stays locked to root translation' : 'Updates the score and skeleton highlight'}</small></span>
                <div>{jointScopes.map((item) => <button key={item.id} type="button" aria-pressed={previewFocus === item.id} onClick={() => chooseJointScope(item.id)}>{item.label}</button>)}</div>
              </div>
              <button className="motion-onion-toggle" type="button" aria-pressed={showOnion} onClick={() => setShowOnion((value) => !value)}><ScanSearch size={15} /><span><strong>{analysisMode === 'loop' ? 'Start-pose outline' : 'Previous-pose outline'}</strong><small>{showOnion ? 'Wireframe visible' : 'Outline hidden'}</small></span></button>
            </header>

            <MotionStage sourceName={sourceName} candidateName={candidateName} analysisMode={analysisMode} previewFocus={previewFocus} previewLayout={previewLayout} showOnion={showOnion} previewQuality={preferences.previewQuality} onReady={setClips} progress={progress} playing={playing} onProgress={setProgress} />

            <div className="motion-compare-transport">
              <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause synchronized animation comparison' : 'Play synchronized animation comparison'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
              <button type="button" onClick={() => { setProgress(0); setPlaying(false); }} aria-label="Restart synchronized comparison"><RotateCcw size={14} /></button>
              <label><span>{analysisMode === 'timing' ? 'Shared authored timeline' : analysisMode === 'loop' ? 'Inspect seam at clip end' : 'Normalized phase'}</span><input type="range" min="0" max="1" step="0.002" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }} /></label>
              <output>{analysisMode === 'timing' && result ? `${(progress * Math.max(result.sourceDuration, result.candidateDuration)).toFixed(2)}s` : `${Math.round(progress * 100)}%`}</output>
              <div className="motion-preview-layout" role="group" aria-label="Reference and candidate layout"><button type="button" aria-pressed={previewLayout === 'side'} onClick={() => setPreviewLayout('side')}>Pair side</button><button type="button" aria-pressed={previewLayout === 'overlay'} onClick={() => setPreviewLayout('overlay')}>Pair overlay</button></div>
            </div>

            {analysisMode === 'root' && result?.root ? <RootPathPlot source={result.root.source} candidate={result.root.candidate} sourceName={sourceName} candidateName={candidateName} /> : analysisMode === 'loop' ? <div className="motion-loop-readout"><header><span><RotateCcw size={13} /> Start-to-end continuity</span><small>Pose + velocity · higher is cleaner · quality only</small></header><div><span><small>{sourceName}</small><strong>{result?.loop?.source.continuity ?? '—'}{result?.loop?.source.continuity !== null && result?.loop?.source.continuity !== undefined ? '%' : ''}</strong></span><i aria-hidden="true" /><span><small>{candidateName}</small><strong>{result?.loop?.candidate.continuity ?? '—'}{result?.loop?.candidate.continuity !== null && result?.loop?.candidate.continuity !== undefined ? '%' : ''}</strong></span></div></div> : <div className="motion-fingerprint-readout">
              <header><span>{analysisMode === 'timing' ? <Clock3 size={13} /> : <Fingerprint size={13} />} {analysisMode === 'timing' ? 'Authored-time difference' : 'Pose difference over normalized phase'}</span><small>{preferences.sampleCount} samples · brighter marks are closer</small></header>
              <div className="motion-frame-strip" aria-label={analysisMode === 'timing' ? 'Authored-time similarity samples' : 'Normalized pose similarity samples'}>
                {(result?.frameScores ?? Array.from({ length: preferences.sampleCount }, () => 0)).map((score, index) => <i key={index} style={scoreStyle(Math.round(score * 100))} title={`Sample ${index + 1}: ${Math.round(score * 100)}% agreement`} />)}
                <span style={{ left: `${progress * 100}%` }} />
              </div>
            </div>}

            <section className="motion-analysis-explainer" data-mode={analysisMode} aria-label={`${selectedAnalysisMode.label} explanation`} aria-live="polite">
              {analysisMode === 'timing' ? <Clock3 size={17} /> : analysisMode === 'loop' ? <RotateCcw size={17} /> : <ScanSearch size={17} />}
              <div><span>{selectedAnalysisMode.label}</span><strong>{selectedAnalysisMode.detail}</strong><p>{analysisMode === 'shape' ? 'Use this when two clips may run at different speeds but could still share the same pose sequence.' : analysisMode === 'timing' ? 'Both clips keep their authored seconds. A shorter clip holds its final pose instead of silently looping.' : analysisMode === 'loop' ? 'The trail is pinned to the first pose while the solid rig reaches the end; endpoint motion direction is checked as well as pose closure.' : 'Origins are aligned before the top-down translation paths are compared; this signal stays separate from pose resemblance.'}</p></div>
              <dl><div><dt>Reference</dt><dd>{sourceClip ? `${sourceClip.duration.toFixed(3)}s` : '—'}</dd></div><div><dt>Candidate</dt><dd>{candidateClip ? `${candidateClip.duration.toFixed(3)}s` : '—'}</dd></div><div><dt>{analysisMode === 'root' ? 'Measured' : 'Analyzed'}</dt><dd>{analysisMode === 'root' ? 'Root translation' : jointScopes.find((item) => item.id === effectiveJointScope)?.label}</dd></div></dl>
            </section>
          </div>

          <aside className="motion-result-panel" data-tone={result?.tone ?? 'neutral'} aria-live="polite" aria-atomic="true">
            <header data-tone={result?.tone ?? 'neutral'}>
              <span>{analysisMode === 'loop' ? <RotateCcw size={17} /> : result?.exactCurveData ? <AlertTriangle size={17} /> : <ScanSearch size={17} />}</span>
              <div><small>{result?.primaryLabel ?? 'Reading tracks'}</small><strong>{result?.primaryValue !== null && result?.primaryValue !== undefined ? `${result.primaryValue}%` : '—'}</strong></div>
            </header>
            <div className="motion-result-state"><span>{analysisMode === 'loop' ? 'Loop quality diagnostic' : result?.exactCurveData ? 'Provenance required' : result?.tone === 'review' ? 'Relationship worth reviewing' : 'Comparison evidence'}</span><small>{analysisMode === 'loop' ? 'Not a resemblance or copyright signal' : 'Not a copyright decision'}</small></div>
            <h2>{result?.verdict ?? 'Reading animation tracks'}</h2>
            <p><strong>{sourceName} ↔ {candidateName}</strong> · {selectedAnalysisMode.detail}</p>
            {analysisMode === 'loop' ? <dl className="motion-signal-list"><div><dt>Candidate pose closure</dt><dd>{result?.loop?.candidate.poseClosure ?? '—'}{result?.loop?.candidate.poseClosure !== null && result?.loop?.candidate.poseClosure !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.loop?.candidate.poseClosure ?? 0)} /></div><div><dt>Velocity continuity</dt><dd>{result?.loop?.candidate.velocityContinuity ?? '—'}{result?.loop?.candidate.velocityContinuity !== null && result?.loop?.candidate.velocityContinuity !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.loop?.candidate.velocityContinuity ?? 0)} /></div><div><dt>Scoped joints</dt><dd>{result?.loop?.candidate.tracksAnalyzed ?? '—'}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl> : analysisMode === 'root' ? <dl className="motion-signal-list"><div><dt>Root-path match</dt><dd>{result?.root?.similarity ?? '—'}{result?.root?.similarity !== null && result?.root?.similarity !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.root?.similarity ?? 0)} /></div><div><dt>Candidate travel</dt><dd>{result?.root?.candidate.available ? result.root.candidate.displacement.toFixed(2) : '—'}</dd><i style={scoreStyle(result?.root?.similarity ?? 0)} /></div><div><dt>Candidate drift</dt><dd>{result?.root?.candidate.available ? result.root.candidate.drift.toFixed(2) : '—'}</dd><i style={scoreStyle(Math.max(0, 100 - (result?.root?.candidate.drift ?? 0) * 100))} /></div></dl> : analysisMode === 'timing' ? <dl className="motion-signal-list"><div><dt>Authored-time match</dt><dd>{result?.timing ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.timing ?? 0)} /></div><div><dt>Duration delta</dt><dd>{result ? `${result.durationDeltaSeconds >= 0 ? '+' : ''}${result.durationDeltaSeconds.toFixed(2)}s` : '—'}</dd><i style={scoreStyle(result?.durationSimilarity ?? 0)} /></div><div><dt>Joint coverage</dt><dd>{result?.coverage ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl> : <dl className="motion-signal-list"><div><dt>Pose shape</dt><dd>{result?.pose ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.pose ?? 0)} /></div><div><dt>Authored timing</dt><dd>{result?.timing ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.timing ?? 0)} /></div><div><dt>Joint coverage</dt><dd>{result?.coverage ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl>}
            {analysisMode === 'loop' ? <div className="motion-exact-state" data-exact="false"><Check size={14} /><span><strong>Provenance stays outside this quality score</strong><small>{result?.exactCurveData ? 'These clips also have exact curves, but that fact does not change loop continuity.' : 'Loop continuity never raises a similarity or copyright alert.'}</small></span></div> : <div className="motion-exact-state" data-exact={result?.exactCurveData ? 'true' : 'false'}>{result?.exactCurveData ? <AlertTriangle size={14} /> : <Check size={14} />}<span><strong>{result?.exactCurveData ? 'Canonical curves match exactly' : 'No exact curve match'}</strong><small>{result?.exactCurveData ? 'Renaming an export does not change its structural fingerprint.' : 'Pose similarity can still come from common rigs, libraries, or authorized reuse.'}</small></span></div>}
            <button className="motion-jump-difference" type="button" onClick={jumpToLargestDifference} disabled={!result}>{analysisMode === 'loop' ? 'Inspect end seam' : 'Jump to largest difference'}{result && analysisMode !== 'loop' ? <small>{analysisMode === 'timing' ? `${result.largestDifferenceTimeSeconds.toFixed(2)}s` : `${Math.round(result.largestDifferenceProgress * 100)}%`}{result.largestDifferenceJoint ? ` · ${result.largestDifferenceJoint}` : ''}</small> : null}</button>
            <footer className="motion-review-next"><span>{analysisMode === 'loop' ? 'Quality channel' : 'Human review'}</span><strong>{analysisMode === 'loop' ? 'Loop continuity stays separate from provenance and similarity thresholds.' : 'Attach the source, license, Animation IDs, and a decision before release.'}</strong></footer>
          </aside>
        </section>

        <section className="motion-evidence-grid">
          <article className="motion-joint-evidence">
            <header><div><span>{analysisMode === 'loop' ? 'Seam evidence' : 'Joint evidence'}</span><h2>{analysisMode === 'loop' ? 'Which joints break the loop' : analysisMode === 'root' ? 'Root channel details' : 'Where the movement diverges'}</h2></div><small>{analysisMode === 'root' ? 'Root path is evaluated separately from pose' : 'Lowest-scoring scoped tracks first'}</small></header>
            <div>
              {(result?.trackScores ?? []).map((track) => <div key={track.rawName}><span>{track.name}</span><i><b style={{ width: `${Math.round(track.score * 100)}%` }} /></i><strong>{Math.round(track.score * 100)}%</strong></div>)}
              {!result ? <p>Animation tracks appear after the local fixture is decoded.</p> : result.trackScores.length === 0 ? <p>{analysisMode === 'root' ? 'The root-path plot above carries this mode’s evidence.' : 'No shared tracks are available in the selected joint scope.'}</p> : null}
            </div>
          </article>
          <article className="motion-structure-evidence">
            <header><span>Analysis boundary</span><h2>What entered this view</h2></header>
            <dl>
              <div><dt>Shared tracks</dt><dd>{result ? `${result.commonTracks} / ${Math.max(result.sourceTracks, result.candidateTracks)}` : '—'}</dd></div>
              <div><dt>Reference keys</dt><dd>{result?.sourceKeys.toLocaleString() ?? '—'}</dd></div>
              <div><dt>Candidate keys</dt><dd>{result?.candidateKeys.toLocaleString() ?? '—'}</dd></div>
              <div><dt>Reference duration</dt><dd>{result ? `${result.sourceDuration.toFixed(2)}s` : '—'}</dd></div>
              <div><dt>Candidate duration</dt><dd>{result ? `${result.candidateDuration.toFixed(2)}s` : '—'}</dd></div>
              <div><dt>Samples</dt><dd>{result ? `${result.sampleCount} × ${result.commonTracks}` : '—'}</dd></div>
            </dl>
          </article>
        </section>

        <div className="motion-support-stack">
          <details className="motion-support-drawer">
            <summary><span><strong>Browse the licensed motion set</strong><small>14 authored clips · either side can be the reference</small></span><span>{clips.length ? `${clips.length} loaded` : 'Loading…'} <ChevronDown size={15} /></span></summary>
            <section className="motion-corpus-picker" aria-labelledby="motion-corpus-title">
              <header><div><span>Animation test set</span><h2 id="motion-corpus-title">Choose from 14 authored motions.</h2><p>Every candidate is a real clip in the licensed source file—not a renamed score preset.</p></div><strong>{clips.length ? `${clips.length} clips loaded` : 'Loading clips…'}</strong></header>
              <div className="motion-category-filter" role="group" aria-label="Filter animation clips by category">{(['All', 'Locomotion', 'States', 'Actions', 'Gestures'] as const).map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
              <div className="motion-clip-catalog">{visibleCatalog.map((item) => { const loadedClip = clips.find((clip) => clip.name === item.name); return <button key={item.name} type="button" aria-pressed={candidateName === item.name} onClick={() => chooseCandidate(item.name)}><span><strong>{item.name}</strong><small>{item.description}</small></span><em>{loadedClip ? `${loadedClip.duration.toFixed(2)}s` : '—'}</em></button>; })}</div>
              <footer><span>RobotExpressive · CC0 1.0</span><small>Model by Tomás Laulhé / Quaternius · glTF modifications by Don McCurdy</small></footer>
            </section>
          </details>

          <details className="motion-support-drawer">
            <summary><span><strong>Connect Roblox Studio</strong><small>Receive permitted Animation IDs through the local desktop bridge</small></span><span>{bridgeClient && project ? 'Ready' : 'Desktop required'} <ChevronDown size={15} /></span></summary>
            <section className="motion-plugin-intake" aria-labelledby="studio-bridge-title">
              <header><div><span>Studio bridge</span><h2 id="studio-bridge-title">Pair Roblox Studio with this project.</h2><p>The plugin reads two animations you already have permission to access. CreatorFlow revalidates, fingerprints, compares, and stores the evidence on this machine.</p></div><span className={bridgeClient && project ? 'motion-bridge-ready' : 'motion-bridge-demo'}><i />{bridgeClient && project ? `${project.name} ready` : 'Desktop bridge not connected'}</span></header>
              {bridgeClient && project ? <div className="motion-pairing-panel"><div className="motion-pairing-action"><span><strong>1. Create a temporary pairing</strong><small>Scoped to {project.name}; expires automatically.</small></span><button className="button button-secondary" type="button" onClick={() => { void createPairing(); }} disabled={pairingState === 'creating'}>{pairingState === 'creating' ? 'Creating…' : pairing ? 'Rotate pairing' : 'Create pairing'}</button></div>{pairing ? <div className="motion-pairing-fields"><div className="motion-pairing-field"><span>CreatorFlow endpoint <button type="button" onClick={() => { void copyPairing(pairing.endpoint, 'endpoint'); }}>{copiedField === 'endpoint' ? 'Copied' : 'Copy'}</button></span><input aria-label="CreatorFlow endpoint" readOnly value={pairing.endpoint} onFocus={(event) => event.currentTarget.select()} /></div><div className="motion-pairing-field"><span>Pairing token <button type="button" onClick={() => { void copyPairing(pairing.token, 'token'); }}>{copiedField === 'token' ? 'Copied' : 'Copy'}</button></span><input aria-label="CreatorFlow pairing token" readOnly value={pairing.token} onFocus={(event) => event.currentTarget.select()} /></div></div> : <p className="motion-pairing-empty">CreatorFlow will show a loopback address and short-lived token for the Studio plugin. No animation data is sent to a cloud service.</p>}</div> : <div className="motion-desktop-boundary"><AlertTriangle size={16} /><span><strong>The interactive fixture above still works.</strong><small>To receive real Roblox IDs, launch the CreatorFlow desktop app, open a local project, and return here.</small></span></div>}
              {bridgeMessage ? <p className="motion-bridge-message" role="status">{bridgeMessage}</p> : null}
              {latestComparison ? <article className="motion-live-result"><header><span><i />Latest Studio evidence</span><time dateTime={latestComparison.createdAt}>{new Date(latestComparison.createdAt).toLocaleString()}</time></header><div><span><small>Animation IDs</small><strong>{latestComparison.sourceAssetId} ↔ {latestComparison.candidateAssetId}</strong></span><span><small>Overall</small><strong>{latestComparison.overallPercent}%</strong></span><span><small>Pose</small><strong>{latestComparison.posePercent}%</strong></span><span><small>Timing</small><strong>{latestComparison.timingPercent}%</strong></span><span><small>Coverage</small><strong>{latestComparison.coveragePercent}%</strong></span></div><footer><strong>{latestComparison.verdict}</strong><span>{latestComparison.exactCurveData ? 'Exact canonical curves' : 'Similarity signal'} · evidence ID {latestComparison.id.slice(0, 8)}</span></footer></article> : bridgeClient && project ? <p className="motion-evidence-inbox-empty">Waiting for the first Studio comparison. This page refreshes the local evidence inbox automatically.</p> : null}
              <section className="motion-authoring-boundary"><AlertTriangle size={17} /><div><strong>Compare here; author and publish in Roblox Studio.</strong><p>Every comparison mode reads the supplied curves without changing them. CreatorFlow does not pose the rig, overwrite an AnimationClip, replace an Animation ID, or upload an animation.</p></div><dl><div><dt>Available now</dt><dd>Read · compare · preview · fingerprint</dd></div><div><dt>Not an editor</dt><dd>Rig controls · curve timeline · Roblox upload</dd></div></dl></section>
            </section>
          </details>

          <details className="motion-support-drawer" open={Boolean(bridgeClient && project)}>
            <summary><span><strong>Animation snapshots</strong><small>Pin last-known-good / last-published references and track drift</small></span><span>{bridgeClient && project ? 'Ready' : 'Desktop required'} <ChevronDown size={15} /></span></summary>
            <section className="motion-snapshots-intake" aria-label="Animation snapshots">
              <AnimationSnapshotsPanel bridgeClient={bridgeClient} project={project} latestComparison={latestComparison} />
            </section>
          </details>

          <details className="motion-support-drawer">
            <summary><span><strong>Inspect the evidence record</strong><small>Clip metadata · source permission · algorithm boundary</small></span><span>Unreviewed <ChevronDown size={15} /></span></summary>
            <MetadataInspector
              kind="Animation"
              title={`${sourceName} ↔ ${candidateName}`}
              subtitle={`${selectedAnalysisMode.label} · ${jointScopes.find((item) => item.id === effectiveJointScope)?.label}`}
              sections={[
                { title: 'Clip record', fields: [{ label: 'Record ID', value: `fixture:robot-expressive:${sourceName}:${candidateName}:${analysisMode}:${effectiveJointScope}`, mono: true, copyValue: `fixture:robot-expressive:${sourceName}:${candidateName}:${analysisMode}:${effectiveJointScope}` }, { label: 'Reference clip', value: sourceName }, { label: 'Candidate clip', value: candidateName }, { label: 'Comparison mode', value: selectedAnalysisMode.label, note: 'Read-only; source curves remain unchanged' }, { label: 'Candidate duration', value: candidateClip ? `${candidateClip.duration.toFixed(3)} seconds` : 'Loading…' }, { label: 'Tracks / keys', value: candidateClip ? `${candidateClip.tracks.length} / ${candidateClip.tracks.reduce((total, track) => total + track.times.length, 0).toLocaleString()}` : 'Loading…' }, { label: 'Joints addressed', value: candidateClip ? clipJointCount(candidateClip) : 'Loading…' }] },
                { title: 'Source and permission', fields: [{ label: 'Fixture', value: 'RobotExpressive.glb' }, { label: 'File size', value: '463,988 bytes' }, { label: 'SHA-256', value: '047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319', mono: true, copyValue: '047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319' }, { label: 'License', value: 'CC0 1.0' }, { label: 'Attribution', value: 'Tomás Laulhé / Quaternius; modifications by Don McCurdy' }, { label: 'Source record', value: 'three.js / examples/models/gltf/RobotExpressive', mono: true, copyValue: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive' }] },
                { title: 'Comparison evidence', fields: [{ label: 'Reference', value: sourceName }, { label: 'Algorithm', value: `motion-sim/v0.3 · ${preferences.sampleCount} samples · ${analysisMode}`, mono: true }, { label: 'Primary result', value: result?.primaryValue !== null && result?.primaryValue !== undefined ? `${result.primaryLabel}: ${result.primaryValue}%` : 'Unavailable' }, { label: 'Pose / authored timing', value: result ? `${result.pose}% / ${result.timing}%` : 'Analyzing…' }, { label: 'Exact curve match', value: result ? (result.exactCurveData ? 'Yes' : 'No') : 'Analyzing…' }, { label: 'Shared track coverage', value: result ? `${result.commonTracks} tracks · ${result.coverage}%` : 'Analyzing…' }, { label: 'Decision state', value: 'Unreviewed', note: analysisMode === 'loop' ? 'Loop continuity is a quality diagnostic, not a provenance decision.' : 'Similarity is a lead; a person records the provenance decision.' }] },
              ]}
            />
          </details>
        </div>
      </> : <RobloxProjectExample onOpenPair={openProjectClip} />}

      <section className="motion-boundary-note"><AlertTriangle size={17} /><div><strong>This is evidence, not a copyright verdict.</strong><p>A high score can result from common walk cycles, shared rigs, mocap libraries, or authorized reuse. A production finding must stay attached to Animation IDs, source files, licenses, authors, dates, and a human decision.</p></div></section>

      <section className="motion-roblox-path">
        <header><span>Roblox Studio bridge · desktop pairing required</span><h2>The plugin supplies the motion; CreatorFlow keeps the evidence.</h2><p>The bridge reads permitted clips and converts poses, transforms, easing, and timing into a normalized record. This web prototype does not include installable Studio or animation-authoring tools.</p></header>
        <div><article><span>Input</span><strong>Two Animation IDs</strong><small>Owned, shared, or otherwise accessible in Studio</small></article><i aria-hidden="true" /><article><span>Studio</span><strong>Resolve permitted clip</strong><small>AnimationClipProvider · normalize locally</small></article><i aria-hidden="true" /><article><span>CreatorFlow</span><strong>Fingerprint and review</strong><small>Exact curves · motion · timing · provenance</small></article></div>
        <footer><span>Permission boundary</span><strong>The plugin cannot fetch restricted animation data or bypass Roblox asset permissions.</strong></footer>
      </section>
    </div>
  );
}
