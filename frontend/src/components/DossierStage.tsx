import { FolderLock, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetUrl } from '../assetUrl';
import {
  DOSSIER_CANDIDATE_CLIP,
  DOSSIER_SOURCE_CLIP,
  buildDossierEvidence,
  jointForMesh,
  type DossierEvidence,
  type JointEvidence,
} from '../dossierEvidence';
import { prefersReducedMotion, watchReducedMotion } from '../motion/preferences';
import { DEVIATION_RAMP, sampleRamp } from '../motion/ramp';
import { createCanvasRenderLoop, type CanvasRenderLoop } from '../motion/renderLoop';
import { createStudioScene } from '../motion/sceneFoundation';
import { StatusMark } from './StatusMark';

/**
 * The landing dossier, as a thing you can look at instead of a thing you have to read.
 *
 * What was here before was three tilted paper sheets and a three-point bullet list making claims
 * about evidence. It described the product accurately and demonstrated none of it: the reader had
 * to take "every exception arrives with context" on faith, having been shown no exception and no
 * context.
 *
 * So this renders the real rig, runs the real comparison engine against two of its clips, and
 * colours the joints the engine flags. The right leg lights up because that is genuinely where
 * WalkJump leaves Walking. Click a glowing part — or its chip, which is the keyboard path — and
 * the panel beside it fills in that joint's evidence and provenance. The claim and the proof are
 * the same object.
 *
 * Lazy-loaded on purpose. three is roughly 600 kB and is otherwise absent from the landing bundle
 * (`ProductWorkspace` code-splits all four of its viewers), so pulling it in eagerly here would
 * have made a marketing page pay the renderer's download cost on first paint.
 */

/** Real provenance for the real file. Read from `public/assets/robot-expressive-license.txt`. */
const PROVENANCE = {
  file: 'RobotExpressive.glb',
  license: 'CC0 1.0 Universal',
  author: 'Tomás Laulhé / Quaternius',
} as const;

const MODEL_URL = 'assets/robot-expressive.glb';
const POSTER_URL = 'assets/robot-expressive-preview.svg';

/** Fit every rig to the same on-screen height, so the framing does not depend on glTF units. */
const TARGET_HEIGHT = 2.5;

/**
 * How much of the frame the rig fills at rest.
 *
 * The rest of it is headroom for the clip, not slack. WalkJump lifts the whole body well above the
 * bounding box the model loads with, so a camera framed tightly on the rest pose crops the head off
 * at exactly the moment the section is trying to draw attention to.
 */
const FRAME_FILL = 0.74;

/**
 * How far the rig's own colour is pulled toward greyscale.
 *
 * Not a stylistic choice. This robot's body material is `baseColorFactor` [0.59, 0.29, 0.04] — a
 * gold almost exactly on top of the warm end of DEVIATION_RAMP, so painting the flagged joints
 * amber over the stock materials produced a gold model with gold highlights and no readable
 * signal. Desaturating the rig gives the ramp somewhere to land. A little chroma is left in so the
 * body still reads as a different material from the grey trim.
 */
const DESATURATION = 0.95;

interface Part {
  mesh: Mesh;
  joint: string;
  evidence: JointEvidence;
  materials: MeshStandardMaterial[];
  /** Ramp colour for this joint's heat, premultiplied to 0-1 channels. */
  tint: { r: number; g: number; b: number };
}

/**
 * Clone before tinting.
 *
 * glTF materials are shared across meshes by design — the robot's fourteen meshes draw on far
 * fewer materials — so writing `emissive` onto the loaded material would light up every part that
 * happens to share it. That reads as the comparison flagging the whole model.
 */
function ownMaterials(mesh: Mesh): MeshStandardMaterial[] {
  const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const cloned = source.map((material) => (material as MeshStandardMaterial).clone());
  mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  return cloned;
}

/** Drop the rig's hue but keep its light-and-dark, so the ramp is the only colour on screen. */
function neutralize(material: MeshStandardMaterial) {
  const colour = material.color;
  const luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
  colour.setRGB(
    (colour.r + (luminance - colour.r) * DESATURATION) * NEUTRAL_ALBEDO,
    (colour.g + (luminance - colour.g) * DESATURATION) * NEUTRAL_ALBEDO,
    (colour.b + (luminance - colour.b) * DESATURATION) * NEUTRAL_ALBEDO,
  );
  // Flat, slightly rough plastic reads more clearly at this size than the rig's stock response.
  material.metalness = Math.min(material.metalness, 0.1);
  material.roughness = Math.max(material.roughness, 0.62);
}

/**
 * Albedo multipliers, solved against measured output rather than guessed.
 *
 * The studio rig is bright — a 2.4 key, a rim, a 1.5 hemisphere and image-based lighting on top —
 * and it multiplies albedo by roughly three in linear light before ACES and the sRGB transfer.
 * Sampling the rendered canvas put the rig's body at rgb(168,168,144), a light beige, when the
 * albedo feeding it was 0.13. Everything below is chosen backwards from the pixel that should come
 * out: an unflagged part near rgb(84,84,84), and the worst joint near rgb(190,176,145).
 *
 * Scaling the ramp rather than using it raw matters for the same reason. Its hot end (#f6d089) is
 * near-white because it was designed to be read as light on a legend; used directly as a surface
 * colour here every flagged joint blew out to the same white and the ordering vanished.
 */
const NEUTRAL_ALBEDO = 0.075;
const ALBEDO_SCALE = 0.1;

export function DossierStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const partsRef = useRef<Part[]>([]);
  const mixerRef = useRef<AnimationMixer | null>(null);
  const clipsRef = useRef<AnimationClip[]>([]);
  const actionRef = useRef<AnimationAction | null>(null);
  const renderLoopRef = useRef<CanvasRenderLoop | null>(null);
  const holderRef = useRef<Object3D | null>(null);
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const spinRef = useRef(true);
  const reducedRef = useRef(false);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [evidence, setEvidence] = useState<DossierEvidence | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [clipName, setClipName] = useState<string>(DOSSIER_SOURCE_CLIP);

  /**
   * Emissive rather than vertex colour.
   *
   * The heavy viewer paints deviation straight onto the mesh because there the model IS the data.
   * Here the robot also has to look like a robot — this is the first 3D a visitor sees — so the
   * flagged joints glow over their own materials instead of replacing them.
   */
  const paint = useCallback(() => {
    partsRef.current.forEach((part) => {
      const isSelected = part.joint === selectedRef.current;
      const isHovered = part.joint === hoveredRef.current;
      const base = 0.08 + 0.32 * part.evidence.heat;
      const intensity = isSelected ? base + 0.5 : isHovered ? base + 0.22 : base;
      part.materials.forEach((material) => {
        material.emissive.setRGB(part.tint.r, part.tint.g, part.tint.b);
        material.emissiveIntensity = intensity;
      });
    });
    renderLoopRef.current?.invalidate();
  }, []);

  useEffect(() => { selectedRef.current = selected; paint(); }, [selected, paint]);
  useEffect(() => { hoveredRef.current = hovered; paint(); }, [hovered, paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let lastFrame = performance.now();
    const reduced = prefersReducedMotion();
    reducedRef.current = reduced;
    spinRef.current = !reduced;

    const camera = new PerspectiveCamera(34, 16 / 10, 0.01, 200);
    // Direction only — `frameCamera` sets the distance once the rig's real size is known.
    camera.position.set(0.42, 0.24, 1).normalize();
    const fitted = { height: TARGET_HEIGHT, width: TARGET_HEIGHT * 0.6 };

    /**
     * Pull back far enough for the rig to fit, in whichever direction runs out first.
     *
     * Recomputed on resize rather than set once: this viewport is a grid cell whose height comes
     * from the evidence panel beside it, so its aspect ratio changes with the panel's content and
     * again at every breakpoint. A fixed camera distance framed the rig correctly at exactly one
     * size and cropped its head and feet at the rest. Only the distance is touched, so a visitor
     * who has orbited the model keeps their angle.
     */
    const frameCamera = () => {
      const halfFov = ((camera.fov * Math.PI) / 180) / 2;
      const forHeight = fitted.height / FRAME_FILL / 2 / Math.tan(halfFov);
      const forWidth = fitted.width / FRAME_FILL / 2 / (Math.tan(halfFov) * Math.max(camera.aspect, 0.2));
      const distance = Math.max(forHeight, forWidth);
      const current = camera.position.length() || 1;
      camera.position.multiplyScalar(distance / current);
      camera.updateProjectionMatrix();
    };
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    const studio = createStudioScene(renderer, { background: '#14171b', environmentIntensity: 0.38 });
    const { scene, holder } = studio;
    holderRef.current = holder;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = 0.6;
    controls.maxPolarAngle = 1.9;
    controls.target.set(0, 0.05, 0);

    new GLTFLoader().load(assetUrl(MODEL_URL), (gltf) => {
      if (disposed) return;
      const box = new Box3().setFromObject(gltf.scene);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      // Normalize on height alone. Using the largest axis lets a wide A-pose decide the scale, so
      // the rig shrinks or grows depending on where its arms happen to be in the bind pose.
      const scale = TARGET_HEIGHT / Math.max(size.y, 0.001);
      gltf.scene.scale.setScalar(scale);
      gltf.scene.position.copy(center).multiplyScalar(-scale);
      holder.add(gltf.scene);
      fitted.height = size.y * scale;
      fitted.width = size.x * scale;
      frameCamera();

      const built = buildDossierEvidence(gltf.animations);
      clipsRef.current = gltf.animations;

      const parts: Part[] = [];
      gltf.scene.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        // Every mesh gets its own materials, not only the flagged ones: the rig draws fourteen
        // meshes from three shared materials, so tinting in place would light up every part that
        // happens to share one. Neutralizing has to reach all of them for the same reason.
        const materials = ownMaterials(child);
        materials.forEach(neutralize);
        const joint = jointForMesh(child);
        const jointEvidence = joint && built ? built.byJoint.get(joint) : undefined;
        if (!joint || !jointEvidence) return;
        const { r, g, b } = sampleRamp(DEVIATION_RAMP, jointEvidence.heat);
        const tint = { r: r / 255, g: g / 255, b: b / 255 };
        /**
         * Flagged joints carry the ramp in their albedo as well as their emissive.
         *
         * Emissive alone puts the whole signal in the highlights, so a limb reading as flagged
         * depended on which way it happened to be facing the key light — the right leg went
         * neutral every time it swung into its own shadow, which is the half of the cycle the
         * jump actually happens in.
         */
        materials.forEach((material) => {
          material.color.setRGB(tint.r * ALBEDO_SCALE, tint.g * ALBEDO_SCALE, tint.b * ALBEDO_SCALE);
        });
        parts.push({ mesh: child, joint, evidence: jointEvidence, materials, tint });
      });
      partsRef.current = parts;

      if (built) {
        setEvidence(built);
        selectedRef.current = built.joints[0]?.joint ?? null;
        setSelected(selectedRef.current);
      }

      const mixer = new AnimationMixer(gltf.scene);
      mixerRef.current = mixer;
      const clip = gltf.animations.find((entry) => entry.name === DOSSIER_SOURCE_CLIP) ?? gltf.animations[0];
      if (clip) {
        const action = mixer.clipAction(clip);
        action.play();
        actionRef.current = action;
        /**
         * Reduced motion still gets a pose, and gets the RIGHT one: the engine reports where the
         * two clips differ most, so the frozen frame is the frame the section is about rather than
         * whatever the clip happens to start on.
         */
        if (reduced) {
          action.paused = true;
          mixer.setTime((built?.peakProgress ?? 0.5) * (clip.duration || 1));
        }
      }
      paint();
      setStatus('ready');
      renderLoopRef.current?.invalidate();
      renderLoopRef.current?.sync();
    }, undefined, () => { if (!disposed) setStatus('error'); });

    const pointer = new Vector2();
    const raycaster = new Raycaster();
    const pick = (event: PointerEvent): string | null => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const meshes = partsRef.current.map((part) => part.mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) return null;
      return partsRef.current.find((part) => part.mesh === hit.object)?.joint ?? null;
    };

    const onMove = (event: PointerEvent) => {
      const joint = pick(event);
      canvas.style.cursor = joint ? 'pointer' : 'grab';
      setHovered(joint);
    };
    const onLeave = () => setHovered(null);
    const onDown = (event: PointerEvent) => {
      const joint = pick(event);
      if (joint) setSelected(joint);
    };
    /** Any deliberate interaction ends the idle spin — fighting a user's drag reads as a bug. */
    const onControlStart = () => { spinRef.current = false; };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerdown', onDown);
    controls.addEventListener('start', onControlStart);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      frameCamera();
      renderLoopRef.current?.invalidate();
    };

    const render = (now: number) => {
      const elapsed = Math.max(0, (now - lastFrame) / 1000);
      const delta = elapsed > 0.25 ? 0 : Math.min(0.05, elapsed);
      lastFrame = now;
      if (!reducedRef.current) {
        mixerRef.current?.update(delta);
        if (spinRef.current) holder.rotation.y += delta * 0.22;
        const active = partsRef.current.find((part) => part.joint === selectedRef.current);
        if (active) {
          const base = 0.08 + 0.32 * active.evidence.heat + 0.5;
          const pulse = base + 0.14 * Math.sin(now / 360);
          active.materials.forEach((material) => { material.emissiveIntensity = pulse; });
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };

    const renderLoop = createCanvasRenderLoop({
      canvas,
      render,
      shouldRenderContinuously: () => !reducedRef.current,
      onActiveChange: () => { lastFrame = performance.now(); },
    });
    renderLoopRef.current = renderLoop;
    const onControlsChange = () => renderLoop.invalidate();
    controls.addEventListener('change', onControlsChange);

    const stopWatchingReducedMotion = watchReducedMotion((next) => {
      reducedRef.current = next;
      if (next) spinRef.current = false;
      if (actionRef.current) actionRef.current.paused = next;
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
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown);
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', onControlsChange);
      observer.disconnect();
      renderLoop.dispose();
      renderLoopRef.current = null;
      controls.dispose();
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      actionRef.current = null;
      partsRef.current.forEach((part) => part.materials.forEach((material) => material.dispose()));
      partsRef.current = [];
      holderRef.current = null;
      studio.dispose();
      renderer.dispose();
    };
  }, [paint]);

  /** Clip switching lives apart from setup so changing it does not rebuild the whole scene. */
  useEffect(() => {
    const mixer = mixerRef.current;
    const clip = clipsRef.current.find((entry) => entry.name === clipName);
    if (!mixer || !clip) return;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    if (reducedRef.current) {
      action.paused = true;
      mixer.setTime((evidence?.peakProgress ?? 0.5) * (clip.duration || 1));
    }
    actionRef.current = action;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }, [clipName, evidence, status]);

  const active = selected && evidence ? evidence.byJoint.get(selected) ?? null : null;

  function resetView() {
    if (holderRef.current) holderRef.current.rotation.y = 0;
    spinRef.current = !reducedRef.current;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }

  return (
    <div className="evidence-rig" data-status={status}>
      <figure className="evidence-rig-viewport">
        <canvas
          ref={canvasRef}
          className="evidence-rig-canvas"
          role="img"
          /**
           * Describes the comparison, not the clip on screen.
           *
           * An earlier version read "playing Walking, 8 joints differ from Walking", because the
           * playing clip and the comparison's source clip are the same by default. The pair is
           * what the reading is of; which half is currently animating is a separate fact.
           */
          aria-label={
            evidence
              ? `${PROVENANCE.file}, playing ${clipName}. Comparing ${evidence.sourceClip} with `
                + `${evidence.candidateClip}: ${evidence.joints.length} joints differ, the largest `
                + `at ${evidence.joints[0]?.label} with ${evidence.joints[0]?.matchPercent}% of the `
                + 'motion shape shared.'
              : 'Loading the sample rig'
          }
        />
        {status !== 'ready' && (
          <div className="evidence-rig-poster" aria-hidden="true">
            <img src={assetUrl(POSTER_URL)} alt="" />
            <span>{status === 'error' ? 'Sample rig unavailable' : 'Loading sample rig'}</span>
          </div>
        )}

        <figcaption className="evidence-rig-transport">
          <div className="evidence-rig-clips" role="group" aria-label="Clip under comparison">
            {[DOSSIER_SOURCE_CLIP, DOSSIER_CANDIDATE_CLIP].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={clipName === name}
                onClick={() => setClipName(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <button type="button" className="evidence-rig-reset" onClick={resetView}>
            <RotateCcw size={14} aria-hidden="true" /> Reset view
          </button>
        </figcaption>
      </figure>

      <aside className="evidence-rig-panel" aria-label="Evidence for the selected joint">
        <header className="evidence-rig-head">
          <p className="evidence-rig-eyebrow">Exceptions</p>
          <p className="evidence-rig-overall">
            {evidence ? `${evidence.overall}% shared shape` : '—'}
            <span>{evidence ? `${evidence.sourceClip} ↔ ${evidence.candidateClip}` : 'reading rig'}</span>
          </p>
        </header>

        <div className="evidence-rig-chips" role="group" aria-label="Joints the comparison flagged">
          {(evidence?.joints ?? []).map((joint) => (
            <button
              key={joint.joint}
              type="button"
              className="evidence-rig-chip"
              aria-pressed={selected === joint.joint}
              onClick={() => setSelected(joint.joint)}
              onMouseEnter={() => setHovered(joint.joint)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(joint.joint)}
              onBlur={() => setHovered(null)}
            >
              <span
                className="evidence-rig-swatch"
                aria-hidden="true"
                style={{ background: `rgb(${Object.values(sampleRamp(DEVIATION_RAMP, joint.heat)).map(Math.round).join(' ')})` }}
              />
              {joint.label}
              <em>{joint.matchPercent}%</em>
            </button>
          ))}
        </div>

        <div className="evidence-rig-detail" aria-live="polite">
          {active ? (
            <>
              <p className="evidence-rig-joint">{active.label}</p>
              <p className="evidence-rig-score">
                <strong>{active.matchPercent}%</strong> motion match
              </p>
            </>
          ) : (
            <p className="evidence-rig-joint">Select a flagged joint</p>
          )}
        </div>

        <dl className="evidence-rig-meta">
          <div><dt>Source</dt><dd>{PROVENANCE.file}</dd></div>
          <div><dt>Author</dt><dd>{PROVENANCE.author}</dd></div>
          <div><dt>Permission</dt><dd>{PROVENANCE.license}</dd></div>
          <div><dt>Decision</dt><dd><StatusMark value="review" compact /> Review open</dd></div>
        </dl>

        <p className="evidence-rig-local">
          <FolderLock size={15} aria-hidden="true" />
          Files stay on your machine. Registries receive fingerprints only.
        </p>
      </aside>
    </div>
  );
}

export default DossierStage;
