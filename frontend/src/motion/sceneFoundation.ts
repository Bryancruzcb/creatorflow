import {
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * One place that decides how a CreatorFlow model is lit, graded and grounded.
 *
 * Before this, five components each built their own renderer and light rig by hand. The rigs had
 * drifted apart — the key light was at intensity 3.4, 4.1, 4.2, 4.4 and 4.6 depending on which
 * panel you were looking at — so the same asset was lit differently in every viewer. Pixel-ratio
 * caps had drifted the same way (1.5 / 2 / unset), which on a HiDPI display makes adjacent
 * panels visibly different sharpness.
 *
 * That matters more here than in most products: these viewers are used to compare two models and
 * decide whether one derives from the other. If the two panels light or resolve their subject
 * differently, the tool is introducing a visual difference that is not in the data.
 */

/** Colour pipeline + resolution. Identical everywhere so two panels are directly comparable. */
export function configureStudioRenderer(renderer: WebGLRenderer, options: { maxPixelRatio?: number } = {}) {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 1.75));
}

/**
 * Image-based lighting.
 *
 * There was none anywhere in the app: no environment map, no PMREM, no scene.environment. Every
 * metallic or low-roughness PBR surface in every loaded glTF therefore had nothing to reflect and
 * rendered near-black or flatly diffuse — the largest single fidelity gap in the 3D layer.
 *
 * RoomEnvironment is generated procedurally by three itself, so this adds no downloaded asset and
 * nothing for the subpath deploy to get wrong.
 */
/**
 * Generate the environment once. PMREM prefiltering is the most expensive part of studio setup,
 * and HeavyAssetViewer runs two scenes off one renderer, so the texture is shared rather than
 * built per scene.
 */
export function createStudioEnvironment(renderer: WebGLRenderer) {
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const room = new RoomEnvironment();
  const target = pmrem.fromScene(room, 0.04);

  room.dispose?.();
  pmrem.dispose();

  return {
    texture: target.texture,
    dispose() { target.texture.dispose(); },
  };
}

export function attachStudioEnvironment(renderer: WebGLRenderer, scene: Scene, intensity = 0.55) {
  const environment = createStudioEnvironment(renderer);
  applyStudioEnvironment(scene, environment.texture, intensity);

  return () => {
    environment.dispose();
    scene.environment = null;
  };
}

/** Point a scene at an already-generated environment. */
export function applyStudioEnvironment(scene: Scene, texture: Texture, intensity = 0.55) {
  scene.environment = texture;
  scene.environmentIntensity = intensity;
}

/** The canonical rig: warm key, cool rim, soft hemisphere fill. One set of values, everywhere. */
export function attachStudioLights(scene: Scene) {
  const hemisphere = new HemisphereLight('#edf0e8', '#20251f', 1.5);

  const key = new DirectionalLight('#fff2d4', 2.4);
  key.position.set(4, 6, 5);

  const rim = new DirectionalLight('#7ba8ca', 1.5);
  rim.position.set(-5, 2, -4);

  scene.add(hemisphere, key, rim);

  // Lower than the old hand-tuned values on purpose: with an environment map now contributing,
  // the previous 4.6 key blew out every light surface.
  return () => {
    scene.remove(hemisphere, key, rim);
    hemisphere.dispose();
    key.dispose();
    rim.dispose();
  };
}

/**
 * A soft contact shadow, so models sit in a space rather than float in a void.
 *
 * Painted as a radial-gradient texture on a ground plane rather than rendered with a shadow map.
 * A real shadow map would need every light casting and every mesh receiving, on scenes that can
 * carry 60,000 sampled vertices, for a soft blob that nobody inspects. This costs one 256px
 * canvas and one transparent quad, and reads the same at the sizes these viewers are shown at.
 */
export function createContactShadow(options: { radius?: number; opacity?: number } = {}) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');

  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.62)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.26)');
    gradient.addColorStop(0.78, 'rgba(0,0,0,0.06)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;

  const radius = options.radius ?? 1;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: options.opacity ?? 0.9,
    depthWrite: false,
    side: DoubleSide,
  });
  const geometry = new PlaneGeometry(radius * 2, radius * 2);
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;

  return {
    mesh,
    /** Sit the shadow under a model and scale it to the model's footprint. */
    fit(target: Object3D, centre: { x: number; z: number }, base: number, footprint: number) {
      mesh.position.set(centre.x, base + 0.001, centre.z);
      const scale = Math.max(0.001, footprint / (radius * 2)) * 1.35;
      mesh.scale.set(scale, scale, scale);
      void target;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

/**
 * Everything a viewer needs, in one call. Returns a disposer that unwinds all of it.
 */
export function createStudioScene(renderer: WebGLRenderer, options: {
  background?: string;
  environmentIntensity?: number;
  maxPixelRatio?: number;
} = {}) {
  const scene = new Scene();
  if (options.background) scene.background = new Color(options.background);

  configureStudioRenderer(renderer, { maxPixelRatio: options.maxPixelRatio });
  const detachEnvironment = attachStudioEnvironment(renderer, scene, options.environmentIntensity);
  const detachLights = attachStudioLights(scene);

  const holder = new Group();
  scene.add(holder);

  return {
    scene,
    holder,
    dispose() {
      detachLights();
      detachEnvironment();
      scene.remove(holder);
    },
  };
}
