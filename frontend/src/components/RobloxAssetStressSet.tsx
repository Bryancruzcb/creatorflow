import { AlertTriangle, Boxes, Check, Download, Gauge, HardDrive, Pause, Play, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type ProbeState = 'idle' | 'running' | 'complete' | 'cancelled' | 'error';

type WorkloadProfile = {
  id: string;
  name: string;
  sizeBytes: number;
  size: string;
  location: string;
  inventory: string;
  purpose: string;
  boundary: string;
  breakdown: Array<{ label: string; value: string }>;
};

type ProbeResult = {
  state: ProbeState;
  runId?: string;
  processedBytes: number;
  totalBytes: number;
  elapsedMs?: number;
  checksum?: string;
};

const MiB = 1024 * 1024;

const profiles: WorkloadProfile[] = [
  {
    id: 'streaming-world-corpus',
    name: 'Streaming world source corpus',
    sizeBytes: 640 * MiB,
    size: '640 MiB',
    location: 'LocalSources/NorthwindWorld',
    inventory: 'A multi-file art source folder—not one Roblox place file',
    purpose: 'Exercise bounded scanning, progress reporting, cancellation, and evidence accounting above half a gigabyte.',
    boundary: 'Generated locally in reusable 4 MiB chunks. Nothing is stored, uploaded, parsed as RBXL, or opened in WebGL.',
    breakdown: [
      { label: 'Mesh sources', value: '212 FBX / GLB' },
      { label: 'Surface maps', value: '1,480 PNG / TGA' },
      { label: 'Audio', value: '96 OGG / WAV' },
      { label: 'Studio refs', value: '2 RBXLX · 2 RBXM refs' },
    ],
  },
  {
    id: 'avatar-wardrobe-batch',
    name: 'Avatar wardrobe review batch',
    sizeBytes: 286 * MiB,
    size: '286 MiB',
    location: 'LocalSources/Avatar/Wardrobe',
    inventory: 'Layered clothing, cages, textures, thumbnails, and source evidence',
    purpose: 'Model the ownership, cage/version, texture, and moderation records a character team needs before release.',
    boundary: 'Representative workload metadata plus a generated stream. It is not a Roblox-owned asset pack.',
    breakdown: [
      { label: 'Accessories', value: '84 records' },
      { label: 'Cage pairs', value: '36 outer / inner' },
      { label: 'Textures', value: '312 images' },
      { label: 'Open evidence', value: '9 records' },
    ],
  },
  {
    id: 'animation-rig-library',
    name: 'Animation and rig library',
    sizeBytes: 128 * MiB,
    size: '128 MiB',
    location: 'ReplicatedStorage/Assets/Animations',
    inventory: 'R15 motion, NPC rigs, facial curves, references, and provenance',
    purpose: 'Exercise animation-ID dependency indexing and checkpoint changes across a team library.',
    boundary: 'The catalog below supplies real licensed GLB proxies; this profile represents the wider Roblox project workload.',
    breakdown: [
      { label: 'Animations', value: '426 IDs' },
      { label: 'Rigs', value: '18 R15 / NPC' },
      { label: 'References', value: '1,204 usages' },
      { label: 'Changed', value: '27 since checkpoint' },
    ],
  },
  {
    id: 'ui-audio-localization',
    name: 'UI, audio, and localization bundle',
    sizeBytes: 214 * MiB,
    size: '214 MiB',
    location: 'StarterGui + SoundService + Localization',
    inventory: 'Interface images, spatial audio, fonts, strings, and device variants',
    purpose: 'Expose missing source records, moderation dependencies, and unsupported-device variants outside the 3D scene.',
    boundary: 'Generated workload only. It tests CreatorFlow controls, not Roblox client memory or moderation.',
    breakdown: [
      { label: 'UI images', value: '764 records' },
      { label: 'Audio', value: '188 assets' },
      { label: 'Locales', value: '12 tables' },
      { label: 'Device sets', value: '4 profiles' },
    ],
  },
];

function formatBytes(bytes: number) {
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes >= 100 * MiB ? 0 : 1)} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

export function RobloxAssetStressSet() {
  const [selectedId, setSelectedId] = useState(profiles[0].id);
  const [result, setResult] = useState<ProbeResult>({ state: 'idle', processedBytes: 0, totalBytes: profiles[0].sizeBytes });
  const workerRef = useRef<Worker | null>(null);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
  const progress = result.totalBytes ? Math.min(1, result.processedBytes / result.totalBytes) : 0;
  const resultLabel = result.state === 'complete' ? 'Completed' : result.state === 'cancelled' ? 'Cancelled safely' : result.state === 'error' ? 'Worker failed' : result.state === 'running' ? 'Generating stream' : 'Not run';

  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => {
    if (result.state === 'running') return;
    setResult({ state: 'idle', processedBytes: 0, totalBytes: selected.sizeBytes });
  }, [selected.id, selected.sizeBytes]);

  function startProbe() {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../workers/generatedAssetStress.worker.ts', import.meta.url), { type: 'module' });
    const runId = crypto.randomUUID();
    workerRef.current = worker;
    setResult({ state: 'running', runId, processedBytes: 0, totalBytes: selected.sizeBytes });
    worker.onmessage = (event: MessageEvent<{ type: string; runId: string; processedBytes: number; totalBytes: number; elapsedMs: number; checksum?: string }>) => {
      const message = event.data;
      if (message.runId !== runId) return;
      if (message.type === 'progress') setResult({ state: 'running', runId, processedBytes: message.processedBytes, totalBytes: message.totalBytes, elapsedMs: message.elapsedMs });
      if (message.type === 'complete') {
        setResult({ state: 'complete', runId, processedBytes: message.processedBytes, totalBytes: message.totalBytes, elapsedMs: message.elapsedMs, checksum: message.checksum });
        worker.terminate();
        workerRef.current = null;
      }
      if (message.type === 'cancelled') {
        setResult({ state: 'cancelled', runId, processedBytes: message.processedBytes, totalBytes: message.totalBytes, elapsedMs: message.elapsedMs });
        worker.terminate();
        workerRef.current = null;
      }
    };
    worker.onerror = () => {
      setResult((current) => ({ ...current, state: 'error' }));
      worker.terminate();
      workerRef.current = null;
    };
    worker.postMessage({ type: 'start', runId, totalBytes: selected.sizeBytes, chunkBytes: 4 * MiB });
  }

  function cancelProbe() {
    if (!result.runId || !workerRef.current) return;
    workerRef.current.postMessage({ type: 'cancel', runId: result.runId });
  }

  function exportResult() {
    const payload = {
      schema: 'creatorflow.generated-stream-probe/v1',
      workload: selected,
      result,
      measurementBoundary: 'Synthetic bounded-memory stream; proves progress/cancellation behavior, not throughput, disk I/O, Roblox parsing, upload eligibility, or client performance.',
      generatedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `creatorflow-${selected.id}-probe.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const summary = useMemo(() => `${profiles.length} Roblox workflow profiles · ${profiles.filter((profile) => profile.sizeBytes >= 500 * MiB).length} above 500 MiB`, []);

  return (
    <section className="roblox-asset-stress" aria-labelledby="roblox-asset-stress-title">
      <header>
        <div><span>Roblox workflow workloads</span><h2 id="roblox-asset-stress-title">Test project-scale pressure without pretending it is one upload.</h2><p>These profiles model the source folders and cloud references around a Roblox experience. The licensed interactive GLBs below remain separate, real fixtures.</p></div>
        <small>{summary}</small>
      </header>

      <div className="roblox-workload-layout">
        <div className="roblox-workload-list" role="list" aria-label="Roblox workflow workload profiles">
          {profiles.map((profile) => <button key={profile.id} type="button" disabled={result.state === 'running'} aria-pressed={selected.id === profile.id} onClick={() => setSelectedId(profile.id)}><Boxes size={15} /><span><strong>{profile.name}</strong><small>{profile.inventory}</small></span><em>{profile.size}</em></button>)}
        </div>

        <article className="roblox-workload-detail">
          <header><HardDrive size={18} /><span><small>{selected.location}</small><strong>{selected.name}</strong></span><em>{selected.size}</em></header>
          <p>{selected.purpose}</p>
          <dl>{selected.breakdown.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>

          <div className="generated-stream-probe" data-state={result.state}>
            <header><Gauge size={15} /><span><strong>Bounded-memory stream probe</strong><small>Reusable 4 MiB worker buffer · control test, not a speed benchmark</small></span><em>{resultLabel}</em></header>
            <div className="generated-stream-meter" aria-label={`${Math.round(progress * 100)} percent complete`}><i style={{ width: `${progress * 100}%` }} /></div>
            <div className="generated-stream-readout" aria-live="polite"><span><small>Processed</small><strong>{formatBytes(result.processedBytes)} / {formatBytes(result.totalBytes)}</strong></span><span><small>Elapsed</small><strong>{result.elapsedMs === undefined ? '—' : `${(result.elapsedMs / 1000).toFixed(2)}s`}</strong></span><span><small>Integrity signal</small><strong>{result.checksum ?? 'Pending'}</strong></span></div>
            <div className="generated-stream-actions">
              {result.state === 'running' ? <button className="button button-secondary" type="button" onClick={cancelProbe}><Pause size={14} /> Cancel probe</button> : <button className="button button-primary" type="button" onClick={startProbe}><Play size={14} /> {result.state === 'idle' ? `Run ${selected.size} probe` : 'Run again'}</button>}
              {result.state === 'complete' || result.state === 'cancelled' ? <button className="button button-secondary" type="button" onClick={exportResult}><Download size={14} /> Export result</button> : null}
            </div>
          </div>

          <aside><AlertTriangle size={15} /><span><strong>Measurement boundary</strong><small>{selected.boundary} This proves scanner-control behavior—not throughput, Roblox upload eligibility, parsing, or runtime performance.</small></span></aside>
        </article>
      </div>

      <footer><ShieldCheck size={14} /><span><strong>Why 640 MiB is a corpus, not a place</strong><small>CreatorFlow separates local source pressure from the place file Studio can save or publish. Roblox documents a 100 MB place-file limit.</small></span><a href="https://create.roblox.com/docs/projects/place-files" target="_blank" rel="noreferrer">Place-file limits</a>{result.state === 'complete' ? <Check size={15} /> : null}</footer>
    </section>
  );
}
