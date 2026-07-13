import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  BufferAttribute,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { HeavyComponentMatch } from '../heavyAssets';
import { watchReducedMotion } from '../motion/preferences';
import { createCanvasRenderLoop, type CanvasRenderLoop } from '../motion/renderLoop';

const EMPTY_COMPONENT_MATCHES: HeavyComponentMatch[] = [];

interface HeavyAssetViewerProps {
  assetId?: string;
  url: string;
  label: string;
  previewUrl: string;
  size: string;
  componentMatches?: HeavyComponentMatch[];
  selectedComponentId?: string | null;
  onSelectComponent?: (id: string) => void;
  onSceneIndex?: (nodes: SceneTreeNode[]) => void;
  focusedSceneNodeId?: string | null;
  matchMapEnabled?: boolean;
  differenceMode?: DifferenceViewMode;
  comparisonActive?: boolean;
  comparisonMode?: ComparisonViewMode;
  comparisonSourceUrl?: string;
}

export type DifferenceViewMode = 'highlight' | 'ghost' | 'isolate';
export type ComparisonViewMode = 'side' | 'overlay' | 'blink' | 'heatmap';

export interface SceneTreeNode {
  id: string;
  parentId?: string;
  name: string;
  type: 'scene' | 'group' | 'mesh';
  depth: number;
  childCount: number;
  matchCount: number;
  matchIds: string[];
  triangleCount?: number;
  visible?: boolean;
}

interface SceneBudget {
  triangles: number;
  drawCalls: number;
  geometryMb: number;
  textureMb: number;
  estimatedGpuMb: number;
}

interface HeatmapStats {
  mean: number;
  maximum: number;
  samples: number;
}

interface RenderPassStats {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

interface RuntimeTelemetry {
  fps: number;
  p95FrameMs: number;
  cpuSubmitMs: number;
  main: RenderPassStats;
  total: RenderPassStats;
  geometries: number;
  textures: number;
  programs: number;
}

interface GpuDeviceInfo {
  renderer: string;
  vendor: string;
  maxTextureSize: number;
  maxSamples: number;
  precision: string;
  webglVersion: string;
}

type StoredMaterial = Material | Material[];
type SurfaceMaterial = Material & {
  color?: Color;
  emissive?: Color;
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  roughness?: number;
  transmission?: number;
};

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

function findNode(root: Object3D, names: string[]) {
  for (const name of names) {
    const node = root.getObjectByName(name);
    if (node) return node;
  }
  return null;
}

function markMatchable(root: Object3D, matchId: string) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const ids = (child.userData.componentMatchIds as string[] | undefined) ?? [];
    if (!ids.includes(matchId)) ids.push(matchId);
    child.userData.componentMatchIds = ids;
  });
}

function focusedClone(object: Object3D, x: number) {
  const clone = object.clone(true);
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.scale.set(1, 1, 1);
  const content = new Group();
  content.add(clone);
  content.updateMatrixWorld(true);
  const rawSize = new Box3().setFromObject(content).getSize(new Vector3());
  if (rawSize.z > rawSize.x * 1.08) clone.rotation.y = Math.PI / 2;
  content.updateMatrixWorld(true);
  const box = new Box3().setFromObject(content);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  clone.position.sub(center);
  const wrapper = new Group();
  const scale = 1.85 / Math.max(size.x, size.y, size.z, 0.001);
  content.scale.setScalar(scale);
  wrapper.position.x = x;
  wrapper.add(content);
  return wrapper;
}

function cloneStyledMaterial(source: Material, tint: string, blend: number, opacity = 1) {
  const material = source.clone() as SurfaceMaterial;
  const color = new Color(tint);
  material.color?.lerp(color, blend);
  if (material.emissive) {
    material.emissive.copy(color);
    material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, blend * 0.82);
  }
  material.transparent = opacity < 0.99;
  material.opacity = opacity;
  material.depthWrite = opacity >= 0.72;
  if (opacity < 0.5) {
    if (typeof material.transmission === 'number') material.transmission = 0;
    if (typeof material.roughness === 'number') material.roughness = Math.max(material.roughness, 0.82);
  }
  material.needsUpdate = true;
  return material;
}

function styleClone(root: Object3D, tint: string, opacity: number, renderOrder: number, materials: Set<Material>) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const originals = Array.isArray(child.material) ? child.material : [child.material];
    const styled = originals.map((material) => cloneStyledMaterial(material, tint, 0.62, opacity));
    styled.forEach((material) => materials.add(material));
    child.material = Array.isArray(child.material) ? styled : styled[0];
    child.renderOrder = renderOrder;
  });
}

function triangleCount(mesh: Mesh) {
  const geometry = mesh.geometry;
  return Math.floor((geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3);
}

function buildSceneIndex(root: Object3D, nodeMap: Map<string, Object3D>) {
  const nodes: SceneTreeNode[] = [];
  const walk = (object: Object3D, parentId: string | undefined, depth: number): string[] => {
    nodeMap.set(object.uuid, object);
    const ownMatchIds = object instanceof Mesh ? ((object.userData.componentMatchIds as string[] | undefined) ?? []) : [];
    const entry: SceneTreeNode = {
      id: object.uuid,
      parentId,
      name: object.name || (depth === 0 ? 'Scene root' : object instanceof Mesh ? 'Unnamed mesh' : 'Unnamed group'),
      type: depth === 0 ? 'scene' : object instanceof Mesh ? 'mesh' : 'group',
      depth,
      childCount: object.children.length,
      matchCount: 0,
      matchIds: [],
      triangleCount: object instanceof Mesh ? triangleCount(object) : undefined,
      visible: object.visible,
    };
    nodes.push(entry);
    const descendantIds = object.children.flatMap((child) => walk(child, object.uuid, depth + 1));
    entry.matchIds = Array.from(new Set([...ownMatchIds, ...descendantIds]));
    entry.matchCount = entry.matchIds.length;
    return entry.matchIds;
  };
  walk(root, undefined, 0);
  return nodes;
}

function estimateSceneBudget(root: Object3D): SceneBudget {
  const geometries = new Set<string>();
  const textures = new Map<string, Texture>();
  const arrays = new Set<ArrayBufferLike>();
  let geometryBytes = 0;
  let triangles = 0;
  let drawCalls = 0;
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    drawCalls += Array.isArray(child.material) ? child.material.length : 1;
    triangles += triangleCount(child);
    if (!geometries.has(child.geometry.uuid)) {
      geometries.add(child.geometry.uuid);
      const attributes = Object.values(child.geometry.attributes) as Array<BufferAttribute | { data: { array: { buffer: ArrayBufferLike; byteLength: number } } }>;
      if (child.geometry.index) attributes.push(child.geometry.index);
      attributes.forEach((attribute) => {
        const array = 'array' in attribute ? attribute.array : attribute.data.array;
        if (!arrays.has(array.buffer)) {
          arrays.add(array.buffer);
          geometryBytes += array.byteLength;
        }
      });
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof Texture) textures.set(value.uuid, value);
      });
    });
  });
  let textureBytes = 0;
  textures.forEach((texture) => {
    const image = texture.image as { width?: number; height?: number } | undefined;
    textureBytes += (image?.width ?? 1) * (image?.height ?? 1) * 4 * 1.33;
  });
  const geometryMb = geometryBytes / 1_000_000;
  const textureMb = textureBytes / 1_000_000;
  return { triangles, drawCalls, geometryMb, textureMb, estimatedGpuMb: geometryMb + textureMb };
}

function collectWorldPoints(root: Object3D, limit = 60_000) {
  root.updateMatrixWorld(true);
  let total = 0;
  root.traverse((child) => {
    if (child instanceof Mesh) total += child.geometry.getAttribute('position')?.count ?? 0;
  });
  const stride = Math.max(1, Math.ceil(total / limit));
  const points: Vector3[] = [];
  const point = new Vector3();
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const position = child.geometry.getAttribute('position');
    if (!position) return;
    for (let index = 0; index < position.count; index += stride) {
      point.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
      points.push(point.clone());
    }
  });
  return points;
}

function applyDeviationHeatmap(project: Group, source: Group, materials: Set<Material>, geometries: Set<Mesh['geometry']>): HeatmapStats {
  const sourcePoints = collectWorldPoints(source);
  const cellSize = 0.055;
  const grid = new Map<string, number[]>();
  const keyFor = (x: number, y: number, z: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}:${Math.floor(z / cellSize)}`;
  sourcePoints.forEach((point) => {
    const key = keyFor(point.x, point.y, point.z);
    const bucket = grid.get(key) ?? [];
    bucket.push(point.x, point.y, point.z);
    grid.set(key, bucket);
  });
  const cold = new Color('#598fbe');
  const warm = new Color('#dfad52');
  const hot = new Color('#d15d49');
  const point = new Vector3();
  let sum = 0;
  let maximum = 0;
  let samples = 0;
  project.updateMatrixWorld(true);
  project.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry.clone();
    geometries.add(geometry);
    child.geometry = geometry;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld);
      const cellX = Math.floor(point.x / cellSize);
      const cellY = Math.floor(point.y / cellSize);
      const cellZ = Math.floor(point.z / cellSize);
      let minimumSquared = Number.POSITIVE_INFINITY;
      for (let radius = 0; radius <= 2; radius += 1) {
        for (let x = -radius; x <= radius; x += 1) for (let y = -radius; y <= radius; y += 1) for (let z = -radius; z <= radius; z += 1) {
          const bucket = grid.get(`${cellX + x}:${cellY + y}:${cellZ + z}`);
          if (!bucket) continue;
          for (let offset = 0; offset < bucket.length; offset += 3) {
            const dx = point.x - bucket[offset];
            const dy = point.y - bucket[offset + 1];
            const dz = point.z - bucket[offset + 2];
            minimumSquared = Math.min(minimumSquared, dx * dx + dy * dy + dz * dz);
          }
        }
      }
      const distance = Number.isFinite(minimumSquared) ? Math.sqrt(minimumSquared) : 0.12;
      const ratio = Math.min(1, distance / 0.12);
      const color = new Color();
      if (ratio < 0.5) color.lerpColors(cold, warm, ratio * 2);
      else color.lerpColors(warm, hot, (ratio - 0.5) * 2);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sum += distance;
      maximum = Math.max(maximum, distance);
      samples += 1;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    materials.add(material);
    child.material = material;
  });
  source.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const material = new MeshBasicMaterial({ color: '#d7d9d2', wireframe: true, transparent: true, opacity: 0.12, depthWrite: false });
    materials.add(material);
    child.material = material;
    child.renderOrder = 2;
  });
  return { mean: samples ? sum / samples : 0, maximum, samples };
}

export function HeavyAssetViewer({
  assetId,
  url,
  label,
  previewUrl,
  size,
  componentMatches = EMPTY_COMPONENT_MATCHES,
  selectedComponentId,
  onSelectComponent,
  onSceneIndex,
  focusedSceneNodeId,
  matchMapEnabled = false,
  differenceMode = 'highlight',
  comparisonActive = false,
  comparisonMode = 'side',
  comparisonSourceUrl,
}: HeavyAssetViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const holderRef = useRef<Group | null>(null);
  const rootRef = useRef<Group | null>(null);
  const loaderRef = useRef<GLTFLoader | null>(null);
  const comparisonGroupRef = useRef<Group | null>(null);
  const miniSceneRef = useRef<Scene | null>(null);
  const miniCameraRef = useRef<PerspectiveCamera | null>(null);
  const comparisonPairRef = useRef<{ project: Group; source: Group } | null>(null);
  const sourceCacheRef = useRef(new Map<string, Group>());
  const nodeMapRef = useRef(new Map<string, Object3D>());
  const sceneNodeMapRef = useRef(new Map<string, Object3D>());
  const allMeshesRef = useRef<Mesh[]>([]);
  const originalMaterialsRef = useRef(new Map<Mesh, StoredMaterial>());
  const styledMaterialsRef = useRef(new Set<Material>());
  const comparisonMaterialsRef = useRef(new Set<Material>());
  const comparisonGeometriesRef = useRef(new Set<Mesh['geometry']>());
  const onSelectRef = useRef(onSelectComponent);
  const onSceneIndexRef = useRef(onSceneIndex);
  const matchMapRef = useRef(matchMapEnabled);
  const selectedComponentRef = useRef(selectedComponentId);
  const comparisonModeRef = useRef(comparisonMode);
  const reducedMotionRef = useRef(false);
  const budgetOpenRef = useRef(false);
  const renderLoopRef = useRef<CanvasRenderLoop | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [comparisonStatus, setComparisonStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [budget, setBudget] = useState<SceneBudget | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [runtimeTelemetry, setRuntimeTelemetry] = useState<RuntimeTelemetry | null>(null);
  const [gpuDeviceInfo, setGpuDeviceInfo] = useState<GpuDeviceInfo | null>(null);
  const [heatmapStats, setHeatmapStats] = useState<HeatmapStats | null>(null);
  const [miniMarker, setMiniMarker] = useState<{ x: number; y: number } | null>(null);
  const selectedMatch = componentMatches.find((match) => match.id === selectedComponentId);

  useEffect(() => { onSelectRef.current = onSelectComponent; }, [onSelectComponent]);
  useEffect(() => { onSceneIndexRef.current = onSceneIndex; }, [onSceneIndex]);
  useEffect(() => { matchMapRef.current = matchMapEnabled; }, [matchMapEnabled]);
  useEffect(() => { selectedComponentRef.current = selectedComponentId; }, [selectedComponentId]);
  useEffect(() => {
    comparisonModeRef.current = comparisonMode;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }, [comparisonMode]);
  useEffect(() => {
    budgetOpenRef.current = budgetOpen;
    renderLoopRef.current?.invalidate();
    renderLoopRef.current?.sync();
  }, [budgetOpen]);

  function restoreSceneMaterials() {
    originalMaterialsRef.current.forEach((material, mesh) => {
      mesh.material = material;
      mesh.visible = true;
    });
    styledMaterialsRef.current.forEach((material) => material.dispose());
    styledMaterialsRef.current.clear();
  }

  function clearComparison() {
    comparisonMaterialsRef.current.forEach((material) => material.dispose());
    comparisonMaterialsRef.current.clear();
    comparisonGeometriesRef.current.forEach((geometry) => geometry.dispose());
    comparisonGeometriesRef.current.clear();
    comparisonPairRef.current = null;
    comparisonGroupRef.current?.clear();
  }

  function focusObject(object: Object3D | undefined) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!object || !camera || !controls) return;
    object.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.15);
    const direction = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(center);
    camera.position.copy(center).add(direction.multiplyScalar(Math.max(radius * 3.2, 1.25)));
    controls.update();
    renderLoopRef.current?.invalidate();
  }

  function styleSceneMesh(mesh: Mesh, tint: string, blend: number, opacity = 1) {
    const stored = originalMaterialsRef.current.get(mesh);
    if (!stored) return;
    const originals = Array.isArray(stored) ? stored : [stored];
    const styled = originals.map((material) => cloneStyledMaterial(material, tint, blend, opacity));
    styled.forEach((material) => styledMaterialsRef.current.add(material));
    mesh.material = Array.isArray(stored) ? styled : styled[0];
  }

  function setView(view: 'iso' | 'front' | 'top') {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.up.set(0, 1, 0);
    if (view === 'front') camera.position.set(0, 0.1, 4.1);
    if (view === 'top') {
      camera.up.set(0, 0, -1);
      camera.position.set(0, 4.1, 0.001);
    }
    if (view === 'iso') camera.position.set(2.75, 1.55, 3.45);
    controls.target.set(0, 0, 0);
    controls.update();
    renderLoopRef.current?.invalidate();
  }

  function focusSelection() {
    if (!selectedComponentId) return;
    focusObject(nodeMapRef.current.get(selectedComponentId));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus('loading');
    setProgress(0);
    setBudget(null);
    setComparisonStatus('idle');
    setHeatmapStats(null);
    setRuntimeTelemetry(null);
    setGpuDeviceInfo(null);
    let disposed = false;
    let pointerStart = new Vector2();
    const scene = new Scene();
    scene.background = new Color('#171916');
    scene.add(new HemisphereLight('#f1eee2', '#20261f', 2.6));
    const key = new DirectionalLight('#fff3d5', 4.4);
    key.position.set(4, 5, 6);
    scene.add(key);
    const rim = new DirectionalLight('#7ca8d2', 2.5);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const holder = new Group();
    holder.rotation.y = -0.32;
    scene.add(holder);
    const comparisonGroup = new Group();
    comparisonGroup.visible = false;
    scene.add(comparisonGroup);
    const miniScene = new Scene();
    miniScene.background = new Color('#101310');
    miniScene.add(new HemisphereLight('#e8e7df', '#1f2821', 2.4));
    const miniKey = new DirectionalLight('#fff0cd', 3.2);
    miniKey.position.set(4, 5, 6);
    miniScene.add(miniKey);
    const miniHolder = new Group();
    miniHolder.rotation.y = -0.32;
    miniScene.add(miniHolder);
    const miniCamera = new PerspectiveCamera(35, 1.6, 0.01, 200);
    miniCamera.position.set(2.75, 1.55, 3.45);
    miniCamera.lookAt(0, 0, 0);
    const camera = new PerspectiveCamera(35, 16 / 9, 0.01, 200);
    camera.position.set(2.75, 1.55, 3.45);
    camera.lookAt(0, 0, 0);
    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.info.autoReset = false;
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_VENDOR_WEBGL: number;
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    setGpuDeviceInfo({
      renderer: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : 'Detailed renderer hidden by browser',
      vendor: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
        : 'Detailed vendor hidden by browser',
      maxTextureSize: renderer.capabilities.maxTextureSize,
      maxSamples: renderer.capabilities.maxSamples,
      precision: renderer.capabilities.precision,
      webglVersion: renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1',
    });
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.45;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI;
    controls.target.set(0, 0, 0);
    controls.update();
    cameraRef.current = camera;
    controlsRef.current = controls;
    sceneRef.current = scene;
    holderRef.current = holder;
    comparisonGroupRef.current = comparisonGroup;
    miniSceneRef.current = miniScene;
    miniCameraRef.current = miniCamera;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/decoders/draco/');
    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath('/decoders/basis/');
    ktx2Loader.detectSupport(renderer);
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.setKTX2Loader(ktx2Loader);
    loaderRef.current = loader;
    loader.load(
      url,
      (gltf) => {
        if (disposed) {
          dispose(gltf.scene);
          return;
        }
        const box = new Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new Vector3());
        const sizeVector = box.getSize(new Vector3());
        const scale = 2.4 / Math.max(sizeVector.x, sizeVector.y, sizeVector.z, 0.001);
        gltf.scene.scale.setScalar(scale);
        gltf.scene.position.copy(center).multiplyScalar(-scale);
        holder.add(gltf.scene);
        miniHolder.add(gltf.scene.clone(true));
        rootRef.current = gltf.scene;
        allMeshesRef.current = [];
        originalMaterialsRef.current.clear();
        gltf.scene.traverse((child) => {
          if (!(child instanceof Mesh)) return;
          allMeshesRef.current.push(child);
          originalMaterialsRef.current.set(child, child.material);
        });
        setBudget(estimateSceneBudget(gltf.scene));
        setProgress(100);
        setStatus('ready');
        renderLoopRef.current?.invalidate();
      },
      (event) => {
        if (!event.total || disposed) return;
        setProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      },
      () => { if (!disposed) setStatus('error'); },
    );

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderLoopRef.current?.invalidate();
    };
    let previousFrameAt = performance.now();
    let lastTelemetryAt = previousFrameAt;
    const frameSamples: number[] = [];
    const cpuSamples: number[] = [];
    const readRenderStats = (): RenderPassStats => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      points: renderer.info.render.points,
    });
    const render = () => {
      if (disposed) return;
      const now = performance.now();
      const frameMs = now - previousFrameAt;
      previousFrameAt = now;
      if (!document.hidden && frameMs > 0 && frameMs < 250) {
        frameSamples.push(frameMs);
        if (frameSamples.length > 240) frameSamples.shift();
      }
      const submitStartedAt = performance.now();
      const pair = comparisonPairRef.current;
      if (pair) {
        const shouldBlink = comparisonModeRef.current === 'blink' && !reducedMotionRef.current && !document.hidden;
        const showProject = Math.floor(performance.now() / 850) % 2 === 0;
        pair.project.visible = !shouldBlink || showProject;
        pair.source.visible = !shouldBlink || !showProject;
      }
      renderer.info.reset();
      controls.update();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, canvas.clientWidth, canvas.clientHeight);
      renderer.render(scene, camera);
      const mainStats = readRenderStats();
      if (selectedComponentRef.current && !comparisonPairRef.current && canvas.clientWidth > 620) {
        const mapWidth = Math.min(176, Math.floor(canvas.clientWidth * 0.24));
        const mapHeight = 108;
        const inset = 14;
        renderer.clearDepth();
        renderer.setScissorTest(true);
        renderer.setViewport(inset, inset, mapWidth, mapHeight);
        renderer.setScissor(inset, inset, mapWidth, mapHeight);
        miniCamera.aspect = mapWidth / mapHeight;
        miniCamera.updateProjectionMatrix();
        renderer.render(miniScene, miniCamera);
        renderer.setScissorTest(false);
      }
      const totalStats = readRenderStats();
      cpuSamples.push(performance.now() - submitStartedAt);
      if (cpuSamples.length > 240) cpuSamples.shift();
      if (now - lastTelemetryAt >= 1000 && frameSamples.length && cpuSamples.length) {
        const ordered = [...frameSamples].sort((a, b) => a - b);
        const averageFrameMs = frameSamples.reduce((sum, sample) => sum + sample, 0) / frameSamples.length;
        const averageCpuMs = cpuSamples.reduce((sum, sample) => sum + sample, 0) / cpuSamples.length;
        setRuntimeTelemetry({
          fps: 1000 / averageFrameMs,
          p95FrameMs: ordered[Math.floor((ordered.length - 1) * 0.95)],
          cpuSubmitMs: averageCpuMs,
          main: mainStats,
          total: totalStats,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
        });
        frameSamples.length = 0;
        cpuSamples.length = 0;
        lastTelemetryAt = now;
      }
    };
    const renderLoop = createCanvasRenderLoop({
      canvas,
      render,
      shouldRenderContinuously: () => budgetOpenRef.current || (
        comparisonModeRef.current === 'blink'
        && Boolean(comparisonPairRef.current)
        && !reducedMotionRef.current
      ),
      // The expanded performance panel samples the real display cadence; the
      // otherwise-static blink comparison only needs a low-frequency wake-up.
      continuousFrameIntervalMs: () => budgetOpenRef.current ? 0 : 100,
      onActiveChange: () => {
        previousFrameAt = performance.now();
        frameSamples.length = 0;
        cpuSamples.length = 0;
      },
    });
    renderLoopRef.current = renderLoop;
    const onControlsChange = () => renderLoop.invalidate();
    controls.addEventListener('change', onControlsChange);
    const stopWatchingReducedMotion = watchReducedMotion((reduced) => {
      reducedMotionRef.current = reduced;
      renderLoop.invalidate();
      renderLoop.sync();
    });
    const down = (event: PointerEvent) => { pointerStart = new Vector2(event.clientX, event.clientY); };
    const up = (event: PointerEvent) => {
      if (!matchMapRef.current || pointerStart.distanceTo(new Vector2(event.clientX, event.clientY)) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(holder.children, true).find((entry) => (entry.object.userData.componentMatchIds as string[] | undefined)?.length);
      const ids = hit?.object.userData.componentMatchIds as string[] | undefined;
      if (ids?.length) onSelectRef.current?.(selectedComponentRef.current && ids.includes(selectedComponentRef.current) ? selectedComponentRef.current : ids[0]);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    resize();
    renderLoop.invalidate();
    return () => {
      disposed = true;
      stopWatchingReducedMotion();
      renderLoop.dispose();
      if (renderLoopRef.current === renderLoop) renderLoopRef.current = null;
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      dracoLoader.dispose();
      ktx2Loader.dispose();
      restoreSceneMaterials();
      clearComparison();
      sourceCacheRef.current.forEach((root) => dispose(root));
      sourceCacheRef.current.clear();
      if (rootRef.current) dispose(rootRef.current);
      renderer.dispose();
      cameraRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      holderRef.current = null;
      rootRef.current = null;
      loaderRef.current = null;
      comparisonGroupRef.current = null;
      miniSceneRef.current = null;
      miniCameraRef.current = null;
      nodeMapRef.current.clear();
      sceneNodeMapRef.current.clear();
      originalMaterialsRef.current.clear();
      allMeshesRef.current = [];
    };
  }, [url]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || status !== 'ready') return;
    nodeMapRef.current.clear();
    allMeshesRef.current.forEach((mesh) => { mesh.userData.componentMatchIds = []; });
    componentMatches.forEach((match) => {
      const node = findNode(root, match.project.nodeNames);
      if (!node) return;
      nodeMapRef.current.set(match.id, node);
      markMatchable(node, match.id);
    });
    sceneNodeMapRef.current.clear();
    onSceneIndexRef.current?.(buildSceneIndex(root, sceneNodeMapRef.current));
  }, [componentMatches, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    restoreSceneMaterials();
    if (!matchMapEnabled || comparisonActive) {
      renderLoopRef.current?.invalidate();
      return;
    }
    const selected = selectedComponentId ? nodeMapRef.current.get(selectedComponentId) : null;
    const selectedMeshes = new Set<Mesh>();
    selected?.traverse((child) => { if (child instanceof Mesh) selectedMeshes.add(child); });
    allMeshesRef.current.forEach((mesh) => {
      const matchIds = (mesh.userData.componentMatchIds as string[] | undefined) ?? [];
      const isSelected = selectedMeshes.has(mesh);
      if (!selected) {
        if (matchIds.length) styleSceneMesh(mesh, '#729bc2', 0.34);
        return;
      }
      if (differenceMode === 'isolate') {
        mesh.visible = isSelected;
        if (isSelected) styleSceneMesh(mesh, '#dca64a', 0.3);
        return;
      }
      if (differenceMode === 'ghost') {
        styleSceneMesh(mesh, isSelected ? '#dca64a' : '#737972', isSelected ? 0.32 : 0.7, isSelected ? 1 : 0.14);
        return;
      }
      if (isSelected) styleSceneMesh(mesh, '#dca64a', 0.42);
      else if (matchIds.length) styleSceneMesh(mesh, '#729bc2', 0.2);
    });
    renderLoopRef.current?.invalidate();
  }, [comparisonActive, differenceMode, matchMapEnabled, selectedComponentId, status]);

  useEffect(() => {
    if (!selectedComponentId || comparisonActive || status !== 'ready') return;
    focusSelection();
  }, [selectedComponentId, comparisonActive, status]);

  useEffect(() => {
    if (!focusedSceneNodeId || comparisonActive || status !== 'ready') return;
    focusObject(sceneNodeMapRef.current.get(focusedSceneNodeId));
  }, [comparisonActive, focusedSceneNodeId, status]);

  useEffect(() => {
    const object = selectedComponentId ? nodeMapRef.current.get(selectedComponentId) : null;
    const camera = miniCameraRef.current;
    if (!object || !camera || status !== 'ready') {
      setMiniMarker(null);
      return;
    }
    object.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    const point = new Box3().setFromObject(object).getCenter(new Vector3()).project(camera);
    setMiniMarker({ x: Math.max(4, Math.min(96, (point.x + 1) * 50)), y: Math.max(4, Math.min(96, (1 - point.y) * 50)) });
  }, [selectedComponentId, status]);

  useEffect(() => {
    const selected = componentMatches.find((match) => match.id === selectedComponentId);
    const root = rootRef.current;
    const holder = holderRef.current;
    const compareGroup = comparisonGroupRef.current;
    const loader = loaderRef.current;
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!holder || !compareGroup || !controls || !camera) return;
    if (!comparisonActive || !selected || !root) {
      clearComparison();
      setHeatmapStats(null);
      compareGroup.visible = false;
      holder.visible = true;
      setComparisonStatus('idle');
      renderLoopRef.current?.invalidate();
      renderLoopRef.current?.sync();
      return;
    }
    let cancelled = false;
    holder.visible = false;
    clearComparison();
    setHeatmapStats(null);
    compareGroup.visible = true;
    setComparisonStatus('loading');

    const build = (sourceRoot: Group) => {
      if (cancelled) return;
      const projectNode = findNode(root, selected.project.nodeNames);
      const sourceNode = findNode(sourceRoot, selected.source.nodeNames);
      if (!projectNode || !sourceNode) {
        setComparisonStatus('error');
        renderLoopRef.current?.invalidate();
        renderLoopRef.current?.sync();
        return;
      }
      clearComparison();
      const resolvedMode = comparisonMode === 'blink' && reducedMotionRef.current ? 'side' : comparisonMode;
      const offset = resolvedMode === 'side' ? 1.25 : 0;
      const project = focusedClone(projectNode, -offset);
      const source = focusedClone(sourceNode, offset);
      if (resolvedMode === 'overlay') {
        styleClone(project, '#729bc2', 0.58, 1, comparisonMaterialsRef.current);
        styleClone(source, '#dca64a', 0.48, 2, comparisonMaterialsRef.current);
      }
      compareGroup.add(project, source);
      compareGroup.updateMatrixWorld(true);
      comparisonPairRef.current = { project, source };
      camera.up.set(0, 1, 0);
      camera.position.set(0, 0.15, 5.1);
      controls.target.set(0, 0, 0);
      controls.update();
      if (resolvedMode === 'heatmap') {
        requestAnimationFrame(() => {
          if (cancelled) return;
          setHeatmapStats(applyDeviationHeatmap(project, source, comparisonMaterialsRef.current, comparisonGeometriesRef.current));
          setComparisonStatus('ready');
          renderLoopRef.current?.invalidate();
          renderLoopRef.current?.sync();
        });
        return;
      }
      setComparisonStatus('ready');
      renderLoopRef.current?.invalidate();
      renderLoopRef.current?.sync();
    };

    if (selected.source.assetId === assetId) {
      build(root);
    } else if (comparisonSourceUrl && loader) {
      const cached = sourceCacheRef.current.get(comparisonSourceUrl);
      if (cached) build(cached);
      else loader.load(comparisonSourceUrl, (gltf) => {
        if (cancelled) {
          dispose(gltf.scene);
          return;
        }
        sourceCacheRef.current.set(comparisonSourceUrl, gltf.scene);
        build(gltf.scene);
      }, undefined, () => { if (!cancelled) setComparisonStatus('error'); });
    } else {
      setComparisonStatus('error');
      renderLoopRef.current?.invalidate();
      renderLoopRef.current?.sync();
    }
    return () => { cancelled = true; };
  }, [assetId, comparisonActive, comparisonMode, comparisonSourceUrl, componentMatches, matchMapEnabled, selectedComponentId, status]);

  const memoryReviewTargetMb = 576;
  const triangleReviewTarget = 1_500_000;
  const drawCallReviewTarget = 350;
  const budgetRatio = budget ? Math.max(
    budget.estimatedGpuMb / memoryReviewTargetMb,
    budget.triangles / triangleReviewTarget,
    budget.drawCalls / drawCallReviewTarget,
  ) : 0;
  const budgetLevel = budgetRatio > 1 ? 'review' : budgetRatio > 0.7 ? 'near' : 'within';
  const budgetState = budgetLevel === 'review' ? 'Review recommended' : budgetLevel === 'near' ? 'Approaching target' : 'Within target';
  const budgetReasons = budget ? [
    budget.estimatedGpuMb > memoryReviewTargetMb ? `${budget.estimatedGpuMb.toFixed(0)} MB estimated decoded memory exceeds the ${memoryReviewTargetMb} MB project review target` : null,
    budget.triangles > triangleReviewTarget ? `${budget.triangles.toLocaleString()} source triangles exceed the ${triangleReviewTarget.toLocaleString()} project review target` : null,
    budget.drawCalls > drawCallReviewTarget ? `${budget.drawCalls.toLocaleString()} source draw calls exceed the ${drawCallReviewTarget.toLocaleString()} project review target` : null,
  ].filter((reason): reason is string => Boolean(reason)) : [];
  const primaryBudgetReason = budgetReasons[0] ?? 'All decoded-size and scene-complexity estimates are within the current project review targets';

  return (
    <div className={`heavy-viewer ${comparisonActive ? 'heavy-viewer-comparing' : ''}`} data-status={status} aria-label={`Interactive preview of ${label}`}>
      <img src={previewUrl} alt="" aria-hidden="true" />
      <canvas ref={canvasRef} />
      {status === 'loading' ? <div className="heavy-viewer-loading"><span><i style={{ width: `${progress}%` }} /></span><strong>Streaming {size} GLB</strong><small>{progress ? `${progress}% transferred · decoding locally` : 'Opening local asset stream…'}</small></div> : null}
      {status === 'ready' ? <>
        <div className="viewer-top-dock">
          {budget ? <div className={`scene-budget-hud budget-${budgetLevel}`}>
            <button className="scene-budget-toggle" type="button" aria-expanded={budgetOpen} aria-label={`${budgetOpen ? 'Close' : 'Open'} performance explanation: ${budgetState}`} onClick={() => setBudgetOpen((open) => !open)}>
              <strong className="scene-budget-primary">Performance · {budget.estimatedGpuMb.toFixed(0)} MB decoded est.</strong>
              <em className="scene-budget-state">{budgetState}</em>
            </button>
            {!budgetOpen && budgetLevel === 'review' ? <small className="scene-budget-trigger">{primaryBudgetReason}. Open for measured details.</small> : null}
            {budgetOpen ? <div className="scene-budget-details">
              <section className="scene-budget-explanation">
                <h3 className="scene-budget-section-title">Why this is flagged</h3>
                <p>{primaryBudgetReason}. This is a project review target, not a hardware limit or an error.</p>
                {budgetReasons.length > 1 ? <ul>{budgetReasons.slice(1).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              </section>
              <section className="scene-budget-section">
                <h3 className="scene-budget-section-title">Measured live in this browser</h3>
                {runtimeTelemetry ? <dl>
                  <div><dt>Frame rate</dt><dd>{runtimeTelemetry.fps.toFixed(0)} fps</dd></div>
                  <div><dt>p95 frame</dt><dd>{runtimeTelemetry.p95FrameMs.toFixed(1)} ms</dd></div>
                  <div><dt>CPU submit</dt><dd>{runtimeTelemetry.cpuSubmitMs.toFixed(1)} ms</dd></div>
                  <div><dt>Draw calls</dt><dd>{runtimeTelemetry.total.calls.toLocaleString()}</dd></div>
                  <div><dt>Triangles</dt><dd>{runtimeTelemetry.total.triangles.toLocaleString()}</dd></div>
                  <div><dt>Resources</dt><dd>{runtimeTelemetry.geometries} geo · {runtimeTelemetry.textures} tex</dd></div>
                </dl> : <p>Collecting a one-second sample…</p>}
                {runtimeTelemetry && runtimeTelemetry.total.calls > runtimeTelemetry.main.calls ? <small>Includes the main view plus {runtimeTelemetry.total.calls - runtimeTelemetry.main.calls} draw calls from the scene-map inset.</small> : null}
              </section>
              <section className="scene-budget-section">
                <h3 className="scene-budget-section-title">Decoded-memory estimate</h3>
                <dl>
                  <div><dt>Geometry</dt><dd>{budget.geometryMb.toFixed(1)} MB</dd></div>
                  <div><dt>Textures</dt><dd>{budget.textureMb.toFixed(0)} MB</dd></div>
                  <div><dt>Source calls</dt><dd>{budget.drawCalls.toLocaleString()}</dd></div>
                  <div><dt>Source tris</dt><dd>{budget.triangles.toLocaleString()}</dd></div>
                </dl>
              </section>
              {gpuDeviceInfo ? <section className="scene-budget-section scene-budget-device">
                <h3 className="scene-budget-section-title">Detected graphics context</h3>
                <p title={`${gpuDeviceInfo.renderer} · ${gpuDeviceInfo.vendor}`}>{gpuDeviceInfo.renderer}</p>
                <small>{gpuDeviceInfo.webglVersion} · {gpuDeviceInfo.precision} precision · {gpuDeviceInfo.maxTextureSize.toLocaleString()} px max texture · {gpuDeviceInfo.maxSamples}× MSAA max</small>
              </section> : null}
              <small className="scene-budget-disclosure"><strong>Actual VRAM usage is unavailable.</strong> WebGL does not expose allocated, free, or total VRAM. Memory above is estimated from decoded buffers and texture dimensions; the live scene figures are real measurements from this loaded GLB and browser.</small>
            </div> : null}
          </div> : null}
          {!comparisonActive ? <div className="heavy-viewer-controls" aria-label="Camera viewpoints"><button type="button" onClick={() => setView('iso')}>Iso</button><button type="button" onClick={() => setView('front')}>Front</button><button type="button" onClick={() => setView('top')}>Top</button>{selectedMatch ? <button type="button" onClick={focusSelection}>Focus</button> : null}</div> : null}
        </div>
        {!comparisonActive ? <div className="heavy-viewer-ready"><span />{matchMapEnabled ? selectedMatch ? `${differenceMode === 'ghost' ? 'Ghost context' : differenceMode === 'isolate' ? 'Isolated component' : 'Difference highlight'} · ${selectedMatch.project.label}` : 'Match map active · click a highlighted component' : 'Orbit any direction · wheel or pinch to zoom'}</div> : null}
        {comparisonActive && selectedMatch && comparisonStatus !== 'error' ? <div className="viewer-comparison-dock">{comparisonMode === 'heatmap' && heatmapStats ? <div className="surface-heatmap-legend"><span>Near-identical</span><i /><span>Largest deviation</span><small>Mean {(heatmapStats.mean * 100).toFixed(2)}% · max {(heatmapStats.maximum * 100).toFixed(2)}% of normalized frame · {heatmapStats.samples.toLocaleString()} vertices sampled</small></div> : null}<div className={`subasset-comparison-labels subasset-comparison-labels-${comparisonMode}`}><span>Project component<strong>{selectedMatch.project.label}</strong></span><small>{comparisonMode === 'overlay' ? 'Normalized overlay' : comparisonMode === 'heatmap' ? 'Sampled normalized deviation' : comparisonMode === 'blink' ? reducedMotionRef.current ? 'Blink replaced with static view' : 'Alternating every 0.85 s' : 'Normalized to the same frame'}</small><span>Matched component<strong>{selectedMatch.source.label}</strong></span></div></div> : null}
        {selectedMatch && !comparisonActive ? <div className="mini-scene-map" aria-label={`Scene map location for ${selectedMatch.project.label}`}><span>Scene location</span>{miniMarker ? <i style={{ left: `${miniMarker.x}%`, top: `${miniMarker.y}%` }} /> : null}</div> : null}
        {comparisonActive && comparisonStatus === 'loading' ? <div className="subasset-comparison-loading" role="status" aria-live="polite"><span />{comparisonMode === 'heatmap' ? 'Computing normalized surface deviation…' : 'Loading matched GLB and extracting one component…'}</div> : null}
        {comparisonActive && comparisonStatus === 'error' ? <div className="heavy-viewer-error">The selected component pair could not be extracted from its source GLB.</div> : null}
      </> : null}
      {status === 'error' ? <div className="heavy-viewer-error">The static preview remains available; WebGL could not decode this asset.</div> : null}
    </div>
  );
}
