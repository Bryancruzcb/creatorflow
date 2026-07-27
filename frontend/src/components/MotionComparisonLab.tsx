import { AlertTriangle, BadgeCheck, Check, ChevronDown, Clock3, Fingerprint, FolderTree, GitCompare, Pause, Play, RotateCcw, ScanSearch, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Box3,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  LoopOnce,
  Mesh,
  Object3D,
  SRGBColorSpace,
  PerspectiveCamera,
  PropertyBinding,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LocalBridgeClient, type LocalMotionComparison, type LocalPluginPairing, type LocalPluginPairingSummary, type LocalProjectSummary } from '../bridge/localBridge';
import { verificationBasis } from '../bridge/evidenceBasis';
import { formatPairingId, isRevocable, pairingStatusLabel, pairingStatusTone } from '../bridge/pluginPairings';
import { EvidenceBasisMark } from './EvidenceBasisMark';
import { AnimationSnapshotsPanel } from './AnimationSnapshotsPanel';
import { MotionScenarioPicker } from './MotionScenarioPicker';
import { clipInRig, rigById, rigFixtures } from '../motion/rigFixtures';
import { formatRegisteredAt, registryRecordFor, type RegistryRecord } from '../motion/motionRegistry';
import {
  analyzeMotionClips,
  type MotionAnalysisMode,
  type MotionAnalysisOptions,
  type MotionAnalysisResult,
  type MotionJointScope,
  type RootPathClipResult,
  trackMatchesJointScope,
} from '../motion/motionAnalysis';
import { DEVIATION_RAMP, NO_DATA_HEX, SIMILARITY_RAMP, rampGradientCss, sampleRamp, sampleRampCss } from '../motion/ramp';
import { createStudioScene } from '../motion/sceneFoundation';
import { useWorkspacePreferences } from '../preferences/workspacePreferences';
import { MetadataInspector } from './MetadataInspector';
import { RobloxProjectExample } from './RobloxProjectExample';
import './MotionComparisonLab.premium.css';

type MotionCategory = 'Locomotion' | 'States' | 'Actions' | 'Gestures';
type PreviewLayout = 'side' | 'overlay';

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

/**
 * Phase for a trail member.
 *
 * `step` is how many spacings behind the live pose this member sits, so the default of 1 keeps
 * the original single-ghost behaviour exactly: progress - 0.075.
 *
 * In loop mode every member pins to 0, because that mode compares the end pose against the start
 * pose and a lagging trail would be answering a different question.
 */
export function trailProgress(mode: MotionAnalysisMode, progress: number, step = 1, spacing = TRAIL_SPACING) {
  return mode === 'loop' ? 0 : Math.max(0, progress - step * spacing);
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

function makeOnionSkin(group: Group, tint: Color, opacity = 0.34) {
  group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const ghosts = materials.map((material) => {
      const next = material.clone();
      next.transparent = true;
      next.opacity = opacity;
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

/**
 * Joint separation treated as the top of the deviation ramp, in normalised rig units.
 *
 * The stage normalises every rig to roughly two units tall, so 0.35 is about a sixth of body
 * height — far enough apart that the two poses are unmistakably different, close enough that
 * ordinary walk-cycle phase differences still show gradient rather than saturating instantly.
 */
const JOINT_DEVIATION_CEILING = 0.35;

/**
 * Pose trail.
 *
 * There used to be exactly one ghost per side at a hard-coded 7.5% phase lag, which the UI called
 * an onion skin. One lagging duplicate is not a pose history — and because the lag clamps at zero,
 * for the first 7.5% of playback the ghost sat exactly on the live pose and the feature silently
 * did nothing.
 *
 * Three members per side, evenly spaced backwards in phase, fading as they recede.
 */
const TRAIL_LENGTH = 3;
const TRAIL_SPACING = 0.075;

export interface ScopeSkeleton {
  line: LineSegments<BufferGeometry, LineBasicMaterial>;
  position: Float32BufferAttribute;
  /** Per-vertex colour, so a segment can carry its own deviation reading. */
  color: Float32BufferAttribute;
  segments: Array<{ child: Bone; parent: Bone }>;
  tint: Color;
  start: Vector3;
  end: Vector3;
  peer: Vector3;
  /** Reused so the per-frame colour pass allocates nothing. */
  scratch: Color;
}

/**
 * What the candidate skeleton is being measured against.
 *
 * Deviation is per-BONE, not per-vertex. The analysis pipeline's atomic unit is the joint path,
 * and there is no vertex-level quantity anywhere in it — so a per-vertex surface shading would be
 * an interpolation of per-bone numbers presented as if it were measured. Per-bone is what is
 * actually known.
 *
 * Both rigs are SkeletonUtils clones of the same glTF, so their segment arrays are index-for-index
 * identical and no name matching is needed.
 */
export interface JointDeviation {
  peerSegments: ScopeSkeleton['segments'];
  peerAnimated: Set<string>;
  /** Distance treated as the top of the ramp, in normalised rig units. */
  ceiling: number;
}

export function makeScopeSkeleton(model: Group, tint: Color): ScopeSkeleton {
  const segments: ScopeSkeleton['segments'] = [];
  model.traverse((child) => {
    if (child instanceof Bone && child.parent instanceof Bone) segments.push({ child, parent: child.parent });
  });
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(new Float32Array(Math.max(6, segments.length * 6)), 3);
  position.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  const color = new Float32BufferAttribute(new Float32Array(Math.max(6, segments.length * 6)), 3);
  color.setUsage(DynamicDrawUsage);
  geometry.setAttribute('color', color);
  geometry.setDrawRange(0, 0);
  // vertexColors is always on; when no deviation is being shown every segment is written with the
  // rig's own tint, so the default appearance is unchanged.
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false });
  const line = new LineSegments(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 6;
  return { line, position, color, segments, tint: tint.clone(), start: new Vector3(), end: new Vector3(), peer: new Vector3(), scratch: new Color() };
}

/** The uuids of the bones this clip actually animates, so the overlay can skip dead joints. */
function animatedBoneUuids(model: Object3D, clip: AnimationClip): Set<string> {
  const uuids = new Set<string>();
  for (const track of clip.tracks) {
    const node = PropertyBinding.findNode(model, PropertyBinding.parseTrackName(track.name).nodeName) as Object3D | null;
    if (node) uuids.add(node.uuid);
  }
  return uuids;
}

export function updateScopeSkeleton(
  skeleton: ScopeSkeleton,
  scope: MotionJointScope,
  animatedBones: Set<string>,
  deviation?: JointDeviation | null,
) {
  const values = skeleton.position.array as Float32Array;
  const colors = skeleton.color.array as Float32Array;
  let offset = 0;
  for (let index = 0; index < skeleton.segments.length; index += 1) {
    const segment = skeleton.segments[index];
    // Only draw joints this clip drives; a bone with no track sits in bind pose and its
    // static line reads as broken.
    if (!animatedBones.has(segment.child.uuid)) continue;
    if (!trackMatchesJointScope(segment.child.name, scope)) continue;
    segment.parent.getWorldPosition(skeleton.start);
    segment.child.getWorldPosition(skeleton.end);
    values[offset] = skeleton.start.x;
    values[offset + 1] = skeleton.start.y;
    values[offset + 2] = skeleton.start.z;
    values[offset + 3] = skeleton.end.x;
    values[offset + 4] = skeleton.end.y;
    values[offset + 5] = skeleton.end.z;

    /**
     * Colour this segment by how far the matching joint on the other rig sits from this one.
     *
     * Three distinct cases, and they must LOOK distinct:
     *  - no comparison running -> the rig's own tint, i.e. the ordinary appearance;
     *  - comparison running and the peer drives this bone -> the deviation ramp;
     *  - comparison running and the peer does NOT drive it -> the off-ramp "no data" grey.
     *
     * That third case used to fall back to the rig tint, and the source tint (#f1bf69) sits
     * inside the ramp's top band — so "the other clip has no data for this bone" was painted as
     * "this bone is maximally different". That is the same defect already fixed in the surface
     * heatmap, which is why NO_DATA_HEX exists.
     *
     * Colours go through Color.setRGB(..., SRGBColorSpace) rather than being divided by 255 and
     * written raw. three has ColorManagement enabled, so a vertex-colour buffer is LINEAR: the
     * raw bytes for #1a222c are (0.102, 0.133, 0.173) where the correct linear values are
     * (0.010, 0.016, 0.025). Writing them raw rendered the whole scale far too bright and made
     * an identical joint read as roughly mid-deviation against this ramp's own legend.
     */
    const peerSegment = deviation?.peerSegments[index];
    if (!deviation) {
      skeleton.scratch.copy(skeleton.tint);
    } else if (peerSegment && deviation.peerAnimated.has(peerSegment.child.uuid)) {
      peerSegment.child.getWorldPosition(skeleton.peer);
      const ratio = Math.min(1, skeleton.end.distanceTo(skeleton.peer) / deviation.ceiling);
      const sample = sampleRamp(DEVIATION_RAMP, ratio);
      skeleton.scratch.setRGB(sample.r / 255, sample.g / 255, sample.b / 255, SRGBColorSpace);
    } else {
      skeleton.scratch.set(NO_DATA_HEX);
    }
    const r = skeleton.scratch.r;
    const g = skeleton.scratch.g;
    const b = skeleton.scratch.b;
    colors[offset] = r;
    colors[offset + 1] = g;
    colors[offset + 2] = b;
    colors[offset + 3] = r;
    colors[offset + 4] = g;
    colors[offset + 5] = b;

    offset += 6;
  }
  skeleton.position.needsUpdate = true;
  skeleton.color.needsUpdate = true;
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

function MotionStage({ glbUrl, sourceName, candidateName, analysisMode, previewFocus, previewLayout, showOnion, previewQuality, onReady, progress, playing, onProgress }: {
  glbUrl: string;
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
    sourceTrail: Array<{ model: Group; mixer: AnimationMixer }>;
    candidateTrail: Array<{ model: Group; mixer: AnimationMixer }>;
    sourceModel: Group;
    candidateModel: Group;

    baseX: number;
    sourceClip: AnimationClip;
    candidateClip: AnimationClip;
    selectionKey: string;
    previewLayout: PreviewLayout;
    previewQuality: 'battery' | 'balanced' | 'sharp';
    sourceScope: ScopeSkeleton;
    candidateScope: ScopeSkeleton;
    sourceAnimatedBones: Set<string>;
    candidateAnimatedBones: Set<string>;
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
    let idleTimer = 0;
    let inViewport = true;
    let pageVisible = !document.hidden;
    let last = performance.now();
    let lastUi = 0;
    setStatus('loading');
    const camera = new PerspectiveCamera(34, 16 / 8, 0.01, 100);
    camera.position.set(0, 0.3, 6.1);
    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });

    // The pixel-ratio cap here is a user setting, not drift — it is the battery/balanced/sharp
    // control — so it is passed into the studio rather than replaced by it.
    const qualityCap = (quality: 'battery' | 'balanced' | 'sharp') => quality === 'battery' ? 1 : quality === 'sharp' ? 2 : 1.5;
    const studio = createStudioScene(renderer, {
      background: '#151713',
      maxPixelRatio: qualityCap(selectionRef.current.previewQuality),
    });
    const scene = studio.scene;
    const holder = studio.holder;
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controls.minDistance = 3.5;
    controls.maxDistance = 10;

    new GLTFLoader().load(glbUrl, (gltf) => {
      if (stopped) return;
      const source = gltf.scene;
      const candidate = cloneSkeleton(gltf.scene) as Group;
      tintClone(source, new Color('#d6b273'), 0.14);
      tintClone(candidate, new Color('#7298b8'), 0.24);
      // Trail members fade as they recede, so the reading is "which way is time running".
      const makeTrail = (tint: string) => Array.from({ length: TRAIL_LENGTH }, (_unused, step) => {
        const model = cloneSkeleton(gltf.scene) as Group;
        makeOnionSkin(model, new Color(tint), 0.34 * (1 - step / (TRAIL_LENGTH + 1)));
        return model;
      });
      const sourceGhosts = makeTrail('#e4bd76');
      const candidateGhosts = makeTrail('#75b9e6');
      const box = new Box3().setFromObject(source);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const scale = 2.45 / Math.max(size.x, size.y, size.z, 0.001);
      const place = (model: Group, side: -1 | 1, depthStep: number) => {
        model.scale.setScalar(scale);
        model.position.copy(center).multiplyScalar(-scale);
        model.position.x += side * 1.45;
        // Increasing depth nudge per trail member so they do not z-fight with each other.
        model.position.z += depthStep * 0.025;
        holder.add(model);
        model.updateMatrixWorld(true);
      };
      place(source, -1, 0);
      place(candidate, 1, 0);
      sourceGhosts.forEach((model, step) => place(model, -1, step + 1));
      candidateGhosts.forEach((model, step) => place(model, 1, step + 1));
      const sourceMixer = new AnimationMixer(source);
      const candidateMixer = new AnimationMixer(candidate);
      const sourceTrail = sourceGhosts.map((model) => ({ model, mixer: new AnimationMixer(model) }));
      const candidateTrail = candidateGhosts.map((model) => ({ model, mixer: new AnimationMixer(model) }));
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
      sourceTrail.forEach((member) => { playOnce(member.mixer, sourceClip); member.model.visible = initial.showOnion; });
      candidateTrail.forEach((member) => { playOnce(member.mixer, candidateClip); member.model.visible = initial.showOnion; });
      const baseX = -center.x * scale;
      const applyLayout = (layout: PreviewLayout) => {
        const offset = layout === 'overlay' ? 0 : 1.45;
        source.position.x = baseX - offset;
        candidate.position.x = baseX + offset;
        sourceTrail.forEach((member) => { member.model.position.x = baseX - offset; });
        candidateTrail.forEach((member) => { member.model.position.x = baseX + offset; });
        setGroupOpacity(source, layout === 'overlay' ? 0.72 : 1);
        setGroupOpacity(candidate, layout === 'overlay' ? 0.58 : 1);
      };
      applyLayout(initial.previewLayout);
      mixersRef.current = {
        source: sourceMixer,
        candidate: candidateMixer,
        sourceTrail,
        candidateTrail,
        sourceModel: source,
        candidateModel: candidate,

        baseX,
        sourceClip,
        candidateClip,
        selectionKey: `${initial.sourceName}:${initial.candidateName}`,
        previewLayout: initial.previewLayout,
        previewQuality: initial.previewQuality,
        sourceScope,
        candidateScope,
        sourceAnimatedBones: animatedBoneUuids(source, sourceClip),
        candidateAnimatedBones: animatedBoneUuids(candidate, candidateClip),
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
      if (idleTimer) { window.clearTimeout(idleTimer); idleTimer = 0; }
      if (!stopped && inViewport && pageVisible && frame === 0) frame = requestAnimationFrame(render);
    };

    /**
     * Idle cadence.
     *
     * This stage used to re-render at the full display rate whenever it was on screen, including
     * while paused on a static pose — four skinned meshes, two rebuilt skeleton line buffers and
     * two ghost mixers, every frame, for an image that was not changing. It is the most expensive
     * viewer in the app and was the only one that never idled.
     *
     * Rather than convert it to the demand-driven scheduler the other viewers use (that is a
     * larger change to this file's state handling, and worth doing on its own), it now simply
     * drops to ~11fps once playback is paused and the camera has settled. Scrubbing or orbiting
     * returns it to full rate on the next tick, so the worst case is under 90ms of latency
     * before the first frame of an interaction.
     */
    const scheduleIdle = () => {
      if (stopped || !inViewport || !pageVisible || frame !== 0 || idleTimer) return;
      idleTimer = window.setTimeout(() => {
        idleTimer = 0;
        if (!stopped && inViewport && pageVisible && frame === 0) frame = requestAnimationFrame(render);
      }, 90);
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
          runtime.sourceTrail.forEach((member) => member.mixer.stopAllAction());
          runtime.candidateTrail.forEach((member) => member.mixer.stopAllAction());
          runtime.sourceClip = desiredSource;
          runtime.candidateClip = desiredCandidate;
          runtime.sourceAnimatedBones = animatedBoneUuids(runtime.sourceModel, desiredSource);
          runtime.candidateAnimatedBones = animatedBoneUuids(runtime.candidateModel, desiredCandidate);
          runtime.selectionKey = selectionKey;
          for (const [mixer, clip] of [
            [runtime.source, desiredSource],
            [runtime.candidate, desiredCandidate],
            ...runtime.sourceTrail.map((member) => [member.mixer, desiredSource]),
            ...runtime.candidateTrail.map((member) => [member.mixer, desiredCandidate]),
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
          runtime.sourceTrail.forEach((member) => { member.model.position.x = runtime.baseX - offset; });
          runtime.candidateModel.position.x = runtime.baseX + offset;
          runtime.candidateTrail.forEach((member) => { member.model.position.x = runtime.baseX + offset; });
          setGroupOpacity(runtime.sourceModel, selection.previewLayout === 'overlay' ? 0.72 : 1);
          setGroupOpacity(runtime.candidateModel, selection.previewLayout === 'overlay' ? 0.58 : 1);
        }
        if (selection.previewQuality !== runtime.previewQuality) {
          runtime.previewQuality = selection.previewQuality;
          renderer.setPixelRatio(Math.min(devicePixelRatio, qualityCap(selection.previewQuality)));
          resize();
        }
        runtime.sourceTrail.forEach((member) => { member.model.visible = selection.showOnion; });
        runtime.candidateTrail.forEach((member) => { member.model.visible = selection.showOnion; });
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
        /**
         * Deviation is only meaningful in overlay.
         *
         * In side-by-side the two rigs are placed 2.9 units apart, so a world-space joint distance
         * would be dominated by the layout offset — a large, confident-looking number that is
         * entirely an artefact of where the models were parked. Gated rather than "corrected",
         * because the reading only means anything when the rigs are actually co-located.
         */
        const showDeviation = selection.previewLayout === 'overlay';
        updateScopeSkeleton(
          runtime.sourceScope,
          selection.previewFocus,
          runtime.sourceAnimatedBones,
          showDeviation ? { peerSegments: runtime.candidateScope.segments, peerAnimated: runtime.candidateAnimatedBones, ceiling: JOINT_DEVIATION_CEILING } : null,
        );
        updateScopeSkeleton(
          runtime.candidateScope,
          selection.previewFocus,
          runtime.candidateAnimatedBones,
          showDeviation ? { peerSegments: runtime.sourceScope.segments, peerAnimated: runtime.sourceAnimatedBones, ceiling: JOINT_DEVIATION_CEILING } : null,
        );
        // Only tick trail members that are actually drawn. The single ghost was ticked even when
        // hidden, which was a small waste at N=1 and would be the dominant cost at N=3.
        if (selection.showOnion) {
          // In loop mode every member pins to phase 0, so members beyond the first would be
          // identical rigs stacked at increasing depth — a smeared triple image of the start pose
          // instead of the single crisp outline the caption promises.
          const drawn = selection.analysisMode === 'loop' ? 1 : TRAIL_LENGTH;
          runtime.sourceTrail.forEach((member, step) => { member.model.visible = step < drawn; });
          runtime.candidateTrail.forEach((member, step) => { member.model.visible = step < drawn; });
          runtime.sourceTrail.forEach((member, step) => {
            member.mixer.setTime(trailProgress(selection.analysisMode, progressRef.current, step + 1) * runtime.sourceClip.duration);
          });
          runtime.candidateTrail.forEach((member, step) => {
            member.mixer.setTime(trailProgress(selection.analysisMode, progressRef.current, step + 1) * runtime.candidateClip.duration);
          });
        }
      }
      // OrbitControls.update() reports whether the camera actually moved, which covers the tail
      // of damped motion after the pointer is released.
      const cameraMoving = controls.update();
      renderer.render(scene, camera);
      if (now - lastUi > 90) {
        lastUi = now;
        onProgress(progressRef.current);
      }
      if (playingRef.current || cameraMoving) schedule();
      else scheduleIdle();
    };
    const suspend = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (idleTimer) {
        window.clearTimeout(idleTimer);
        idleTimer = 0;
      }
    };
    const stageObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting;
      last = performance.now();
      if (inViewport) schedule();
      else suspend();
    }, { rootMargin: '160px' });
    stageObserver.observe(canvas);
    const handleVisibility = () => {
      pageVisible = !document.hidden;
      last = performance.now();
      if (pageVisible) schedule();
      else suspend();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    schedule();

    return () => {
      stopped = true;
      suspend();
      observer.disconnect();
      stageObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      controls.dispose();
      mixersRef.current?.source.stopAllAction();
      mixersRef.current?.candidate.stopAllAction();
      mixersRef.current?.sourceTrail.forEach((member) => member.mixer.stopAllAction());
      mixersRef.current?.candidateTrail.forEach((member) => member.mixer.stopAllAction());
      mixersRef.current?.sourceScope.line.geometry.dispose();
      mixersRef.current?.sourceScope.line.material.dispose();
      mixersRef.current?.candidateScope.line.geometry.dispose();
      mixersRef.current?.candidateScope.line.material.dispose();
      mixersRef.current = null;
      dispose(holder);
      studio.dispose();
      renderer.dispose();
    };
  }, [glbUrl, onProgress, onReady]);

  return (
    <div className="motion-compare-stage">
      <canvas ref={canvasRef} aria-label="Synchronized 3D comparison of source and candidate animation" />
      <div className="motion-stage-grid" aria-hidden="true" />
      <div className="motion-stage-labels" aria-hidden="true"><span>Reference · {sourceName}</span><span>Candidate · {candidateName}</span></div>
      <div className="motion-stage-focus"><span>Skeleton focus</span><strong>{jointScopes.find((item) => item.id === previewFocus)?.label}</strong></div>
      <div className="motion-stage-axis" aria-hidden="true" />
      <div className="motion-stage-calibration" aria-hidden="true"><span>{analysisMode === 'timing' ? 'Shared authored clock' : analysisMode === 'loop' ? 'End pose + start outline' : analysisMode === 'root' ? 'Measured channel · root translation' : 'Normalized joint space'}</span><span>{previewLayout === 'overlay' ? 'Reference + candidate overlay' : 'Reference + candidate side by side'} · {showOnion ? analysisMode === 'loop' ? 'solid = end · wireframe = start' : 'solid = current · wireframe = previous' : 'pose outline hidden'}</span></div>
      {/* A colour scale with no key is a magnitude claim the reader cannot check. The ceiling is
          stated explicitly, and the unmeasured swatch is shown because "the other clip has no data
          for this joint" is a different statement from "this joint matches". */}
      {previewLayout === 'overlay' ? (
        <div className="motion-deviation-legend">
          <span>Joint separation</span>
          <i style={{ backgroundImage: rampGradientCss(DEVIATION_RAMP) }} />
          <span>0 &rarr; {JOINT_DEVIATION_CEILING.toFixed(2)} rig units</span>
          <em><i className="motion-deviation-nodata" style={{ backgroundColor: NO_DATA_HEX }} />not driven by both clips</em>
        </div>
      ) : null}
      {status === 'loading' ? <div className="motion-stage-state"><span />Loading licensed rig and animation curves…</div> : null}
      {status === 'error' ? <div className="motion-stage-state motion-stage-state-error">The motion fixture could not be decoded.</div> : null}
    </div>
  );
}

/**
 * The old version was `hue = 32 + score * 0.85` — orange at 0%, green at 100%.
 *
 * That renders a high similarity score green, and green reads as "pass". For a provenance tool a
 * high score is the reading that needs a human, not the one that clears the asset. The scenario
 * pills a few hundred pixels away already got this right, labelling an exact curve match in red
 * while this readout congratulated it.
 *
 * Now it runs quiet-neutral to review-amber, and never reaches red: similarity is evidence, not a
 * verdict, and must not look like one.
 */
function scoreStyle(score: number) {
  return {
    '--motion-score': score / 100,
    '--motion-tone': sampleRampCss(SIMILARITY_RAMP, score / 100),
  } as CSSProperties;
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
  const project = (point: { x: number; z: number }) => ({
    x: 8 + ((point.x - minX) / span) * 84,
    y: 58 - ((point.z - minZ) / span) * 48,
  });
  const toPoints = (path: RootPathClipResult) => path.points.map((point) => {
    const { x, y } = project(point);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  /**
   * Time direction.
   *
   * Each sample already carries its normalised `progress`, and the plot threw it away — so the
   * path showed where the root went but never which way it ran. Segments now fade in along phase,
   * faint at the start and solid at the end, which encodes direction without touching the
   * candidate's dash pattern (the only non-colour channel already in use).
   */
  const toSegments = (path: RootPathClipResult, className: string) => path.points.slice(1).map((point, index) => {
    const from = project(path.points[index]);
    const to = project(point);
    return (
      <line
        key={`${className}-${index}`}
        className={className}
        x1={from.x.toFixed(2)}
        y1={from.y.toFixed(2)}
        x2={to.x.toFixed(2)}
        y2={to.y.toFixed(2)}
        opacity={(0.22 + 0.78 * point.progress).toFixed(3)}
      />
    );
  });

  const marker = (path: RootPathClipResult, which: 'start' | 'end') => {
    const point = which === 'start' ? path.points[0] : path.points[path.points.length - 1];
    if (!point) return null;
    return project(point);
  };
  const sourceStart = marker(source, 'start');
  const sourceEnd = marker(source, 'end');
  const candidateStart = marker(candidate, 'start');
  const candidateEnd = marker(candidate, 'end');

  // Per-clip, not combined: the shared extent means one travelling clip hides an in-place one.
  const travelOf = (path: RootPathClipResult) => {
    const px = path.points.map((point) => point.x);
    const pz = path.points.map((point) => point.z);
    return Math.max(Math.max(...px) - Math.min(...px), Math.max(...pz) - Math.min(...pz));
  };
  const sourceInPlace = travelOf(source) < 0.005;
  const candidateInPlace = travelOf(candidate) < 0.005;

  const inPlaceCopy = sourceInPlace && candidateInPlace
    ? 'Both clips stay at the origin in X/Z, so both top-down paths collapse to a point.'
    : sourceInPlace
      ? `${sourceName} stays at the origin in X/Z, so its path collapses to a point while ${candidateName} travels.`
      : candidateInPlace
        ? `${candidateName} stays at the origin in X/Z, so its path collapses to a point while ${sourceName} travels.`
        : null;

  return (
    <div className="motion-root-plot">
      <svg viewBox="0 0 100 66" role="img" aria-label={`Top-down root paths for ${sourceName} and ${candidateName}. Each path fades in along its own timeline, faint at the start and solid at the end, with a hollow marker at the first sample and a filled marker at the last.`}>
        <path d="M8 58H92M8 42H92M8 26H92M8 10H92M8 10V58M36 10V58M64 10V58M92 10V58" />
        {toSegments(source, 'source')}
        {toSegments(candidate, 'candidate')}
        {sourceStart ? <circle className="root-start source" cx={sourceStart.x} cy={sourceStart.y} r="1.5" /> : null}
        {candidateStart ? <circle className="root-start candidate" cx={candidateStart.x} cy={candidateStart.y} r="1.5" /> : null}
        {sourceEnd ? <circle className="root-end source" cx={sourceEnd.x} cy={sourceEnd.y} r="1.7" /> : null}
        {candidateEnd ? <circle className="root-end candidate" cx={candidateEnd.x} cy={candidateEnd.y} r="1.7" /> : null}
      </svg>
      <div><span><i className="source" />{sourceName}</span><span><i className="candidate" />{candidateName}</span><small>Top-down X/Z path · origins aligned</small><small>{proxyLabel(source.trackName)} · {source.trackName}</small><small>{proxyLabel(candidate.trackName)} · {candidate.trackName}</small></div>
      <dl className="motion-root-metrics">
        <div><dt>{sourceName}</dt><dd><span>Displacement <strong>{source.displacement.toFixed(2)}</strong></span><span>Path length <strong>{source.pathLength.toFixed(2)}</strong></span><span>Drift <strong>{source.drift.toFixed(2)}</strong></span><span>Vertical travel <strong>{source.verticalTravel.toFixed(2)}</strong></span></dd></div>
        <div><dt>{candidateName}</dt><dd><span>Displacement <strong>{candidate.displacement.toFixed(2)}</strong></span><span>Path length <strong>{candidate.pathLength.toFixed(2)}</strong></span><span>Drift <strong>{candidate.drift.toFixed(2)}</strong></span><span>Vertical travel <strong>{candidate.verticalTravel.toFixed(2)}</strong></span></dd></div>
      </dl>
      {inPlaceCopy ? <p className="motion-root-in-place"><strong>In-place fixture:</strong> {inPlaceCopy} Vertical body motion remains visible in the metrics; a Studio-supplied root channel would draw the actual travel path.</p> : null}
    </div>
  );
}

function clipJointCount(clip: AnimationClip | undefined) {
  if (!clip) return 0;
  return new Set(clip.tracks.map((track) => track.name.replace(/\.(?:position|quaternion|scale|morphTargetInfluences).*$/, ''))).size;
}

/**
 * The registry hit — the payoff that turns a bare similarity number into a lead. When the reference
 * is a registered asset, this shows the owner's record: who registered it, when, under what license,
 * and the Animation ID it maps to — i.e. exactly what you'd attach as provenance or reject against.
 */
function RegistryMatchCard({ record, candidateName, pose, exact, mode }: {
  record: RegistryRecord;
  candidateName: string;
  pose: number | null;
  exact: boolean;
  mode: MotionAnalysisMode;
}) {
  const restricted = record.license === 'All rights reserved';
  // Flag the card when the candidate both resembles a registered asset AND can't be freely reused;
  // that combination is the one a human must not ship past without a decision.
  const flagged = exact || (restricted && (pose ?? 0) >= 55);
  // This card always reads the v2 pose comparison (registry provenance tracks pose
  // resemblance specifically, not whichever diagnostic lens is open) — but under loop/root
  // modes that figure is easy to mistake for the currently selected mode's own score, so
  // label it explicitly instead of leaving it looking like the loop/root headline number.
  const modeIndependent = mode === 'loop' || mode === 'root';
  const matchLine = exact
    ? `an exact curve match to a registered asset`
    : pose !== null
      ? `a ${pose}% motion match to a registered asset${modeIndependent ? ' (v2 pose comparison, not this view’s metric)' : ''}`
      : `a match to a registered asset`;
  return (
    <section className="motion-registry-match" data-flagged={flagged ? 'true' : 'false'} aria-label="Registry match">
      <header>
        <span>{flagged ? <ShieldAlert size={16} /> : <BadgeCheck size={16} />}</span>
        <div>
          <small>Registry match · sample</small>
          <strong>{record.assetName}</strong>
        </div>
      </header>
      <p><strong>{candidateName}</strong> is {matchLine}, registered by <strong>{record.owner}</strong>.</p>
      <dl>
        <div><dt>Owner</dt><dd>{record.owner}</dd></div>
        <div><dt>Registered</dt><dd><time dateTime={record.registeredAt}>{formatRegisteredAt(record.registeredAt)}</time></dd></div>
        <div><dt>Animation ID</dt><dd className="mono">{record.animationId}</dd></div>
        <div><dt>License</dt><dd>{record.license}</dd></div>
        <div><dt>Registry ID</dt><dd className="mono">{record.registryId}</dd></div>
      </dl>
      <p className="motion-registry-usage" data-restricted={restricted ? 'true' : 'false'}>{record.usageNote}</p>
      <small className="motion-registry-disclaimer">Sample registry — illustrative records, not a live lookup. A real check searches by fingerprint and returns the owner's record to attach as provenance or reject against.</small>
    </section>
  );
}

export function MotionComparisonLab({ bridgeClient, project }: { bridgeClient: LocalBridgeClient | null; project: LocalProjectSummary | null }) {
  const { preferences } = useWorkspacePreferences();
  const [workspaceMode, setWorkspaceMode] = useState<'pair' | 'project'>('pair');
  const [selectedRigId, setSelectedRigId] = useState('robot');
  const rig = rigById(selectedRigId);
  const [sourceName, setSourceName] = useState(rig.defaultPair[0]);
  const [candidateName, setCandidateName] = useState(rig.defaultPair[1]);
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
  const [pairingList, setPairingList] = useState<LocalPluginPairingSummary[]>([]);
  const [revokingPairingId, setRevokingPairingId] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<LocalMotionComparison[]>([]);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);
  const investigationRef = useRef<HTMLElement>(null);
  const selectedSourceCatalogClip = clipInRig(rig, sourceName) ?? rig.clips[0];
  const selectedCatalogClip = clipInRig(rig, candidateName) ?? rig.clips[0];
  const selectedAnalysisMode = analysisModes.find((item) => item.id === analysisMode) ?? analysisModes[0];
  const effectiveJointScope: MotionJointScope = analysisMode === 'root' ? 'root' : jointScope;
  const visibleCatalog = category === 'All' ? rig.clips : rig.clips.filter((item) => item.category === category);
  const sourceClip = clips.find((clip) => clip.name === sourceName);
  const candidateClip = clips.find((clip) => clip.name === candidateName);
  const result = useMemo(() => sourceClip && candidateClip ? compareClips(sourceClip, candidateClip, {
    mode: analysisMode,
    jointScope: effectiveJointScope,
    sampleCount: preferences.sampleCount,
    reviewThreshold: preferences.reviewThreshold,
  }) : null, [analysisMode, candidateClip, effectiveJointScope, preferences.reviewThreshold, preferences.sampleCount, sourceClip]);
  const latestComparison = comparisons[0];
  // The reference is the "known" side; if it's a registered asset, the score becomes a lead.
  const registryMatch = registryRecordFor(selectedRigId, sourceName);
  const scenarioScores = useMemo(() => {
    const scores: Record<string, { exactCurveData: boolean; primaryValue: number | null } | null> = {};
    for (const scenario of rig.scenarios) {
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
  }, [clips, rig, preferences.sampleCount, preferences.reviewThreshold]);

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

  // The freshly-issued token is the only time it's ever available; this list only ever carries
  // id/issuedAt/expiresAt/status, never the token itself.
  const refreshPairingList = useCallback(() => {
    if (!bridgeClient || !project) {
      setPairingList([]);
      return;
    }
    bridgeClient.listPluginPairings(project.projectId)
      .then((page) => setPairingList(page.items))
      .catch(() => setBridgeMessage('CreatorFlow could not refresh the Studio pairing list.'));
  }, [bridgeClient, project]);

  useEffect(() => { refreshPairingList(); }, [refreshPairingList]);

  async function createPairing() {
    if (!bridgeClient || !project) return;
    setPairingState('creating');
    setBridgeMessage(null);
    try {
      const nextPairing = await bridgeClient.createPluginPairing(project.projectId);
      setPairing(nextPairing);
      setPairingState('idle');
      refreshPairingList();
    } catch {
      setPairingState('error');
      setBridgeMessage('The desktop bridge could not create a Studio pairing. Restart CreatorFlow and try again.');
    }
  }

  async function revokePairing(pairingId: string) {
    if (!bridgeClient || !project) return;
    setRevokingPairingId(pairingId);
    setBridgeMessage(null);
    try {
      const page = await bridgeClient.revokePluginPairing(project.projectId, pairingId);
      setPairingList(page.items);
    } catch {
      setBridgeMessage('The desktop bridge could not revoke that pairing. Try again.');
    } finally {
      setRevokingPairingId(null);
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

  function switchRig(rigId: string) {
    const next = rigById(rigId);
    setSelectedRigId(rigId);
    setSourceName(next.defaultPair[0]);
    setCandidateName(next.defaultPair[1]);
    setCategory('All');
    resetPlayback();
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
    // The Studio project example uses the robot rig's Guide animations.
    const robot = rigById('robot');
    setSelectedRigId('robot');
    const nextCandidate = clipInRig(robot, name) ? name : robot.defaultPair[1];
    setCandidateName(nextCandidate);
    setSourceName(nextCandidate === robot.defaultPair[0] ? robot.defaultPair[1] : robot.defaultPair[0]);
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
        <div className="motion-rig-switch" role="group" aria-label="Choose an animation rig">
          <span className="motion-rig-switch-label">Rig</span>
          {rigFixtures.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === selectedRigId}
              onClick={() => switchRig(option.id)}
              title={option.attribution}
            >
              <strong>{option.name}</strong>
              <small>{option.note}</small>
            </button>
          ))}
          <span className="motion-rig-license">{rig.license}</span>
        </div>
        <MotionScenarioPicker
          sourceName={sourceName}
          candidateName={candidateName}
          onSelect={loadScenario}
          scenarioScores={scenarioScores}
          result={result}
          scenarios={rig.scenarios}
          clipByName={(name) => clipInRig(rig, name)}
        />
        <section className="motion-investigation" ref={investigationRef} aria-label="Animation comparison workbench">
          <div className="motion-view-column">
            <header className="motion-workbench-toolbar">
              <div className="motion-pair-controls">
                <label className="motion-candidate-select motion-reference-select"><span>Reference clip</span><select value={sourceName} onChange={(event) => chooseSource(event.target.value)}>{rig.clips.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><small>{selectedSourceCatalogClip.description}</small></label>
                <button className="motion-swap-pair" type="button" onClick={swapPair} aria-label={`Swap ${sourceName} and ${candidateName}`} title="Swap reference and candidate"><GitCompare size={15} /></button>
                <label className="motion-candidate-select"><span>Candidate clip</span><select value={candidateName} onChange={(event) => chooseCandidate(event.target.value)}>{rig.clips.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><small>{selectedCatalogClip.description}</small></label>
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

            <MotionStage glbUrl={rig.glbUrl} sourceName={sourceName} candidateName={candidateName} analysisMode={analysisMode} previewFocus={previewFocus} previewLayout={previewLayout} showOnion={showOnion} previewQuality={preferences.previewQuality} onReady={setClips} progress={progress} playing={playing} onProgress={setProgress} />

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
            {analysisMode === 'loop' ? <dl className="motion-signal-list"><div><dt>Candidate pose closure</dt><dd>{result?.loop?.candidate.poseClosure ?? '—'}{result?.loop?.candidate.poseClosure !== null && result?.loop?.candidate.poseClosure !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.loop?.candidate.poseClosure ?? 0)} /></div><div><dt>Velocity continuity</dt><dd>{result?.loop?.candidate.velocityContinuity ?? '—'}{result?.loop?.candidate.velocityContinuity !== null && result?.loop?.candidate.velocityContinuity !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.loop?.candidate.velocityContinuity ?? 0)} /></div><div><dt>Scoped joints</dt><dd>{result?.loop?.candidate.tracksAnalyzed ?? '—'}</dd></div></dl> : analysisMode === 'root' ? <dl className="motion-signal-list"><div><dt>Root-path match</dt><dd>{result?.root?.similarity ?? '—'}{result?.root?.similarity !== null && result?.root?.similarity !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.root?.similarity ?? 0)} /></div><div><dt>Candidate travel</dt><dd>{result?.root?.candidate.available ? result.root.candidate.displacement.toFixed(2) : '—'}</dd></div><div><dt>Candidate drift</dt><dd>{result?.root?.candidate.available ? result.root.candidate.drift.toFixed(2) : '—'}</dd><i style={scoreStyle(Math.max(0, 100 - (result?.root?.candidate.drift ?? 0) * 100))} /></div></dl> : analysisMode === 'timing' ? <dl className="motion-signal-list"><div><dt>Authored-time match</dt><dd>{result?.timing ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.timing ?? 0)} /></div><div><dt>Duration delta</dt><dd>{result ? `${result.durationDeltaSeconds >= 0 ? '+' : ''}${result.durationDeltaSeconds.toFixed(2)}s` : '—'}</dd><i style={scoreStyle(result?.durationSimilarity ?? 0)} /></div><div><dt>Joint coverage</dt><dd>{result?.coverage ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl> : <dl className="motion-signal-list"><div><dt>Pose shape</dt><dd>{result?.pose ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.pose ?? 0)} /></div><div><dt>Authored timing</dt><dd>{result?.timing ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.timing ?? 0)} /></div><div><dt>Joint coverage</dt><dd>{result?.coverage ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl>}
            {analysisMode === 'loop' ? <div className="motion-exact-state" data-exact="false"><Check size={14} /><span><strong>Provenance stays outside this quality score</strong><small>{result?.exactCurveData ? 'These clips also have exact curves, but that fact does not change loop continuity.' : 'Loop continuity never raises a similarity or copyright alert.'}</small></span></div> : <div className="motion-exact-state" data-exact={result?.exactCurveData ? 'true' : 'false'}>{result?.exactCurveData ? <AlertTriangle size={14} /> : <Check size={14} />}<span><strong>{result?.exactCurveData ? 'Canonical curves match exactly' : 'No exact curve match'}</strong><small>{result?.exactCurveData ? 'Renaming an export does not change its structural fingerprint.' : 'Pose similarity can still come from common rigs, libraries, or authorized reuse.'}</small></span></div>}
            {registryMatch
              ? <RegistryMatchCard record={registryMatch} candidateName={candidateName} pose={result?.pose ?? null} exact={result?.exactCurveData ?? false} mode={analysisMode} />
              : result ? <p className="motion-registry-miss"><ScanSearch size={13} /><span><strong>Reference not in the sample registry.</strong> No registered owner to attach — a clean result here means "no conflict found," not "proven original."</span></p> : null}
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
            <summary><span><strong>Browse the licensed motion set</strong><small>{rig.clips.length} authored clips · either side can be the reference</small></span><span>{clips.length ? `${clips.length} loaded` : 'Loading…'} <ChevronDown size={15} /></span></summary>
            <section className="motion-corpus-picker" aria-labelledby="motion-corpus-title">
              <header><div><span>Animation test set</span><h2 id="motion-corpus-title">Choose from {rig.clips.length} authored motions.</h2><p>Every candidate is a real clip in the licensed source file—not a renamed score preset.</p></div><strong>{clips.length ? `${clips.length} clips loaded` : 'Loading clips…'}</strong></header>
              <div className="motion-category-filter" role="group" aria-label="Filter animation clips by category">{(['All', 'Locomotion', 'States', 'Actions', 'Gestures'] as const).map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
              <div className="motion-clip-catalog">{visibleCatalog.map((item) => { const loadedClip = clips.find((clip) => clip.name === item.name); return <button key={item.name} type="button" aria-pressed={candidateName === item.name} onClick={() => chooseCandidate(item.name)}><span><strong>{item.name}</strong><small>{item.description}</small></span><em>{loadedClip ? `${loadedClip.duration.toFixed(2)}s` : '—'}</em></button>; })}</div>
              <footer><span>{rig.name} · {rig.license}</span><small>{rig.attribution}</small></footer>
            </section>
          </details>

          <details className="motion-support-drawer">
            <summary><span><strong>Connect Roblox Studio</strong><small>Receive permitted Animation IDs through the local desktop bridge</small></span><span>{bridgeClient && project ? 'Ready' : 'Desktop required'} <ChevronDown size={15} /></span></summary>
            <section className="motion-plugin-intake" aria-labelledby="studio-bridge-title">
              <header><div><span>Studio bridge</span><h2 id="studio-bridge-title">Pair Roblox Studio with this project.</h2><p>The plugin reads two animations you already have permission to access. CreatorFlow revalidates, fingerprints, compares, and stores the evidence on this machine.</p></div><span className={bridgeClient && project ? 'motion-bridge-ready' : 'motion-bridge-demo'}><i />{bridgeClient && project ? `${project.name} ready` : 'Desktop bridge not connected'}</span></header>
              {bridgeClient && project ? <div className="motion-pairing-panel"><div className="motion-pairing-action"><span><strong>1. Create a temporary pairing</strong><small>Scoped to {project.name}; expires automatically.</small></span><button className="button button-secondary" type="button" onClick={() => { void createPairing(); }} disabled={pairingState === 'creating'}>{pairingState === 'creating' ? 'Creating…' : pairing ? 'Rotate pairing' : 'Create pairing'}</button></div>{pairing ? <div className="motion-pairing-fields"><div className="motion-pairing-field"><span>CreatorFlow endpoint <button type="button" onClick={() => { void copyPairing(pairing.endpoint, 'endpoint'); }}>{copiedField === 'endpoint' ? 'Copied' : 'Copy'}</button></span><input aria-label="CreatorFlow endpoint" readOnly value={pairing.endpoint} onFocus={(event) => event.currentTarget.select()} /></div><div className="motion-pairing-field"><span>Pairing token <button type="button" onClick={() => { void copyPairing(pairing.token, 'token'); }}>{copiedField === 'token' ? 'Copied' : 'Copy'}</button></span><input aria-label="CreatorFlow pairing token" readOnly value={pairing.token} onFocus={(event) => event.currentTarget.select()} /></div></div> : <p className="motion-pairing-empty">CreatorFlow will show a loopback address and short-lived token for the Studio plugin. No animation data is sent to a cloud service.</p>}
                <div className="motion-pairing-list">
                  <div className="motion-pairing-list-head">
                    <span><strong>2. Manage pairings</strong><small>{pairingList.length} issued for {project.name}</small></span>
                    <button type="button" className="motion-pairing-refresh" onClick={refreshPairingList}>Refresh</button>
                  </div>
                  {pairingList.length === 0 ? <p className="motion-pairing-empty">No pairings yet for this project.</p> : (
                    <ul className="motion-pairing-rows">
                      {pairingList.map((item) => (
                        <li key={item.id} className="motion-pairing-row" data-tone={pairingStatusTone(item.status)}>
                          <code title={item.id}>…{formatPairingId(item.id)}</code>
                          <span className={`motion-pairing-status tone-${pairingStatusTone(item.status)}`}>{pairingStatusLabel(item.status)}</span>
                          <span className="motion-pairing-timestamps"><small>Issued</small><time dateTime={item.issuedAt}>{new Date(item.issuedAt).toLocaleString()}</time><small>Expires</small><time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleString()}</time></span>
                          {isRevocable(item.status) ? (
                            <button type="button" className="button button-secondary" onClick={() => { void revokePairing(item.id); }} disabled={revokingPairingId !== null}>
                              {revokingPairingId === item.id ? 'Revoking…' : 'Revoke'}
                            </button>
                          ) : <span className="motion-pairing-inactive">—</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div> : <div className="motion-desktop-boundary"><AlertTriangle size={16} /><span><strong>The interactive fixture above still works.</strong><small>To receive real Roblox IDs, launch the CreatorFlow desktop app, open a local project, and return here.</small></span></div>}
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

      <section className="motion-boundary-note"><AlertTriangle size={17} /><div><strong>This is evidence, not a copyright verdict.</strong> <EvidenceBasisMark basis={verificationBasis()} /><p>A high score can result from common walk cycles, shared rigs, mocap libraries, or authorized reuse. A production finding must stay attached to Animation IDs, source files, licenses, authors, dates, and a human decision.</p></div></section>

      <section className="motion-roblox-path">
        <header><span>Roblox Studio bridge · desktop pairing required</span><h2>The plugin supplies the motion; CreatorFlow keeps the evidence.</h2><p>The bridge reads permitted clips and converts poses, transforms, easing, and timing into a normalized record. This web prototype does not include installable Studio or animation-authoring tools.</p></header>
        <div><article><span>Input</span><strong>Two Animation IDs</strong><small>Owned, shared, or otherwise accessible in Studio</small></article><i aria-hidden="true" /><article><span>Studio</span><strong>Resolve permitted clip</strong><small>AnimationClipProvider · normalize locally</small></article><i aria-hidden="true" /><article><span>CreatorFlow</span><strong>Fingerprint and review</strong><small>Exact curves · motion · timing · provenance</small></article></div>
        <footer><span>Permission boundary</span><strong>The plugin cannot fetch restricted animation data or bypass Roblox asset permissions.</strong></footer>
      </section>
    </div>
  );
}
