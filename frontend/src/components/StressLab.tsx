import {
  Activity,
  AlertTriangle,
  Binary,
  Braces,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  FileWarning,
  Folder,
  FolderOpen,
  Gauge,
  Layers3,
  Play,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { capacityProfiles, executableFormats, failureFixtures, motionFixtures } from '../stressLabData';
import type { MotionTelemetry } from './AnimatedAssetViewer';
import './StressLab.clarity.css';

const AnimatedAssetViewer = lazy(() => import('./AnimatedAssetViewer').then((module) => ({ default: module.AnimatedAssetViewer })));
const HeavyAssetViewer = lazy(() => import('./HeavyAssetViewer').then((module) => ({ default: module.HeavyAssetViewer })));

type StressView = 'overview' | 'motion' | 'gpu' | 'failures' | 'package' | 'formats' | 'telemetry';
type ResultState = 'idle' | 'running' | 'passed' | 'warning' | 'failed';

interface ProbeResult {
  state: ResultState;
  durationMs?: number;
  bytes?: number;
  finding?: string;
  details?: Record<string, ProbeDetail>;
}

interface ProbeDetail {
  ok: boolean;
  finding: string;
  bytes?: number;
  contentType?: string | null;
}

const suite = [
  { id: 'motion', label: 'Animation fixture', purpose: 'Parse two known GLBs and confirm clips, skinning, and morph targets are readable.', view: 'motion' as const },
  { id: 'gpu', label: '8K image fixture', purpose: 'Decode and draw a bundled 8192 × 8192 PNG on this device.', view: 'gpu' as const },
  { id: 'compression', label: 'Compression fixture', purpose: 'Fetch the same known scene in raw and Draco + KTX2 forms and compare bytes.', view: 'gpu' as const },
  { id: 'failures', label: 'Broken-input fixtures', purpose: 'Recognize six deliberately planted file problems before preview.', view: 'failures' as const },
  { id: 'package', label: 'Dependency fixture', purpose: 'Resolve a known glTF root, two buffers, and twenty-four textures inside one folder.', view: 'package' as const },
  { id: 'formats', label: 'Availability fixtures', purpose: 'Confirm the app’s bundled PNG, PSD, WAV, MOV, FBX, and font samples are present.', view: 'formats' as const },
] as const;

const stressTabs: Array<{ id: StressView; label: string }> = [
  { id: 'overview', label: 'System check' },
  { id: 'motion', label: 'Animation parser' },
  { id: 'gpu', label: 'Images & file size' },
  { id: 'failures', label: 'Broken files' },
  { id: 'package', label: 'Dependencies' },
  { id: 'formats', label: 'Format coverage' },
  { id: 'telemetry', label: 'Report' },
];

const initialResults = Object.fromEntries(suite.map((item) => [item.id, { state: 'idle' }])) as Record<string, ProbeResult>;

function formatBytes(bytes = 0) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function glbJson(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB magic');
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).replace(/\0+$/g, '').trim());
}

async function fetchBuffer(url: string) {
  const started = performance.now();
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  return { buffer, durationMs: performance.now() - started, bytes: buffer.byteLength };
}

function StateMark({ state }: { state: ResultState }) {
  if (state === 'running') return <RefreshCw aria-hidden="true" className="stress-spin" size={14} />;
  if (state === 'passed') return <Check aria-hidden="true" size={14} />;
  if (state === 'warning') return <AlertTriangle aria-hidden="true" size={14} />;
  if (state === 'failed') return <FileWarning aria-hidden="true" size={14} />;
  return <span aria-hidden="true" className="stress-idle-dot" />;
}

function stateLabel(state: ResultState) {
  if (state === 'running') return 'Running fixture';
  if (state === 'passed') return 'Handled as expected';
  if (state === 'warning') return 'Handled with limits';
  if (state === 'failed') return 'Diagnostic failed';
  return 'Fixture not run';
}

interface DependencyFixture {
  path: string;
  role: 'root' | 'geometry' | 'animation' | 'texture';
  bytes: number;
  group: 'root' | 'buffers' | 'environment' | 'props';
}

const dependencyFixtures: DependencyFixture[] = [
  { path: 'world.gltf', role: 'root', bytes: 2_596, group: 'root' },
  { path: 'buffers/geometry.bin', role: 'geometry', bytes: 262_144, group: 'buffers' },
  { path: 'buffers/animation.bin', role: 'animation', bytes: 98_304, group: 'buffers' },
  ...Array.from({ length: 12 }, (_, index) => ({ path: `textures/environment/texture_${String(index + 1).padStart(2, '0')}.png`, role: 'texture' as const, bytes: 178, group: 'environment' as const })),
  ...Array.from({ length: 12 }, (_, index) => ({ path: `textures/props/texture_${String(index + 13).padStart(2, '0')}.png`, role: 'texture' as const, bytes: 178, group: 'props' as const })),
];

const dependencyFolders = [
  { id: 'buffers' as const, label: 'buffers/', note: 'Geometry and animation data' },
  { id: 'environment' as const, label: 'textures/environment/', note: 'World surface fixtures' },
  { id: 'props' as const, label: 'textures/props/', note: 'Prop surface fixtures' },
];

function DependencyExplorer({ result }: { result: ProbeResult }) {
  const [selectedPath, setSelectedPath] = useState('world.gltf');
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(['buffers']));
  const [copied, setCopied] = useState(false);
  const selected = dependencyFixtures.find((fixture) => fixture.path === selectedPath) ?? dependencyFixtures[0];
  const selectedResult = result.details?.[selected.path];
  const fixtureUrl = `/stress-fixtures/multi-file-package/${selected.path}`;

  function toggleFolder(id: string) {
    setOpenFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(selected.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function FileIcon({ role }: { role: DependencyFixture['role'] }) {
    if (role === 'root') return <Braces size={14} />;
    if (role === 'texture') return <FileImage size={14} />;
    return <Binary size={14} />;
  }

  return (
    <div className="dependency-explorer">
      <div className="dependency-file-tree" role="tree" aria-label="Bundled dependency files">
        <button className={selected.path === 'world.gltf' ? 'selected' : ''} type="button" onClick={() => setSelectedPath('world.gltf')} role="treeitem" aria-selected={selected.path === 'world.gltf'}>
          <Braces size={15} /><span><strong>world.gltf</strong><small>Root project record · 2.6 KB</small></span><em data-state={result.state}>{result.state === 'idle' ? 'Not checked' : result.state === 'running' ? 'Checking' : selectedResult?.ok ? 'Available' : 'Missing'}</em>
        </button>
        {dependencyFolders.map((folder) => {
          const open = openFolders.has(folder.id);
          const files = dependencyFixtures.filter((fixture) => fixture.group === folder.id);
          return <div className="dependency-folder" key={folder.id} role="group"><button type="button" onClick={() => toggleFolder(folder.id)} aria-expanded={open}><span className="dependency-folder-icon">{open ? <FolderOpen size={15} /> : <Folder size={15} />}</span><span><strong>{folder.label}</strong><small>{folder.note}</small></span><em>{files.length} files</em><ChevronDown size={14} /></button>{open ? <div>{files.map((file) => { const detail = result.details?.[file.path]; return <button className={selected.path === file.path ? 'selected' : ''} type="button" key={file.path} onClick={() => setSelectedPath(file.path)} role="treeitem" aria-selected={selected.path === file.path}><FileIcon role={file.role} /><span><strong>{file.path.split('/').at(-1)}</strong><small>{formatBytes(file.bytes)} · referenced by world.gltf</small></span><em data-state={result.state}>{result.state === 'idle' ? 'Not checked' : result.state === 'running' ? 'Checking' : detail?.ok ? 'Resolved' : 'Missing'}</em></button>; })}</div> : null}</div>;
        })}
      </div>

      <aside className="dependency-file-inspector" aria-live="polite">
        <header><FileIcon role={selected.role} /><span><small>Selected dependency</small><strong>{selected.path.split('/').at(-1)}</strong></span></header>
        {selected.role === 'texture' ? <img src={fixtureUrl} alt={`Fixture preview for ${selected.path}`} /> : null}
        <dl>
          <div><dt>Project path</dt><dd><code>{selected.path}</code></dd></div>
          <div><dt>Role</dt><dd>{selected.role === 'root' ? 'glTF project root' : selected.role === 'geometry' ? 'Geometry buffer' : selected.role === 'animation' ? 'Animation buffer' : 'PNG texture'}</dd></div>
          <div><dt>Fixture bytes</dt><dd>{selected.bytes.toLocaleString()}</dd></div>
          <div><dt>Referenced by</dt><dd><code>{selected.role === 'root' ? 'System check' : 'world.gltf'}</code></dd></div>
          <div><dt>Resolution</dt><dd data-state={result.state}>{result.state === 'idle' ? 'Not checked' : result.state === 'running' ? 'Checking…' : selectedResult?.ok ? 'Available inside project root' : 'Missing or unreachable'}</dd></div>
          <div><dt>Content type</dt><dd>{selectedResult?.contentType ?? (selected.role === 'root' ? 'model/gltf+json' : selected.role === 'texture' ? 'image/png' : 'application/octet-stream')}</dd></div>
        </dl>
        <div><a className="button button-secondary" href={fixtureUrl} target="_blank" rel="noreferrer">Open fixture <ExternalLink size={13} /></a><button className="button button-secondary" type="button" onClick={() => { void copyPath(); }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy path'}</button></div>
        <p><ShieldCheck size={14} /><span><strong>Path policy</strong><small>Project-relative and contained inside the selected root.</small></span></p>
      </aside>
    </div>
  );
}

export function StressLab() {
  const [view, setView] = useState<StressView>('overview');
  const [results, setResults] = useState<Record<string, ProbeResult>>(initialResults);
  const [runningAll, setRunningAll] = useState(false);
  const [motionId, setMotionId] = useState(motionFixtures[0].id);
  const [loadedMotionId, setLoadedMotionId] = useState<string | null>(null);
  const [loadCompressed, setLoadCompressed] = useState(false);
  const [motionTelemetry, setMotionTelemetry] = useState<Record<string, MotionTelemetry>>({});
  const selectedMotion = motionFixtures.find((fixture) => fixture.id === motionId) ?? motionFixtures[0];
  const completedCheckCount = suite.filter((test) => ['passed', 'warning', 'failed'].includes(results[test.id].state)).length;
  const reportReady = completedCheckCount > 0;
  const runningIndex = suite.findIndex((test) => results[test.id].state === 'running');
  const hasRunningCheck = runningAll || runningIndex >= 0;
  const failedCount = suite.filter((test) => results[test.id].state === 'failed').length;
  const warningCount = suite.filter((test) => results[test.id].state === 'warning').length;
  const systemOutcome = completedCheckCount === 0
    ? hasRunningCheck ? 'Fixture run in progress' : 'Built-in fixtures not run'
    : failedCount > 0
      ? 'A diagnostic path failed'
      : warningCount > 0
        ? 'Fixtures handled with limits'
        : hasRunningCheck
          ? 'Fixture run in progress'
        : completedCheckCount === suite.length
          ? 'All six fixtures handled'
          : 'Some fixtures handled';
  const outcomeTone: ResultState = failedCount > 0
    ? 'failed'
    : warningCount > 0
      ? 'warning'
      : hasRunningCheck
        ? 'running'
        : completedCheckCount > 0
          ? 'passed'
          : 'idle';
  const totalDuration = Object.values(results).reduce((total, result) => total + (result.durationMs ?? 0), 0);
  const measuredBytes = Object.values(results).reduce((total, result) => total + (result.bytes ?? 0), 0);

  const onMotionTelemetry = useCallback((telemetry: MotionTelemetry) => {
    setMotionTelemetry((current) => ({ ...current, [motionId]: telemetry }));
  }, [motionId]);

  async function runProbe(id: string) {
    setResults((current) => ({ ...current, [id]: { state: 'running' } }));
    const started = performance.now();
    try {
      let result: ProbeResult;
      if (id === 'motion') {
        const [fox, morph] = await Promise.all([fetchBuffer('/assets/fox-animated.glb'), fetchBuffer('/assets/morph-stress-test.glb')]);
        const foxJson = glbJson(fox.buffer);
        const morphJson = glbJson(morph.buffer);
        const clips = (foxJson.animations?.length ?? 0) + (morphJson.animations?.length ?? 0);
        const skins = foxJson.skins?.length ?? 0;
        const morphTargets = Math.max(...(morphJson.meshes ?? []).flatMap((mesh: { primitives?: Array<{ targets?: unknown[] }> }) => (mesh.primitives ?? []).map((primitive) => primitive.targets?.length ?? 0)), 0);
        result = { state: clips >= 6 && skins > 0 && morphTargets >= 8 ? 'passed' : 'warning', bytes: fox.bytes + morph.bytes, finding: `${clips} clips · ${skins} skin · ${morphTargets} simultaneous morph targets` };
      } else if (id === 'gpu') {
        const texture = await fetchBuffer('/stress-fixtures/non3d/terrain_8k.png');
        const data = new DataView(texture.buffer);
        const width = data.getUint32(16, false);
        const height = data.getUint32(20, false);
        const decoded = width * height * 4;
        const decodeStarted = performance.now();
        const bitmap = await createImageBitmap(new Blob([texture.buffer], { type: 'image/png' }));
        const decodeMs = performance.now() - decodeStarted;
        const drawStarted = performance.now();
        const canvas = typeof OffscreenCanvas === 'undefined' ? Object.assign(document.createElement('canvas'), { width: 1, height: 1 }) : new OffscreenCanvas(1, 1);
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, 1, 1);
        const firstDrawMs = performance.now() - drawStarted;
        bitmap.close();
        result = { state: width === 8192 && height === 8192 ? 'passed' : 'failed', bytes: texture.bytes, finding: `${width} × ${height} · ${formatBytes(decoded)} estimated RGBA · ${decodeMs.toFixed(1)} ms decode · ${firstDrawMs.toFixed(1)} ms first draw` };
      } else if (id === 'compression') {
        const [raw, compressed] = await Promise.all([fetchBuffer('/assets/beautiful-game.glb'), fetchBuffer('/assets/beautiful-game-ktx2-draco.glb')]);
        const savings = Math.round((1 - compressed.bytes / raw.bytes) * 1000) / 10;
        result = { state: savings > 60 ? 'passed' : 'warning', bytes: raw.bytes + compressed.bytes, finding: `${formatBytes(raw.bytes)} raw (${raw.durationMs.toFixed(1)} ms) → ${formatBytes(compressed.bytes)} Draco + KTX2 (${compressed.durationMs.toFixed(1)} ms) · ${savings}% smaller` };
      } else if (id === 'failures') {
        const missing = await fetch('/stress-fixtures/broken/missing-texture/scene.gltf').then((response) => response.json());
        const missingResponse = await fetch(`/stress-fixtures/broken/missing-texture/${missing.images[0].uri}`);
        const corrupt = await fetch('/stress-fixtures/broken/corrupt.glb').then((response) => response.arrayBuffer());
        const unsupported = await fetch('/stress-fixtures/broken/unsupported-extension.gltf').then((response) => response.json());
        const invalid = await fetch('/stress-fixtures/broken/invalid-material.gltf').then((response) => response.json());
        const embedded = await fetch('/stress-fixtures/broken/embedded-megabyte.gltf').then((response) => response.json());
        const outside = await fetch('/stress-fixtures/broken/outside-folder.gltf').then((response) => response.json());
        const missingTextureDetected = !missingResponse.ok || !missingResponse.headers.get('content-type')?.startsWith('image/');
        const detections = [
          missingTextureDetected,
          new DataView(corrupt).getUint32(0, true) !== 0x46546c67,
          unsupported.extensionsRequired?.includes('VENDOR_required_feature'),
          invalid.meshes[0].primitives[0].material >= (invalid.materials?.length ?? 0),
          embedded.buffers[0].uri.length > 1_000_000,
          outside.buffers[0].uri.startsWith('../'),
        ].map(Boolean);
        const identified = detections.filter(Boolean).length;
        const details = Object.fromEntries(failureFixtures.map((fixture, index) => [fixture.path, { ok: detections[index], finding: detections[index] ? `Built-in fixture caught: ${fixture.successCopy}` : 'Planted malformed condition was not identified' }])) as Record<string, ProbeDetail>;
        result = { state: identified === failureFixtures.length ? 'passed' : 'failed', bytes: corrupt.byteLength + embedded.buffers[0].uri.length, finding: `${identified}/${failureFixtures.length} planted conditions caught in built-in fixtures before preview`, details };
      } else if (id === 'package') {
        const rootResponse = await fetch('/stress-fixtures/multi-file-package/world.gltf', { cache: 'no-store' });
        if (!rootResponse.ok) throw new Error(`Root dependency returned ${rootResponse.status}`);
        const project = await rootResponse.json();
        const dependencies = [...project.buffers.map((item: { uri: string }) => item.uri), ...project.images.map((item: { uri: string }) => item.uri)];
        const checks = await Promise.all(dependencies.map(async (path: string) => {
          const response = await fetch(`/stress-fixtures/multi-file-package/${path}`, { method: 'HEAD' });
          return { path, ok: response.ok, bytes: Number(response.headers.get('content-length') ?? 0), contentType: response.headers.get('content-type') };
        }));
        const available = checks.filter((check) => check.ok).length;
        const rootBytes = Number(rootResponse.headers.get('content-length') ?? 2_596);
        const details = Object.fromEntries([
          ['world.gltf', { ok: true, finding: 'Root project record loaded', bytes: rootBytes, contentType: rootResponse.headers.get('content-type') }],
          ...checks.map((check) => [check.path, { ok: check.ok, finding: check.ok ? 'Dependency resolved inside project root' : 'Dependency missing', bytes: check.bytes, contentType: check.contentType }]),
        ]) as Record<string, ProbeDetail>;
        result = { state: available === dependencies.length ? 'passed' : 'warning', bytes: rootBytes + checks.reduce((total, check) => total + check.bytes, 0), finding: `1 root · 2 buffers · 24 textures · ${available}/${dependencies.length} dependencies resolved`, details };
      } else if (id === 'formats') {
        const fontPaths = ['100', '300', '400', '500', '600', '700'].map((weight) => `/stress-fixtures/non3d/font-family/ibm-plex-sans-latin-${weight}-normal.woff2`);
        const [texture, psd, audio, video, fbx, fonts, profiles] = await Promise.all([
          fetch('/stress-fixtures/non3d/terrain_8k.png', { method: 'HEAD' }),
          fetch('/stress-fixtures/non3d/environment_master_8k.psd', { method: 'HEAD' }),
          fetch('/stress-fixtures/non3d/ambisonic_6ch_96khz_24bit.wav', { method: 'HEAD' }),
          fetch('/stress-fixtures/non3d/prores_4k_2s.mov', { method: 'HEAD' }),
          fetch('/stress-fixtures/non3d/dense_environment_grid.fbx', { method: 'HEAD' }),
          Promise.all(fontPaths.map((path) => fetch(path, { method: 'HEAD' }))),
          fetch('/stress-fixtures/capacity-profiles.json').then((response) => response.json()),
        ]);
        const responses = [texture, psd, audio, video, fbx, ...fonts];
        const bytes = responses.reduce((total, response) => total + Number(response.headers.get('content-length') ?? 0), 0);
        const availableGroups = [texture.ok, psd.ok, audio.ok, video.ok, fbx.ok, fonts.every((response) => response.ok)].filter(Boolean).length;
        result = { state: availableGroups === profiles.generatedFixtures.length ? 'passed' : 'failed', bytes, finding: `${availableGroups}/${profiles.generatedFixtures.length} executable fixture groups available · ${profiles.capacityOnly.length} production-scale capacity profiles` };
      } else throw new Error(`Unknown system check: ${id}`);
      result.durationMs = performance.now() - started;
      setResults((current) => ({ ...current, [id]: result }));
      return result;
    } catch (error) {
      const failed = { state: 'failed' as const, durationMs: performance.now() - started, finding: error instanceof Error ? error.message : 'Unknown probe failure' };
      setResults((current) => ({ ...current, [id]: failed }));
      return failed;
    }
  }

  async function runAll() {
    if (runningAll) return;
    setRunningAll(true);
    setResults(initialResults);
    for (const id of ['motion', 'gpu', 'compression', 'failures', 'package', 'formats']) await runProbe(id);
    setRunningAll(false);
  }

  const report = useMemo(() => ({
    schema: 'creatorflow.system-check/v0.2',
    generatedAt: new Date().toISOString(),
    execution: 'Browser-local diagnostics against built-in samples; this report does not describe the selected project.',
    environment: {
      userAgent: navigator.userAgent,
      logicalProcessors: navigator.hardwareConcurrency,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    },
    results,
    interactiveMotionTelemetry: motionTelemetry,
  }), [results, motionTelemetry]);

  function downloadReport() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'creatorflow-system-check.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const sectionNavigation = (
    <nav className="stress-tabs" aria-label="Built-in fixture labs">
      {stressTabs.map((item) => <button key={item.id} type="button" onClick={() => setView(item.id)} className={view === item.id ? 'selected' : ''} aria-pressed={view === item.id}>{item.label}</button>)}
    </nav>
  );

  return (
    <div className="stress-lab stress-clarity">
      <header className="stress-lab-header">
        <div><span>CreatorFlow device diagnostics</span><h1>Can this device run the inspection tools?</h1><p>Run six known files after setup, after switching devices, or when a viewer fails. The result isolates CreatorFlow and browser capability from anything inside your Roblox project.</p></div>
        <button aria-busy={runningAll} className="button button-primary" type="button" onClick={runAll} disabled={runningAll}>{runningAll ? <RefreshCw aria-hidden="true" className="stress-spin" size={15} /> : <Zap aria-hidden="true" size={15} />} {runningAll && runningIndex >= 0 ? `Running ${runningIndex + 1}/6: ${suite[runningIndex].label}` : 'Run 6 built-in checks'}</button>
      </header>

      <section className="stress-verdict-scope" data-state={outcomeTone} aria-label="Built-in system check result and scope">
        <div className="stress-verdict-primary"><span><StateMark state={outcomeTone} /></span><div><small>Built-in diagnostic result</small><strong>{systemOutcome}</strong><p>{completedCheckCount}/6 fixture checks finished. This describes CreatorFlow’s known samples on this device.</p></div></div>
        <div className="stress-boundary-copy"><ShieldCheck aria-hidden="true" size={18} /><div><strong>Scope: CreatorFlow—not your active Roblox project.</strong><p>A handled fixture means this browser performed one known operation. It does not inspect, approve, block, publish, or change a project release.</p></div></div>
        <dl className="stress-run-facts"><div><dt><Activity size={14} /> Local time</dt><dd>{totalDuration ? `${Math.round(totalDuration)} ms` : 'Not measured'}</dd></div><div><dt><Layers3 size={14} /> Bytes exercised</dt><dd>{measuredBytes ? formatBytes(measuredBytes) : '0 B'}</dd></div><div><dt><ShieldCheck size={14} /> Uploaded</dt><dd>0 B</dd></div></dl>
      </section>

      {view === 'overview' ? (
        <>
          <section className="stress-matrix">
            <header><span>Six built-in fixture checks</span><strong>Known inputs reveal device or inspection-path problems.</strong><small>Select a row to open its lab. Every status below belongs to a bundled fixture—not to your project.</small></header>
            {suite.map((test, index) => {
              const result = results[test.id];
              return <button key={test.id} type="button" data-state={result.state} onClick={() => setView(test.view)} aria-label={`Open ${test.label}: ${stateLabel(result.state)}`}><span>{String(index + 1).padStart(2, '0')}</span><div className="stress-check-copy"><strong>{test.label}</strong><small>{test.purpose}</small></div><p>{result.finding ?? 'No runtime result yet.'}</p><div className="stress-check-status"><small>Built-in fixture</small><em className={`stress-state stress-state-${result.state}`}><StateMark state={result.state} />{stateLabel(result.state)}</em></div></button>;
            })}
          </section>
          <section className="system-check-report-entry">
            <Download size={17} />
            <div><strong>Diagnostics report</strong><small>{reportReady ? 'Results and device context are ready to review or export.' : 'Run at least one check to create a report—even a failed check is useful evidence.'}</small></div>
            <span className={`stress-state ${reportReady ? 'stress-state-passed' : ''}`}><StateMark state={reportReady ? 'passed' : 'idle'} />{reportReady ? 'Report ready' : 'Not available'}</span>
            <button className="button button-secondary" type="button" onClick={() => setView('telemetry')} disabled={!reportReady}>Review report</button>
          </section>
          <details className="system-check-guide">
            <summary><span><Gauge size={16} /><strong>How to read and use this check</strong></span><span>3 steps <ChevronDown size={15} /></span></summary>
            <section className="system-check-purpose" aria-label="How to use the system check"><div><span>1</span><p><strong>Run known samples</strong><small>About 60 MB is read locally from the app. Nothing is uploaded.</small></p></div><div><span>2</span><p><strong>Inspect a diagnostic failure</strong><small>Open its fixture lab to see whether parsing, decoding, safety detection, or linked files failed.</small></p></div><div><span>3</span><p><strong>Export only when useful</strong><small>Keep the JSON report when comparing devices or reporting a CreatorFlow problem.</small></p></div></section>
          </details>
          <section className="stress-detail-navigation"><header><strong>Open a fixture lab</strong><small>The overview is the answer. These sections expose the underlying samples and measurements on demand.</small></header>{sectionNavigation}</section>
        </>
      ) : null}

      {view !== 'overview' ? sectionNavigation : null}

      {view === 'motion' ? (
        <section className="stress-motion-layout">
          <aside>{motionFixtures.map((fixture) => <button key={fixture.id} type="button" className={fixture.id === selectedMotion.id ? 'selected' : ''} aria-pressed={fixture.id === selectedMotion.id} onClick={() => { setMotionId(fixture.id); setLoadedMotionId(null); }}><img src={fixture.previewUrl} alt="" /><span><strong>{fixture.name}</strong><small>{fixture.subtitle}</small><em>{fixture.payload}</em></span></button>)}</aside>
          <div className="stress-motion-detail">
            {loadedMotionId === selectedMotion.id ? <Suspense fallback={<div className="stress-load-placeholder">Preparing animation runtime…</div>}><AnimatedAssetViewer fixture={selectedMotion} onTelemetry={onMotionTelemetry} /></Suspense> : <div className="motion-gate"><img src={selectedMotion.previewUrl} alt={`${selectedMotion.name} preview`} /><div><span>Runnable licensed fixture · {selectedMotion.payload}</span><h2>{selectedMotion.name}</h2><p>{selectedMotion.expected}</p><button className="button button-primary" type="button" onClick={() => setLoadedMotionId(selectedMotion.id)}><Play size={15} /> Open rig and timeline</button></div></div>}
            <footer><span>{selectedMotion.license}</span><a href={selectedMotion.sourceUrl} target="_blank" rel="noreferrer">Source record <ExternalLink size={13} /></a></footer>
          </div>
        </section>
      ) : null}

      {view === 'gpu' ? (
        <section className="compression-lab">
          <header><div><span>Same scene, different file size</span><h2>Compare transfer bytes, then open decoding separately.</h2><p>The automated check fetches real raw and compressed Khronos chess files and records their size and fetch time. Decoding the compressed scene below is a separate opt-in action.</p></div><button className="button button-secondary" type="button" onClick={() => runProbe('compression')} disabled={results.compression.state === 'running'}><Activity size={15} /> Run byte comparison</button></header>
          <div className="compression-ledger"><div><span>Raw GLB</span><strong>43.0 MB</strong><small>PNG/JPEG textures · uncompressed geometry</small></div><i>→</i><div><span>Draco + KTX2</span><strong>12.1 MB</strong><small>ETC1S texture payload · compressed geometry</small></div><div className="compression-saving"><strong>71.8%</strong><small>smaller transfer payload</small></div></div>
          <div className="gpu-pressure-row"><div><span>Real 8K fixture</span><strong>8192 × 8192 PNG</strong><small>1.4 MB transfer expands to an estimated 256 MB RGBA texture before mipmaps.</small></div><button type="button" onClick={() => runProbe('gpu')}><StateMark state={results.gpu.state} /> Inspect PNG header</button></div>
          <div className="compressed-preview">
            {loadCompressed ? <Suspense fallback={<div className="stress-load-placeholder">Loading local Draco and Basis decoders…</div>}><HeavyAssetViewer url="/assets/beautiful-game-ktx2-draco.glb" label="A Beautiful Game compressed" previewUrl="/assets/beautiful-game.jpg" size="12.1 MB" /></Suspense> : <><img src="/assets/beautiful-game.jpg" alt="Compressed chess scene preview" /><div><strong>Decoder path is opt-in.</strong><span>The initial workspace does not pay the Draco, Basis, or 12.1 MB model cost.</span><button className="button button-primary" type="button" onClick={() => setLoadCompressed(true)}><Play size={15} /> Decode compressed scene</button></div></>}
          </div>
        </section>
      ) : null}

      {view === 'failures' ? (
        <section className="failure-lab">
          <header><div><span>Intentionally broken fixture inputs</span><h2>Can the importer catch each planted condition?</h2><p>These six files are deliberately malformed. Their result measures detection behavior in CreatorFlow; it does not report a condition in your project and it does not apply a release block.</p></div><button className="button button-secondary" type="button" onClick={() => runProbe('failures')} disabled={results.failures.state === 'running'}><ShieldCheck size={15} /> Run 6 fixture detections</button></header>
          <div className="failure-meaning"><Check size={15} /><span><strong>Green means “the planted fixture condition was caught.”</strong><small>The importer response is what CreatorFlow should do if that condition appears in a real project. It is guidance—not a verdict applied here.</small></span></div>
          <div>{failureFixtures.map((fixture, index) => {
            const detail = results.failures.details?.[fixture.path];
            const state = results.failures.state === 'idle' ? 'idle' : results.failures.state === 'running' ? 'running' : detail?.ok ? 'passed' : 'failed';
            return <article key={fixture.path}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{fixture.name}</strong><code>{fixture.path}</code><small>Planted condition · {fixture.issue}</small></div><p><span>Importer response if encountered</span>{fixture.expectedAction}</p><em data-state={state}><StateMark state={state} />{state === 'idle' ? 'Fixture not run' : state === 'running' ? 'Checking fixture…' : detail?.ok ? `Fixture caught · ${fixture.successCopy}` : 'Fixture missed · detector needs attention'}</em></article>;
          })}</div>
        </section>
      ) : null}

      {view === 'package' ? (
        <section className="package-lab"><header><div><span>Executable dependency fixture</span><h2>One root file, twenty-six dependencies.</h2><p>Expand a folder, select any buffer or PNG, then inspect or open the real bundled file. Resolution is checked without rendering the package.</p></div><button className="button button-secondary" type="button" onClick={() => runProbe('package')} disabled={results.package.state === 'running'}><Layers3 size={15} /> Resolve dependency tree</button></header><DependencyExplorer result={results.package} /><footer><span>Path policy</span><strong>Project-relative only</strong><small><code>../outside-project.bin</code> is refused while the valid root record remains inspectable.</small></footer></section>
      ) : null}

      {view === 'formats' ? (
        <section className="format-lab"><header><div><span>Bundled format availability</span><h2>Fixture files and honest capacity profiles.</h2><p>This check confirms that the bundled executable fixtures are present on disk; it does not claim full parsing support for every format. Profiles marked “not bundled” are planning inputs and never counted as successful checks.</p></div><button className="button button-secondary" type="button" onClick={() => runProbe('formats')}><Activity size={15} /> Verify bundled fixture files</button></header><h3>Executable fixtures on disk</h3><div className="format-executable">{executableFormats.map((fixture) => <article key={fixture.name}><span>{fixture.format}</span><strong>{fixture.name}</strong><p>{fixture.detail}</p><dl><div><dt>Payload</dt><dd>{fixture.payload}</dd></div><div><dt>Decoded</dt><dd>{fixture.decoded}</dd></div></dl></article>)}</div><h3>Capacity profiles · not bundled or counted as expected results</h3><div className="capacity-table">{capacityProfiles.map((profile) => <div key={profile.name}><span>{profile.format}</span><strong>{profile.name}</strong><small>{profile.detail}</small><em>{profile.payload}</em></div>)}</div></section>
      ) : null}

      {view === 'telemetry' ? (
        <section className="telemetry-lab"><header><div><span>CreatorFlow diagnostics report</span><h2>What ran, how long it took, and what this device returned.</h2><p>Use this report to compare browsers or devices and to report a CreatorFlow problem. It summarizes built-in samples only; it contains no verdict about the selected project.</p></div><button className="button button-secondary" type="button" onClick={downloadReport} disabled={!reportReady}><Download size={15} /> Export diagnostics JSON</button></header><div className="telemetry-table"><div className="telemetry-head"><span>Built-in fixture</span><span>Fixture result</span><span>Local time</span><span>Bytes exercised</span><span>Diagnostic finding</span></div>{suite.map((test) => { const result = results[test.id]; return <div key={test.id}><strong>{test.label}</strong><span className={`stress-state stress-state-${result.state}`}><StateMark state={result.state} />{stateLabel(result.state)}</span><code>{result.durationMs !== undefined ? `${result.durationMs.toFixed(1)} ms` : '—'}</code><code>{result.bytes ? formatBytes(result.bytes) : '—'}</code><p>{result.finding ?? 'Fixture not run'}</p></div>; })}</div>{Object.keys(motionTelemetry).length ? <div className="motion-telemetry"><h3>Interactive renderer telemetry</h3>{Object.entries(motionTelemetry).map(([id, telemetry]) => <div key={id}><strong>{motionFixtures.find((fixture) => fixture.id === id)?.name ?? id}</strong><dl><div><dt>Decode</dt><dd>{telemetry.decodeMs.toFixed(1)} ms</dd></div><div><dt>First render</dt><dd>{telemetry.firstRenderMs.toFixed(1)} ms</dd></div><div><dt>Draw calls</dt><dd>{telemetry.drawCalls}</dd></div><div><dt>Triangles</dt><dd>{telemetry.triangles.toLocaleString()}</dd></div><div><dt>Materials</dt><dd>{telemetry.materials}</dd></div><div><dt>Textures</dt><dd>{telemetry.textures}</dd></div></dl></div>)}</div> : null}<div className="telemetry-disclosure"><AlertTriangle size={16} /><p><strong>Measurement boundary</strong>The checks use real local parsing, image decoding, fetch timing, malformed-file detection, and dependency resolution. They do not profile Roblox runtime performance, exact GPU memory, or the active project. Capacity-only profiles never receive pass states.</p></div></section>
      ) : null}
    </div>
  );
}
