import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Boxes, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GALLERY_LICENSE,
  galleryCategories,
  galleryModels,
  type GalleryCategory,
} from '../data/modelGallery';
import './ModelGallery.css';

interface ModelStats {
  meshes: number;
  triangles: number;
  materials: number;
  nodes: number;
  animations: number;
}

function disposeTree(root: Object3D) {
  root.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const material = child.material;
      (Array.isArray(material) ? material : [material]).forEach((entry) => entry.dispose());
    }
  });
}

/**
 * A browse-and-spin gallery of the CC0 low-poly model set. Every number shown is read live from
 * the loaded glTF, so the gallery scales to any number of models without a single hand-authored
 * (and potentially wrong) stat.
 */
export function ModelGallery() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<{ camera: PerspectiveCamera; holder: Group } | null>(null);
  const [category, setCategory] = useState<'All' | GalleryCategory>('All');
  const [selectedId, setSelectedId] = useState(galleryModels[0].id);
  const [stats, setStats] = useState<ModelStats | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const visible = useMemo(
    () => (category === 'All' ? galleryModels : galleryModels.filter((model) => model.category === category)),
    [category],
  );
  const selected = galleryModels.find((model) => model.id === selectedId) ?? galleryModels[0];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new Scene();
    scene.background = new Color('#151713');
    scene.add(new HemisphereLight('#e9eee5', '#20231f', 2.6));
    const key = new DirectionalLight('#ffe6bb', 3.4);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new DirectionalLight('#7ba8ca', 1.8);
    rim.position.set(-5, 3, -4);
    scene.add(rim);
    const camera = new PerspectiveCamera(38, 1.6, 0.01, 100);
    camera.position.set(3.1, 2.3, 4.3);
    const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.1;
    controls.minDistance = 2;
    controls.maxDistance = 14;
    const holder = new Group();
    scene.add(holder);
    viewerRef.current = { camera, holder };

    let stopped = false;
    let frame = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const loop = () => {
      if (stopped) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeTree(holder);
      renderer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    setStatus('loading');
    new GLTFLoader().load(selected.file, (gltf) => {
      if (cancelled) return;
      for (const child of [...viewer.holder.children]) {
        viewer.holder.remove(child);
        disposeTree(child);
      }
      const root = gltf.scene;
      const box = new Box3().setFromObject(root);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const scale = 2.7 / Math.max(size.x, size.y, size.z, 0.001);
      root.scale.setScalar(scale);
      root.position.copy(center).multiplyScalar(-scale);
      viewer.holder.add(root);

      let meshes = 0;
      let triangles = 0;
      let nodes = 0;
      const materials = new Set<string>();
      root.traverse((child) => {
        nodes += 1;
        if (child instanceof Mesh) {
          meshes += 1;
          const geometry = child.geometry;
          const index = geometry.index;
          const position = geometry.getAttribute('position');
          triangles += (index ? index.count : position ? position.count : 0) / 3;
          const material = child.material;
          (Array.isArray(material) ? material : [material]).forEach((entry) => materials.add(entry.uuid));
        }
      });
      setStats({ meshes, triangles: Math.round(triangles), materials: materials.size, nodes, animations: gltf.animations.length });
      setStatus('ready');
    }, undefined, () => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [selected.file]);

  return (
    <section className="model-gallery" aria-label="Low-poly model gallery">
      <header className="model-gallery-head">
        <div>
          <span className="workspace-kicker"><Boxes size={14} /> Model gallery · {galleryModels.length} CC0 assets</span>
          <h2>A rack of real low-poly models — spin any of them.</h2>
          <p>Every stat below is read straight from the file as it loads, so nothing here is a placeholder number.</p>
        </div>
        <span className="model-gallery-license">{GALLERY_LICENSE.spdx}</span>
      </header>

      <div className="model-gallery-body">
        <div className="model-gallery-stage">
          <canvas ref={canvasRef} aria-label={`Rotating preview of ${selected.name}`} />
          <div className="model-gallery-stage-name"><RotateCw size={13} /> {selected.name}</div>
          {status === 'loading' ? <div className="model-gallery-stage-state">Loading model…</div> : null}
          {status === 'error' ? <div className="model-gallery-stage-state is-error">This model could not be decoded.</div> : null}
          <dl className="model-gallery-stats">
            <div><dt>Meshes</dt><dd>{stats ? stats.meshes : '—'}</dd></div>
            <div><dt>Triangles</dt><dd>{stats ? stats.triangles.toLocaleString() : '—'}</dd></div>
            <div><dt>Materials</dt><dd>{stats ? stats.materials : '—'}</dd></div>
            <div><dt>Nodes</dt><dd>{stats ? stats.nodes : '—'}</dd></div>
          </dl>
        </div>

        <div className="model-gallery-picker">
          <div className="model-gallery-filter" role="group" aria-label="Filter models by category">
            {(['All', ...galleryCategories] as const).map((item) => (
              <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>
            ))}
          </div>
          <div className="model-gallery-grid">
            {visible.map((model) => (
              <button
                key={model.id}
                type="button"
                className={model.id === selectedId ? 'is-active' : ''}
                aria-pressed={model.id === selectedId}
                onClick={() => setSelectedId(model.id)}
              >
                <strong>{model.name}</strong>
                <small>{model.category}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <footer className="model-gallery-foot">
        <span>{GALLERY_LICENSE.pack} · {GALLERY_LICENSE.author}</span>
        <small>{GALLERY_LICENSE.note}</small>
      </footer>
    </section>
  );
}
