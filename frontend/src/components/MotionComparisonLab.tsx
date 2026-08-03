import { AlertTriangle, BadgeCheck, Check, ChevronDown, Clock3, Fingerprint, FolderTree, GitCompare, Pause, Play, RotateCcw, ScanSearch, ShieldAlert, StepBack, StepForward } from 'lucide-react';
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
import { DEVIATION_RAMP, NO_DATA_HEX, SIMILARITY_RAMP, rampGradientCss, sampleRampCss, sampleRampInto, type RampSample } from '../motion/ramp';
import { frameIndexAt, frameStops, stepFrame } from '../motion/clipFrames';
import { createCanvasRenderLoop, type CanvasRenderLoop } from '../motion/renderLoop';
import { createStudioScene } from '../motion/sceneFoundation';
import { useWorkspacePreferences } from '../preferences/workspacePreferences';
import { MetadataInspector } from './MetadataInspector';
import { RobloxProjectExample } from './RobloxProjectExample';
import './MotionComparisonLab.premium.css';

type MotionCategory = 'Locomotion' | 'States' | 'Actions' | 'Gestures';
type PreviewLayout = 'side' | 'overlay';

const analysisModes: Array<{ id: MotionAnalysisMode; label: string; detail: string }> = [
  { id: 'shape', label: 'Motion shape', detail: 'Compares the order of poses, ignoring playback speed.' },
  { id: 'timing', label: 'Timing drift', detail: 'Runs both clips on one authored clock to show where timing drifts.' },
  { id: 'loop', label: 'Loop seam', detail: 'Checks whether the end pose and velocity meet the start cleanly.' },
  { id: 'root', label: 'Root path', detail: 'Compares root travel and drift, separately from pose.' },
];

const jointScopes: Array<{ id: MotionJointScope; label: string }> = [
  { id: 'full', label: 'Full body' },
  { id: 'upper', label: 'Upper' },
  { id: 'lower', label: 'Lower' },
  { id: 'root', label: 'Root' },
];

/**
 * Human name for the engine a stored Studio comparison was scored by (#102).
 *
 * The record has always carried `algorithmVersion`; not showing it invited reading two engines'
 * numbers as one scale. Unknown versions fall through verbatim rather than being guessed at — if a
 * future engine string appears, showing it raw is honest and a mapping here is a one-line follow-up.
 */
export function comparisonEngineLabel(algorithmVersion: string): string {
  if (algorithmVersion === 'creatorflow.motion-comparison/v1') return 'desktop v1 engine';
  if (algorithmVersion === 'creatorflow.motion-comparison/v2-web') return 'v2 web engine';
  return algorithmVersion;
}

/**
 * What the engine name MEANS for the reader, or null when there is nothing to warn about.
 *
 * The plugin route now scores on v2 — the same algorithm this lab runs, bound to it by
 * `parity/v2Parity.test.ts` — so for a v2 record there is no discrepancy to explain and claiming one
 * would be its own small lie. The caveat still belongs on **v1** records, which were scored before
 * the route moved and cannot be rescored: those really are a different algorithm, and really cannot
 * see a mirrored copy.
 *
 * This is why the sentence is conditional rather than fixed. An unconditional "the same clips can
 * score differently" was accurate when every plugin comparison came from v1, and became false for
 * new records the moment the route changed.
 */
export function comparisonEngineCaveat(algorithmVersion: string): string | null {
  if (algorithmVersion === 'creatorflow.motion-comparison/v2-web') {
    return 'the same engine the Motion Lab above runs, so these numbers are on one scale.';
  }
  if (algorithmVersion === 'creatorflow.motion-comparison/v1') {
    return 'recorded before the plugin route moved to v2. That is a different algorithm: the same '
      + 'clips can score differently there, and it does not detect mirrored copies.';
  }
  // An unrecognised engine gets no reassurance and no specific warning — only the raw name above.
  return null;
}

export function compareClips(source: AnimationClip, candidate: AnimationClip, options?: MotionAnalysisOptions): MotionAnalysisResult {
  return analyzeMotionClips(source, candidate, options);
}

/**
 * Phase for a trail member, or `null` when that member has no history to show yet.
 *
 * `step` is how many spacings behind the live pose this member sits, so the default of 1 keeps
 * the original single-ghost behaviour exactly: progress - 0.075.
 *
 * This used to clamp to 0, and clamping was the original defect rather than the fix for it. A
 * member clamped to 0 does not sit "at the start" in any useful sense — early in playback the live
 * pose is also near 0, so the ghost lands on top of the rig and reads as "this joint has not
 * moved", which is a claim about the animation and not about the trail. With three members the
 * clamp tripled it: all three stacked on the live pose for the first 22.5% of the clip.
 *
 * Returning null instead means such a member is simply not drawn. The alternative — wrapping to
 * the tail of the clip — would look like history but assert the clip loops, which is false for
 * clips like WalkJump and exactly the kind of invented evidence this view exists to avoid.
 *
 * In loop mode every member pins to 0, because that mode compares the end pose against the start
 * pose and a lagging trail would be answering a different question.
 */
export function trailProgress(mode: MotionAnalysisMode, progress: number, step = 1, spacing = TRAIL_SPACING): number | null {
  if (mode === 'loop') return 0;
  const phase = progress - step * spacing;
  return phase < 0 ? null : phase;
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

/**
 * Hide a trail clone's meshes. The clone stays as a pose source; only its skeleton is drawn.
 *
 * This replaces a full-mesh wireframe onion skin, which was the reason the pose history was
 * unreadable. That version cloned every material with `wireframe: true` and `depthTest: false`,
 * so every edge of the whole skinned robot — including the far side of it — painted over the
 * scene, three times over. Roughly 19,000 line segments of hidden-surface noise per rig.
 *
 * Re-enabling depth testing does not fix it, which is worth recording because it is the obvious
 * first move: a wireframe rasterises edges only and never fills its interior, so it writes almost
 * no depth and has nothing to occlude the far side with. The mesh silhouette was never the point
 * anyway — the question this view answers is where a JOINT was, and the rigs already carry a
 * skeleton representation that says exactly that.
 */
function hideMeshes(group: Group) {
  group.traverse((child) => {
    if (child instanceof Mesh) child.visible = false;
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
interface TrailMember {
  /** Pose source only — its meshes are hidden; the skeleton below is what is drawn. */
  model: Group;
  mixer: AnimationMixer;
  scope: ScopeSkeleton;
  /** Bones this member's clip actually drives, so untracked bones are not drawn in bind pose. */
  animated: Set<string>;
}

const TRAIL_LENGTH = 3;
export const TRAIL_SPACING = 0.075;

/**
 * Per-member opacity, newest first. Absolute values, one per trail slot.
 *
 * The newest ghost sits above the live full-body skeleton's 0.34 because it is the only mark a
 * ghost makes — the meshes are hidden — and a history you have to hunt for is not history. The
 * drop to 0.2 across three members is what encodes which way time runs.
 */
const TRAIL_OPACITY = [0.5, 0.34, 0.2];

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

/**
 * Module-level scratch for the per-segment colour path, which runs ~84 times per frame.
 *
 * `Color.set(NO_DATA_HEX)` re-parsed the same string every call; a prebuilt Color to copy from
 * costs three assignments. Neither is a large win on its own — they are here because this is the
 * one function in the app that runs per segment per rig per frame, and it previously allocated
 * where the version it replaced allocated nothing.
 */
const NO_DATA_COLOR = new Color(NO_DATA_HEX);
const rampSample: RampSample = { r: 0, g: 0, b: 0 };

/**
 * Show or hide a trail member by attaching it to the scene, not by setting `visible`.
 *
 * `visible = false` skips the draw but not the walk: `updateMatrixWorld` recurses into hidden
 * subtrees regardless, so six detached-in-spirit rigs still cost a full matrix compose each per
 * frame — roughly 444 of them on robot-expressive, paid even by someone who has switched the
 * trail off. Detaching removes them from the traversal entirely.
 *
 * The mixer stays bound either way: AnimationMixer drives the object hierarchy directly and does
 * not care whether it is currently parented to the scene.
 */
function setTrailAttached(member: TrailMember, holder: Object3D, attached: boolean) {
  if (attached === (member.model.parent !== null)) return;
  if (attached) holder.add(member.model);
  else member.model.removeFromParent();
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

/**
 * The similarity strip, made draggable.
 *
 * Pointer capture rather than window listeners: the pointer routinely leaves a 16px-tall strip
 * mid-drag, and without capture the scrub would stop the moment it did — the failure that makes a
 * homemade scrubber feel broken next to a video player's.
 */
function FrameScrubber({ scores, progress, onSeek, label }: {
  scores: number[];
  progress: number;
  onSeek: (progress: number) => void;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  return (
    <div
      ref={trackRef}
      className="motion-frame-strip"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={`${Math.round(progress * 100)} percent through the clip`}
      style={{ '--sample-count': scores.length } as CSSProperties}
      onPointerDown={(event) => {
        // Ignore secondary buttons so a right-click context menu does not yank the playhead.
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        seekFromPointer(event.clientX);
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        // Arrow keys are frame stepping at the workbench level; this widget owns coarse seeking,
        // so it takes Home/End and PageUp/PageDown and lets the arrows bubble.
        if (event.key === 'Home') { event.preventDefault(); onSeek(0); }
        else if (event.key === 'End') { event.preventDefault(); onSeek(1); }
        else if (event.key === 'PageUp') { event.preventDefault(); onSeek(Math.min(1, progress + 0.1)); }
        else if (event.key === 'PageDown') { event.preventDefault(); onSeek(Math.max(0, progress - 0.1)); }
      }}
    >
      {scores.map((score, index) => (
        <i key={index} style={scoreStyle(Math.round(score * 100))} title={`Sample ${index + 1}: ${Math.round(score * 100)}% agreement`} />
      ))}
      <span style={{ left: `${progress * 100}%` }} />
    </div>
  );
}

export function updateScopeSkeleton(
  skeleton: ScopeSkeleton,
  scope: MotionJointScope,
  animatedBones: Set<string>,
  deviation?: JointDeviation | null,
  /**
   * Absolute opacity for trail members, which is not a scale of the live value on purpose.
   *
   * The live skeleton runs 0.34 at full-body and 0.92 when scoped to a limb, so a multiplier
   * would make the trail nearly three times more prominent in one scope than the other for no
   * reason the viewer could infer. The trail is the only thing a ghost draws now, so it sets its
   * own legible level and the fade between members carries recency.
   */
  opacityOverride?: number,
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
      sampleRampInto(DEVIATION_RAMP, ratio, rampSample);
      skeleton.scratch.setRGB(rampSample.r / 255, rampSample.g / 255, rampSample.b / 255, SRGBColorSpace);
    } else {
      skeleton.scratch.copy(NO_DATA_COLOR);
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
  skeleton.line.material.opacity = opacityOverride ?? (scope === 'full' ? 0.34 : 0.92);
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

export function MotionStage({ glbUrl, sourceName, candidateName, analysisMode, previewFocus, previewLayout, showOnion, previewQuality, onReady, progress, playing, onProgress }: {
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
    sourceTrail: TrailMember[];
    candidateTrail: TrailMember[];
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
  const renderLoopRef = useRef<CanvasRenderLoop | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  /**
   * Every prop the render reads lives behind a ref, so React re-rendering the stage does not by
   * itself repaint the canvas. Each of these is therefore also a wake-up: without the invalidate
   * a scrub or a view change would sit unseen until something else happened to ask for a frame.
   */
  useEffect(() => {
    progressRef.current = progress;
    renderLoopRef.current?.invalidate();
  }, [progress]);
  useEffect(() => {
    playingRef.current = playing;
    // sync() starts the playing cadence or tears it down. The invalidate buys the one frame a
    // pause still owes: it is the frame that reports the final phase back to the controls, which
    // the throttle would otherwise swallow with no later frame to carry it.
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }, [playing]);
  useEffect(() => {
    selectionRef.current = { sourceName, candidateName, analysisMode, previewFocus, previewLayout, showOnion, previewQuality };
    renderLoopRef.current?.invalidate();
  }, [analysisMode, candidateName, previewFocus, previewLayout, previewQuality, showOnion, sourceName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stopped = false;
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
      const makeTrail = (tint: string) => Array.from({ length: TRAIL_LENGTH }, () => {
        const model = cloneSkeleton(gltf.scene) as Group;
        hideMeshes(model);
        return { model, scope: makeScopeSkeleton(model, new Color(tint)) };
      });
      const sourceGhosts = makeTrail('#e4bd76');
      const candidateGhosts = makeTrail('#75b9e6');
      const box = new Box3().setFromObject(source);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const scale = 2.45 / Math.max(size.x, size.y, size.z, 0.001);
      /**
       * No per-member depth nudge any more. It existed to stop three solid wireframe meshes
       * z-fighting; lines are drawn with depthTest off and separated by opacity and render order
       * instead. Keeping the nudge would now be worse than useless — it would offset each ghost
       * skeleton slightly in Z, so a joint that had not moved at all would still appear to drift,
       * which is a fabricated difference in a view whose whole job is measuring difference.
       */
      const place = (model: Group, side: -1 | 1) => {
        model.scale.setScalar(scale);
        model.position.copy(center).multiplyScalar(-scale);
        model.position.x += side * 1.45;
        holder.add(model);
        model.updateMatrixWorld(true);
      };
      place(source, -1);
      place(candidate, 1);
      sourceGhosts.forEach(({ model }) => place(model, -1));
      candidateGhosts.forEach(({ model }) => place(model, 1));
      const sourceMixer = new AnimationMixer(source);
      const candidateMixer = new AnimationMixer(candidate);
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

      /**
       * Trail members are built here rather than above because `animated` needs the clip, and the
       * clips are only resolved once the GLB has loaded. A member drawn for a bone its clip does
       * not key would show that bone frozen in bind pose — a limb that never moves, which reads as
       * "this joint held still" rather than "this clip says nothing about this joint".
       */
      const buildTrail = (
        ghosts: Array<{ model: Group; scope: ScopeSkeleton }>,
        clip: AnimationClip,
      ): TrailMember[] => ghosts.map(({ model, scope }, step) => {
        const mixer = new AnimationMixer(model);
        playOnce(mixer, clip);
        // Behind the live skeletons (6) and receding, so the newest ghost wins where they cross.
        scope.line.renderOrder = 5 - step;
        scene.add(scope.line);
        return { model, mixer, scope, animated: animatedBoneUuids(model, clip) };
      });
      const sourceTrail = buildTrail(sourceGhosts, sourceClip);
      const candidateTrail = buildTrail(candidateGhosts, candidateClip);
      // Trail members start detached; the render loop attaches the ones that have history to show.
      sourceTrail.forEach((member) => setTrailAttached(member, holder, false));
      candidateTrail.forEach((member) => setTrailAttached(member, holder, false));
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
      // The loop has been idle over an empty scene until now; nothing else will ask for the first
      // frame of the rig, and sync() picks the cadence back up if the stage mounted already playing.
      renderLoopRef.current?.invalidate();
      renderLoopRef.current?.sync();
    }, undefined, () => { if (!stopped) setStatus('error'); });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      renderLoopRef.current?.invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    /**
     * Frame cadence.
     *
     * This is the most expensive viewer in the app — four skinned meshes, two rebuilt skeleton
     * line buffers and eight mixers per frame — so a frame it does not need is the most expensive
     * frame in the app. It runs on the shared scheduler for exactly that reason: while paused and
     * untouched it draws nothing at all, and every wake-up has to be named.
     *
     * The named wake-ups are the props behind the refs above (scrub, playback, selection, layout,
     * quality, trail), the rig arriving, a resize, and the camera. The camera one is why
     * `controls.update()`'s return value is no longer read: OrbitControls dispatches 'change' from
     * inside update() whenever it actually moves the camera, so the tail of a damped orbit keeps
     * invalidating itself frame by frame until it settles, and then stops on its own.
     */
    const render = (now: number) => {
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
          /**
           * The trail members need this too, and getting it wrong fails silently in the worst way.
           * cloneSkeleton mints fresh uuids, so a member holding the previous clip's set — or the
           * live rig's set — matches zero bones, leaves the draw range at 0, and renders nothing.
           * The trail would simply be absent and look like the toggle was off.
           */
          runtime.sourceTrail.forEach((member) => { member.animated = animatedBoneUuids(member.model, desiredSource); });
          runtime.candidateTrail.forEach((member) => { member.animated = animatedBoneUuids(member.model, desiredCandidate); });
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
        if (!selection.showOnion) {
          runtime.sourceTrail.forEach((member) => setTrailAttached(member, holder, false));
          runtime.candidateTrail.forEach((member) => setTrailAttached(member, holder, false));
        }
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
          const place = (trail: TrailMember[], clip: AnimationClip) => {
            trail.forEach((member, step) => {
              // null means this member sits further back than the clip has run: no history to draw.
              const phase = step < drawn ? trailProgress(selection.analysisMode, progressRef.current, step + 1) : null;
              setTrailAttached(member, holder, phase !== null);
              member.scope.line.visible = phase !== null;
              if (phase === null) return;
              member.mixer.setTime(phase * clip.duration);
              // Bone world matrices have to be current before the skeleton reads them.
              member.model.updateMatrixWorld(true);
              /**
               * No deviation colouring on the trail. A ghost is this rig's own past, so the only
               * honest reading is "where this joint was" — colouring it against the other clip
               * would put a measurement on a pose that is not being compared to anything.
               * It fades instead, which encodes recency and nothing else.
               */
              updateScopeSkeleton(member.scope, selection.previewFocus, member.animated, null, TRAIL_OPACITY[step]);
            });
          };
          place(runtime.sourceTrail, runtime.sourceClip);
          place(runtime.candidateTrail, runtime.candidateClip);
        } else {
          runtime.sourceTrail.forEach((member) => { member.scope.line.visible = false; });
          runtime.candidateTrail.forEach((member) => { member.scope.line.visible = false; });
        }
      }
      controls.update();
      renderer.render(scene, camera);
      /**
       * The 90ms throttle exists so playback does not drive a React render per frame, and it can
       * only be a throttle while more frames are coming. A paused stage draws no further frames,
       * so a throttled-away report would be permanent: the phase readout, the slider thumb, the
       * scrubber playhead and the frame-step target would all sit up to 90ms of playback behind
       * the pose actually on the canvas, and stay there. The last frame of a pause always reports.
       */
      if (!playingRef.current || now - lastUi > 90) {
        lastUi = now;
        onProgress(progressRef.current);
      }
    };
    const renderLoop = createCanvasRenderLoop({
      canvas,
      render,
      shouldRenderContinuously: () => playingRef.current,
      // Playback is the only continuous case and it is real animation, so it runs at the display
      // rate rather than on a throttle.
      onActiveChange: () => { last = performance.now(); },
    });
    renderLoopRef.current = renderLoop;
    const onControlsChange = () => renderLoop.invalidate();
    controls.addEventListener('change', onControlsChange);
    renderLoop.invalidate();

    return () => {
      stopped = true;
      renderLoop.dispose();
      if (renderLoopRef.current === renderLoop) renderLoopRef.current = null;
      observer.disconnect();
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      mixersRef.current?.source.stopAllAction();
      mixersRef.current?.candidate.stopAllAction();
      mixersRef.current?.sourceTrail.forEach((member) => member.mixer.stopAllAction());
      mixersRef.current?.candidateTrail.forEach((member) => member.mixer.stopAllAction());
      mixersRef.current?.sourceScope.line.geometry.dispose();
      mixersRef.current?.sourceScope.line.material.dispose();
      mixersRef.current?.candidateScope.line.geometry.dispose();
      mixersRef.current?.candidateScope.line.material.dispose();
      // Trail members are attached only while they have history to draw, so at teardown some of
      // them are outside the holder and dispose(holder) would walk straight past them. Their
      // geometry is cloned per member, so missing one leaks it for the life of the page.
      mixersRef.current?.sourceTrail.forEach((member) => dispose(member.model));
      mixersRef.current?.candidateTrail.forEach((member) => dispose(member.model));
      // Each trail member owns a LineSegments added straight to the scene, so it is outside both
      // the holder and the member's own model — neither dispose() above reaches it.
      [...(mixersRef.current?.sourceTrail ?? []), ...(mixersRef.current?.candidateTrail ?? [])]
        .forEach((member) => {
          member.scope.line.removeFromParent();
          member.scope.line.geometry.dispose();
          member.scope.line.material.dispose();
        });
      mixersRef.current = null;
      dispose(holder);
      studio.dispose();
      renderer.dispose();
    };
  }, [glbUrl, onProgress, onReady]);

  return (
    <div className="motion-compare-stage">
      {/* The canvas is the only carrier of the deviation channel, and colour is its only encoding.
          A label that stops at "3D comparison" leaves a screen-reader user unaware the measurement
          exists at all, so the label names the channel and its ceiling in the same units the
          legend prints. */}
      <canvas ref={canvasRef} aria-label={previewLayout === 'overlay'
        ? `Synchronized 3D comparison of ${sourceName} and ${candidateName}, overlaid. Skeleton joints are coloured by how far apart the two clips place them, from dark at zero to bright at ${JOINT_DEVIATION_CEILING} normalized rig units and above. Joints the candidate clip does not animate are drawn in flat grey as unmeasured.`
        : `Synchronized 3D comparison of ${sourceName} and ${candidateName}, side by side. Switch to overlay to colour joints by measured deviation.`} />
      <div className="motion-stage-grid" aria-hidden="true" />
      <div className="motion-stage-labels" aria-hidden="true"><span>Reference · {sourceName}</span><span>Candidate · {candidateName}</span></div>
      <div className="motion-stage-focus"><span>Skeleton focus</span><strong>{jointScopes.find((item) => item.id === previewFocus)?.label}</strong></div>
      <div className="motion-stage-axis" aria-hidden="true" />
      <div className="motion-stage-calibration" aria-hidden="true"><span>{analysisMode === 'timing' ? 'Shared authored clock' : analysisMode === 'loop' ? 'End pose + start outline' : analysisMode === 'root' ? 'Root translation' : 'Normalized joint space'}</span><span>{previewLayout === 'overlay' ? 'Overlay' : 'Side by side'} · {showOnion ? analysisMode === 'loop' ? 'solid = end pose · skeleton = start pose' : 'skeleton = where joints were' : 'pose trail hidden'}</span></div>
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
      {status === 'loading' ? <div className="motion-stage-state"><span />Loading rig and animation curves…</div> : null}
      {status === 'error' ? <div className="motion-stage-state motion-stage-state-error">This rig file could not be decoded.</div> : null}
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
    return <div className="motion-root-unavailable"><ScanSearch size={17} /><span><strong>Root translation is unavailable.</strong><small>Both clips need a Body, Hips, Pelvis, Root, or HumanoidRootPart position track.</small></span></div>;
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
        /**
         * Floor of 0.35, not 0.22.
         *
         * At 0.22 the oldest segments composite to roughly 2.75:1 against the well — under the 3:1
         * WCAG 1.4.11 requires of a graphical object carrying meaning, and these segments carry
         * where the clip started. 0.35 clears it at about 3.4:1 and still leaves a 3x range for
         * the fade to read as direction.
         */
        opacity={(0.35 + 0.65 * point.progress).toFixed(3)}
      />
    );
  });

  /**
   * Side elevation: the Y channel the top-down plot cannot show.
   *
   * A top-down X/Z projection discards vertical travel entirely, so a jump and a crouch and a walk
   * on the flat all draw the same path. Vertical travel was computed and then only ever printed as
   * a number next to the chart, which is not the same as being visible — a reader comparing two
   * paths has no way to see that one of them leaves the ground.
   *
   * Y against progress, sharing one scale across both clips so their heights are comparable rather
   * than each normalised to its own range. Points are already origin-relative, so 0 is where the
   * clip started and the baseline means "back to standing height".
   */
  const verticalPeak = Math.max(
    0.02,
    ...source.points.map((point) => Math.abs(point.y)),
    ...candidate.points.map((point) => Math.abs(point.y)),
  );
  const projectElevation = (point: { progress: number; y: number }) => ({
    x: 8 + point.progress * 84,
    y: 15 - (point.y / verticalPeak) * 9,
  });
  const toElevation = (path: RootPathClipResult, className: string) => path.points.slice(1).map((point, index) => {
    const from = projectElevation(path.points[index]);
    const to = projectElevation(point);
    return (
      <line
        key={`elev-${className}-${index}`}
        className={className}
        x1={from.x.toFixed(2)}
        y1={from.y.toFixed(2)}
        x2={to.x.toFixed(2)}
        y2={to.y.toFixed(2)}
        // Same floor as the top-down segments, and for the same 1.4.11 reason.
        opacity={(0.35 + 0.65 * point.progress).toFixed(3)}
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
    ? 'Neither clip moves in X/Z, so both paths collapse to a point.'
    : sourceInPlace
      ? `${sourceName} stays at the origin in X/Z; ${candidateName} travels.`
      : candidateInPlace
        ? `${candidateName} stays at the origin in X/Z; ${sourceName} travels.`
        : null;

  return (
    <div className="motion-root-plot">
      <svg viewBox="0 0 100 66" role="img" aria-label={`Top-down root paths for ${sourceName} and ${candidateName}. Each path fades from faint at its start to solid at its end; hollow marker is the first sample, filled is the last.`}>
        <path d="M8 58H92M8 42H92M8 26H92M8 10H92M8 10V58M36 10V58M64 10V58M92 10V58" />
        {toSegments(source, 'source')}
        {toSegments(candidate, 'candidate')}
        {sourceStart ? <circle className="root-start source" cx={sourceStart.x} cy={sourceStart.y} r="1.5" /> : null}
        {candidateStart ? <circle className="root-start candidate" cx={candidateStart.x} cy={candidateStart.y} r="1.5" /> : null}
        {sourceEnd ? <circle className="root-end source" cx={sourceEnd.x} cy={sourceEnd.y} r="1.7" /> : null}
        {candidateEnd ? <circle className="root-end candidate" cx={candidateEnd.x} cy={candidateEnd.y} r="1.7" /> : null}
      </svg>
      <div><span><i className="source" />{sourceName}</span><span><i className="candidate" />{candidateName}</span><small>Top-down X/Z path · origins aligned</small><small>Side elevation · Y against progress · peak {verticalPeak.toFixed(2)}</small><small>{proxyLabel(source.trackName)} · {source.trackName}</small><small>{proxyLabel(candidate.trackName)} · {candidate.trackName}</small></div>
      <dl className="motion-root-metrics">
        <div><dt>{sourceName}</dt><dd><span>Displacement <strong>{source.displacement.toFixed(2)}</strong></span><span>Path length <strong>{source.pathLength.toFixed(2)}</strong></span><span>Drift <strong>{source.drift.toFixed(2)}</strong></span><span>Vertical travel <strong>{source.verticalTravel.toFixed(2)}</strong></span></dd></div>
        <div><dt>{candidateName}</dt><dd><span>Displacement <strong>{candidate.displacement.toFixed(2)}</strong></span><span>Path length <strong>{candidate.pathLength.toFixed(2)}</strong></span><span>Drift <strong>{candidate.drift.toFixed(2)}</strong></span><span>Vertical travel <strong>{candidate.verticalTravel.toFixed(2)}</strong></span></dd></div>
      </dl>
      <svg
        className="motion-root-elevation"
        viewBox="0 0 100 26"
        role="img"
        aria-label={`Side elevation. Vertical travel against clip progress for ${sourceName} and ${candidateName}, sharing one height scale. The centre line is the height each clip started at. Peak vertical travel across both is ${verticalPeak.toFixed(2)}.`}
      >
        <path d="M8 15H92" />
        {toElevation(source, 'source')}
        {toElevation(candidate, 'candidate')}
      </svg>
      {inPlaceCopy ? <p className="motion-root-in-place"><strong>In-place sample:</strong> {inPlaceCopy}{sourceInPlace && candidateInPlace ? ' Root-path match is withheld rather than scored: two paths that both collapse to a point are identical, so any number here would be confident and meaningless.' : ''} Vertical travel is drawn in the side elevation above. A Studio root channel would draw real travel.</p> : null}
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
      ? `a ${pose}% motion match to a registered asset${modeIndependent ? ' (pose match, not this view’s number)' : ''}`
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
      <small className="motion-registry-disclaimer">Sample registry — illustrative records, not a live lookup.</small>
    </section>
  );
}

/**
 * The exactness claim under a stored Studio comparison.
 *
 * `exactCurveData` means the two fingerprints matched. When a side arrived CURVE_SAMPLED that
 * fingerprint describes the plugin's 20-samples-per-second reconstruction of a curve clip, not the
 * authored keyframes a reader hears in "exact canonical curves" — two sampled re-uploads of the
 * same asset match exactly because sampling is deterministic, which says nothing about whether an
 * authored source was copied. Same reason the snapshots panel labels a sampled side: the claim is
 * still true, but it is a claim about the reconstruction, and it has to say so on the surface that
 * makes it. The Studio plugin's own status line says the same thing.
 */
export function evidenceExactnessClaim(comparison: LocalMotionComparison): string {
  if (comparison.mirrored) return 'Similarity found MIRRORED, not as submitted';
  if (!comparison.exactCurveData) return 'Similarity signal';
  const sourceSampled = comparison.sourceKind === 'CURVE_SAMPLED';
  const candidateSampled = comparison.candidateKind === 'CURVE_SAMPLED';
  if (!sourceSampled && !candidateSampled) return 'Exact canonical curves';
  const sides = sourceSampled && candidateSampled ? 'both sides' : sourceSampled ? 'the reference' : 'the candidate';
  return `Exact canonical curves — ${sides} curve-sampled, so this matches the sampled reconstruction, not an authored-keyframe read`;
}

/** The stored-evidence card under the Studio pairing panel. Extracted so it can be rendered in a test. */
export function LatestStudioEvidence({ comparison }: { comparison: LocalMotionComparison }) {
  return (
    <article className="motion-live-result">
      <header><span><i />Latest Studio evidence</span><time dateTime={comparison.createdAt}>{new Date(comparison.createdAt).toLocaleString()}</time></header>
      <div><span><small>Animation IDs</small><strong>{comparison.sourceAssetId} ↔ {comparison.candidateAssetId}</strong></span><span><small>Overall</small><strong>{comparison.overallPercent}%</strong></span><span><small>Pose</small><strong>{comparison.posePercent}%</strong></span><span><small>Timing</small><strong>{comparison.timingPercent}%</strong></span><span><small>Coverage</small><strong>{comparison.coveragePercent}%</strong></span></div>
      <footer><strong>{comparison.verdict}</strong><span>{evidenceExactnessClaim(comparison)} · evidence ID {comparison.id.slice(0, 8)}</span></footer>
      <p className="motion-live-result-engine">Scored by the {comparisonEngineLabel(comparison.algorithmVersion)} at submission{comparisonEngineCaveat(comparison.algorithmVersion) ? <> — {comparisonEngineCaveat(comparison.algorithmVersion)}</> : '.'}</p>
    </article>
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

  /**
   * The positions the transport can stop on: every moment either clip is actually keyed at.
   *
   * Both clips, not just the reference — stepping one grid strands the other's poses. Walking is
   * keyed on 24s and Dance on 81s; because 23 and 80 are coprime, a reference-only grid puts 79
   * of Dance's 81 authored poses out of reach entirely.
   *
   * 'timing' compares on a shared authored clock, so stops map onto the longer duration and mean
   * the same second for both. Every other mode normalises per clip, so a stop is a phase.
   */
  const stops = useMemo(
    () => (sourceClip && candidateClip ? frameStops(sourceClip, candidateClip, analysisMode === 'timing') : []),
    [analysisMode, candidateClip, sourceClip],
  );
  const stopIndex = stops.length ? frameIndexAt(stops, progress) : 0;
  const atFirstStop = !stops.length || progress <= stops[0] + 1e-4;
  const atLastStop = !stops.length || progress >= stops[stops.length - 1] - 1e-4;
  const stepBy = useCallback((delta: number) => {
    if (!stops.length) return;
    // Stepping is for holding a pose still, so it always stops playback.
    setPlaying(false);
    setProgress((current) => stepFrame(stops, current, delta));
  }, [stops]);

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
        if (active) setBridgeMessage('Could not refresh the Studio evidence inbox.');
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
      .catch(() => setBridgeMessage('Could not refresh the pairing list.'));
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
      setBridgeMessage('Could not create a pairing. Restart CreatorFlow and try again.');
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
      setBridgeMessage('Could not revoke that pairing. Try again.');
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
      setBridgeMessage('Clipboard blocked. Select the field and copy it manually.');
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
          <p>Four separate signals: motion shape, authored timing, loop quality, root travel.</p>
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
        {/**
          * Arrow keys step frames. The handler sits here and checks the event target rather than
          * on the canvas: the canvas has no tabIndex, so it can never be activeElement and a
          * listener on it would never fire. Typing in a select or a text field must still move the
          * caret, so those are excluded explicitly.
          */}
        <section
          className="motion-investigation"
          ref={investigationRef}
          aria-label="Animation comparison workbench"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            const tag = (event.target as HTMLElement).tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            event.preventDefault();
            stepBy(event.key === 'ArrowRight' ? 1 : -1);
          }}
        >
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
                <span>{analysisMode === 'root' ? 'Preview focus' : 'Analyze joints'}<small>{analysisMode === 'root' ? 'Score locked to root translation' : 'Updates score and highlight'}</small></span>
                <div>{jointScopes.map((item) => <button key={item.id} type="button" aria-pressed={previewFocus === item.id} onClick={() => chooseJointScope(item.id)}>{item.label}</button>)}</div>
              </div>
              {/* The label has to name the count, and say when the trail is on but has nothing to
                  draw yet — otherwise the first fifth of the clip looks like a broken toggle. */}
              <button className="motion-onion-toggle" type="button" aria-pressed={showOnion} onClick={() => setShowOnion((value) => !value)}><ScanSearch size={15} /><span><strong>{analysisMode === 'loop' ? 'Start-pose outline' : `Pose trail · ${TRAIL_LENGTH} back`}</strong><small>{!showOnion ? 'Trail hidden' : analysisMode === 'loop' ? 'Start pose shown' : trailProgress(analysisMode, progress, 1) === null ? 'No history yet' : `${[1, 2, 3].filter((step) => trailProgress(analysisMode, progress, step) !== null).length} of ${TRAIL_LENGTH} shown`}</small></span></button>
            </header>

            <MotionStage glbUrl={rig.glbUrl} sourceName={sourceName} candidateName={candidateName} analysisMode={analysisMode} previewFocus={previewFocus} previewLayout={previewLayout} showOnion={showOnion} previewQuality={preferences.previewQuality} onReady={setClips} progress={progress} playing={playing} onProgress={setProgress} />

            <div className="motion-compare-transport">
              <button type="button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause synchronized animation comparison' : 'Play synchronized animation comparison'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
              <button type="button" onClick={() => { setProgress(0); setPlaying(false); }} aria-label="Restart synchronized comparison"><RotateCcw size={14} /></button>
              {/* Stepping always pauses. Holding a pose is the entire point of asking for it. */}
              <button type="button" onClick={() => stepBy(-1)} disabled={!stops.length || atFirstStop} aria-label="Previous authored keyframe" title="Previous keyframe (←)"><StepBack size={15} /></button>
              <button type="button" onClick={() => stepBy(1)} disabled={!stops.length || atLastStop} aria-label="Next authored keyframe" title="Next keyframe (→)"><StepForward size={15} /></button>
              <label><span>{analysisMode === 'timing' ? 'Shared authored timeline' : analysisMode === 'loop' ? 'Inspect seam at clip end' : 'Normalized phase'}</span><input type="range" min="0" max="1" step="0.002" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }} /></label>
              {/**
                * Live region, not a bare <output>. Focus stays on the step button after a click,
                * so a value that only announces when the slider has focus would leave a
                * keyboard-or-screen-reader user stepping through poses in silence.
                */}
              <output className="motion-step-readout" role="status" aria-live="polite">
                <strong>{stops.length ? `Key ${stopIndex + 1}/${stops.length}` : '—'}</strong>
                <small>{analysisMode === 'timing' && result ? `${(progress * Math.max(result.sourceDuration, result.candidateDuration)).toFixed(3)}s` : `${Math.round(progress * 100)}% phase`}</small>
              </output>
              <div className="motion-preview-layout" role="group" aria-label="Reference and candidate layout"><button type="button" aria-pressed={previewLayout === 'side'} onClick={() => setPreviewLayout('side')}>Pair side</button><button type="button" aria-pressed={previewLayout === 'overlay'} onClick={() => setPreviewLayout('overlay')}>Pair overlay</button></div>
            </div>

            {analysisMode === 'root' && result?.root ? <RootPathPlot source={result.root.source} candidate={result.root.candidate} sourceName={sourceName} candidateName={candidateName} /> : analysisMode === 'loop' ? <div className="motion-loop-readout"><header><span><RotateCcw size={13} /> Start-to-end continuity</span><small>Higher is cleaner · quality only</small></header><div><span><small>{sourceName}</small><strong>{result?.loop?.source.continuity ?? '—'}{result?.loop?.source.continuity !== null && result?.loop?.source.continuity !== undefined ? '%' : ''}</strong></span><i aria-hidden="true" /><span><small>{candidateName}</small><strong>{result?.loop?.candidate.continuity ?? '—'}{result?.loop?.candidate.continuity !== null && result?.loop?.candidate.continuity !== undefined ? '%' : ''}</strong></span></div></div> : <div className="motion-fingerprint-readout">
              <header><span>{analysisMode === 'timing' ? <Clock3 size={13} /> : <Fingerprint size={13} />} {analysisMode === 'timing' ? 'Authored-time difference' : 'Pose difference over normalized phase'}</span><small>{preferences.sampleCount} samples · brighter marks are closer</small></header>
              {/**
                * The strip is the scrubber. It already showed where the clips agree and where the
                * playhead is, so making it the thing you grab removes the split where the picture
                * of the difference and the control for reaching it were two separate widgets.
                *
                * Column count comes from the data, not a constant. It was hard-coded to 48 while
                * sampleCount is a preference of 24, 48 or 96 — at any other setting the samples
                * wrapped onto a second row, which is the stray block visible under the strip.
                */}
              <FrameScrubber
                scores={result?.frameScores ?? Array.from({ length: preferences.sampleCount }, () => 0)}
                progress={progress}
                onSeek={(next) => { setPlaying(false); setProgress(next); }}
                label={analysisMode === 'timing' ? 'Authored-time similarity samples' : 'Normalized pose similarity samples'}
              />
            </div>}

            <section className="motion-analysis-explainer" data-mode={analysisMode} aria-label={`${selectedAnalysisMode.label} explanation`} aria-live="polite">
              {analysisMode === 'timing' ? <Clock3 size={17} /> : analysisMode === 'loop' ? <RotateCcw size={17} /> : <ScanSearch size={17} />}
              <div><span>{selectedAnalysisMode.label}</span><strong>{selectedAnalysisMode.detail}</strong>{analysisMode === 'timing' ? <p>A shorter clip holds its final pose instead of looping.</p> : analysisMode === 'root' ? <p>Origins are aligned first. Separate from pose resemblance.</p> : null}</div>
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
            <p><strong>{sourceName} ↔ {candidateName}</strong> · {selectedAnalysisMode.label}</p>
            {analysisMode === 'loop' ? <dl className="motion-signal-list"><div><dt>Candidate pose closure</dt><dd>{result?.loop?.candidate.poseClosure ?? '—'}{result?.loop?.candidate.poseClosure !== null && result?.loop?.candidate.poseClosure !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.loop?.candidate.poseClosure ?? 0)} /></div><div><dt>Velocity continuity</dt><dd>{result?.loop?.candidate.velocityContinuity ?? '—'}{result?.loop?.candidate.velocityContinuity !== null && result?.loop?.candidate.velocityContinuity !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.loop?.candidate.velocityContinuity ?? 0)} /></div><div><dt>Scoped joints</dt><dd>{result?.loop?.candidate.tracksAnalyzed ?? '—'}</dd></div></dl> : analysisMode === 'root' ? <dl className="motion-signal-list"><div><dt>Root-path match</dt><dd>{result?.root?.similarity ?? '—'}{result?.root?.similarity !== null && result?.root?.similarity !== undefined ? '%' : ''}</dd><i style={scoreStyle(result?.root?.similarity ?? 0)} /></div><div><dt>Candidate travel</dt><dd>{result?.root?.candidate.available ? result.root.candidate.displacement.toFixed(2) : '—'}</dd></div><div><dt>Candidate drift</dt><dd>{result?.root?.candidate.available ? result.root.candidate.drift.toFixed(2) : '—'}</dd><i style={scoreStyle(Math.max(0, 100 - (result?.root?.candidate.drift ?? 0) * 100))} /></div></dl> : analysisMode === 'timing' ? <dl className="motion-signal-list"><div><dt>Authored-time match</dt><dd>{result?.timing ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.timing ?? 0)} /></div><div><dt>Duration delta</dt><dd>{result ? `${result.durationDeltaSeconds >= 0 ? '+' : ''}${result.durationDeltaSeconds.toFixed(2)}s` : '—'}</dd><i style={scoreStyle(result?.durationSimilarity ?? 0)} /></div><div><dt>Joint coverage</dt><dd>{result?.coverage ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl> : <dl className="motion-signal-list"><div><dt>Pose shape</dt><dd>{result?.pose ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.pose ?? 0)} /></div><div><dt>Authored timing</dt><dd>{result?.timing ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.timing ?? 0)} /></div><div><dt>Joint coverage</dt><dd>{result?.coverage ?? '—'}{result ? '%' : ''}</dd><i style={scoreStyle(result?.coverage ?? 0)} /></div></dl>}
            {analysisMode === 'loop' ? <div className="motion-exact-state" data-exact="false"><Check size={14} /><span><strong>Provenance stays outside this quality score</strong><small>{result?.exactCurveData ? 'Exact curves here too — but loop continuity is unaffected.' : 'Loop continuity never raises a similarity or copyright alert.'}</small></span></div> : <div className="motion-exact-state" data-exact={result?.exactCurveData ? 'true' : 'false'}>{result?.exactCurveData ? <AlertTriangle size={14} /> : <Check size={14} />}<span><strong>{result?.exactCurveData ? 'Canonical curves match exactly' : 'No exact curve match'}</strong><small>{result?.exactCurveData ? 'Renaming an export does not change its structural fingerprint.' : 'Pose similarity can still come from common rigs, libraries, or authorized reuse.'}</small></span></div>}
            {registryMatch
              ? <RegistryMatchCard record={registryMatch} candidateName={candidateName} pose={result?.pose ?? null} exact={result?.exactCurveData ?? false} mode={analysisMode} />
              : result ? <p className="motion-registry-miss"><ScanSearch size={13} /><span><strong>Reference not in the sample registry.</strong> No registered owner to attach. That means "no conflict found," not "proven original."</span></p> : null}
            <button className="motion-jump-difference" type="button" onClick={jumpToLargestDifference} disabled={!result}>{analysisMode === 'loop' ? 'Inspect end seam' : 'Jump to largest difference'}{result && analysisMode !== 'loop' ? <small>{analysisMode === 'timing' ? `${result.largestDifferenceTimeSeconds.toFixed(2)}s` : `${Math.round(result.largestDifferenceProgress * 100)}%`}{result.largestDifferenceJoint ? ` · ${result.largestDifferenceJoint}` : ''}</small> : null}</button>
            <footer className="motion-review-next"><span>{analysisMode === 'loop' ? 'Quality channel' : 'Human review'}</span><strong>{analysisMode === 'loop' ? 'Loop continuity is separate from provenance and similarity.' : 'Attach the source, license, Animation IDs, and a decision before release.'}</strong></footer>
          </aside>
        </section>

        <section className="motion-evidence-grid">
          <article className="motion-joint-evidence">
            <header><div><span>{analysisMode === 'loop' ? 'Seam evidence' : 'Joint evidence'}</span><h2>{analysisMode === 'loop' ? 'Which joints break the loop' : analysisMode === 'root' ? 'Root channel details' : 'Where the movement diverges'}</h2></div><small>{analysisMode === 'root' ? 'Evaluated separately from pose' : 'Lowest-scoring scoped tracks first'}</small></header>
            <div>
              {(result?.trackScores ?? []).map((track) => <div key={track.rawName}><span>{track.name}</span><i><b style={{ width: `${Math.round(track.score * 100)}%` }} /></i><strong>{Math.round(track.score * 100)}%</strong></div>)}
              {!result ? <p>Tracks appear once the rig file is decoded.</p> : result.trackScores.length === 0 ? <p>{analysisMode === 'root' ? 'See the root-path plot above.' : 'No shared tracks in this joint scope.'}</p> : null}
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
            <summary><span><strong>Browse the licensed motion set</strong><small>{rig.clips.length} clips · either can be the reference</small></span><span>{clips.length ? `${clips.length} loaded` : 'Loading…'} <ChevronDown size={15} /></span></summary>
            <section className="motion-corpus-picker" aria-labelledby="motion-corpus-title">
              <header><div><h2 id="motion-corpus-title">Choose from {rig.clips.length} authored motions.</h2></div><strong>{clips.length ? `${clips.length} clips loaded` : 'Loading clips…'}</strong></header>
              <div className="motion-category-filter" role="group" aria-label="Filter animation clips by category">{(['All', 'Locomotion', 'States', 'Actions', 'Gestures'] as const).map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
              <div className="motion-clip-catalog">{visibleCatalog.map((item) => { const loadedClip = clips.find((clip) => clip.name === item.name); return <button key={item.name} type="button" aria-pressed={candidateName === item.name} onClick={() => chooseCandidate(item.name)}><span><strong>{item.name}</strong><small>{item.description}</small></span><em>{loadedClip ? `${loadedClip.duration.toFixed(2)}s` : '—'}</em></button>; })}</div>
              <footer><span>{rig.name} · {rig.license}</span><small>{rig.attribution}</small></footer>
            </section>
          </details>

          <details className="motion-support-drawer">
            <summary><span><strong>Connect Roblox Studio</strong><small>Read permitted Animation IDs locally</small></span><span>{bridgeClient && project ? 'Ready' : 'Desktop required'} <ChevronDown size={15} /></span></summary>
            <section className="motion-plugin-intake" aria-labelledby="studio-bridge-title">
              <header><div><h2 id="studio-bridge-title">Pair Roblox Studio with this project.</h2><p>The plugin reads two animations you already have permission to access. CreatorFlow fingerprints and compares them, and the evidence stays on this machine.</p></div><span className={bridgeClient && project ? 'motion-bridge-ready' : 'motion-bridge-demo'}><i />{bridgeClient && project ? `${project.name} ready` : 'Desktop bridge not connected'}</span></header>
              {bridgeClient && project ? <div className="motion-pairing-panel"><div className="motion-pairing-action"><span><strong>1. Create a temporary pairing</strong><small>Scoped to {project.name}; expires automatically.</small></span><button className="button button-secondary" type="button" onClick={() => { void createPairing(); }} disabled={pairingState === 'creating'}>{pairingState === 'creating' ? 'Creating…' : pairing ? 'Rotate pairing' : 'Create pairing'}</button></div>{pairing ? <div className="motion-pairing-fields"><div className="motion-pairing-field"><span>CreatorFlow endpoint <button type="button" onClick={() => { void copyPairing(pairing.endpoint, 'endpoint'); }}>{copiedField === 'endpoint' ? 'Copied' : 'Copy'}</button></span><input aria-label="CreatorFlow endpoint" readOnly value={pairing.endpoint} onFocus={(event) => event.currentTarget.select()} /></div><div className="motion-pairing-field"><span>Pairing token <button type="button" onClick={() => { void copyPairing(pairing.token, 'token'); }}>{copiedField === 'token' ? 'Copied' : 'Copy'}</button></span><input aria-label="CreatorFlow pairing token" readOnly value={pairing.token} onFocus={(event) => event.currentTarget.select()} /></div></div> : <p className="motion-pairing-empty">A loopback address and short-lived token appear here. No animation data is sent to a cloud service.</p>}
                <div className="motion-pairing-list">
                  <div className="motion-pairing-list-head">
                    <span><strong>2. Manage pairings</strong><small>{pairingList.length} issued for {project.name}</small></span>
                    <button type="button" className="motion-pairing-refresh" onClick={refreshPairingList}>Refresh</button>
                  </div>
                  {pairingList.length === 0 ? <p className="motion-pairing-empty">No pairings yet.</p> : (
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
              </div> : <div className="motion-desktop-boundary"><AlertTriangle size={16} /><span><strong>The demo above still works.</strong><small>For real Roblox IDs, open the CreatorFlow desktop app and a local project.</small></span></div>}
              {bridgeMessage ? <p className="motion-bridge-message" role="status">{bridgeMessage}</p> : null}
              {latestComparison ? <LatestStudioEvidence comparison={latestComparison} /> : bridgeClient && project ? <p className="motion-evidence-inbox-empty">Waiting for the first Studio comparison.</p> : null}
              <section className="motion-authoring-boundary"><AlertTriangle size={17} /><div><strong>Compare here; author and publish in Roblox Studio.</strong><p>CreatorFlow reads the supplied curves without changing them.</p></div><dl><div><dt>Available now</dt><dd>Read · compare · preview · fingerprint</dd></div><div><dt>Not an editor</dt><dd>Rig controls · curve timeline · Roblox upload</dd></div></dl></section>
            </section>
          </details>

          <details className="motion-support-drawer" open={Boolean(bridgeClient && project)}>
            <summary><span><strong>Animation snapshots</strong><small>Pin known-good and published references, track drift</small></span><span>{bridgeClient && project ? 'Ready' : 'Desktop required'} <ChevronDown size={15} /></span></summary>
            <section className="motion-snapshots-intake" aria-label="Animation snapshots">
              <AnimationSnapshotsPanel bridgeClient={bridgeClient} project={project} latestComparison={latestComparison} />
            </section>
          </details>

          <details className="motion-support-drawer">
            <summary><span><strong>Inspect the evidence record</strong><small>Clip metadata · permission · algorithm</small></span><span>Unreviewed <ChevronDown size={15} /></span></summary>
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

      <section className="motion-boundary-note"><AlertTriangle size={17} /><div><strong>This is evidence, not a copyright verdict.</strong> <EvidenceBasisMark basis={verificationBasis()} /><p>A high score can come from common walk cycles, shared rigs, mocap libraries, or authorized reuse.</p></div></section>

      <section className="motion-roblox-path">
        <header><span>Roblox Studio bridge · desktop pairing required</span><h2>The plugin supplies motion; CreatorFlow keeps evidence.</h2><p>The bridge reads permitted clips into a normalized record. This web prototype has no installable Studio tools.</p></header>
        <div><article><span>Input</span><strong>Two Animation IDs</strong><small>Owned, shared, or otherwise accessible in Studio</small></article><i aria-hidden="true" /><article><span>Studio</span><strong>Resolve permitted clip</strong><small>AnimationClipProvider · normalize locally</small></article><i aria-hidden="true" /><article><span>CreatorFlow</span><strong>Fingerprint and review</strong><small>Exact curves · motion · timing · provenance</small></article></div>
        <footer><span>Permission boundary</span><strong>The plugin cannot fetch restricted data or bypass Roblox asset permissions.</strong></footer>
      </section>
    </div>
  );
}
