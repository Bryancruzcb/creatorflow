import {
  Activity,
  ArrowLeft,
  Bell,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  FileJson2,
  Fingerprint,
  FlaskConical,
  FolderOpen,
  GitCompare,
  HardDrive,
  LayoutDashboard,
  Library,
  PackageCheck,
  Pin,
  PinOff,
  Play,
  Share2,
  Search,
  ScanSearch,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { heavyAssets } from '../heavyAssets';
import { LocalBridgeClient, type LocalProjectRecord, type LocalProjectSummary, type LocalScanRun } from '../bridge/localBridge';
import { validateManifestFile, type CreatorFlowManifest, type ManifestValidationIssue } from '../manifest/manifest';
import { WorkspacePreferencesProvider } from '../preferences/workspacePreferences';
import { BrandMark } from './BrandMark';
import {
  CapabilityDemoNotice,
  ImportedEvidenceView,
  ImportedProjectOverview,
  ImportedProjectRun,
  ImportedReleasesView,
  ImportedSourcesView,
  sourceGroups,
} from './ImportedProjectViews';
import { LocalEvidenceView, LocalProjectOverview, LocalReleasesView, LocalScanView, LocalSourcesBoundary } from './LocalProjectWorkspace';
import { PreflightWorkspace } from './PreflightWorkspace';
import { ReleasePathLab } from './ReleasePathLab';
import { RobloxAssetStressSet } from './RobloxAssetStressSet';
import { SceneTreePanel } from './SceneTreePanel';
import { MetadataInspector } from './MetadataInspector';
import { WorkspaceDatasetBanner } from './WorkspaceDatasetBanner';
import { WorkspaceSettingsView } from './WorkspaceSettingsView';
import { WorkspaceWelcome } from './WorkspaceWelcome';
import './WorkspaceWelcome.css';
import type { ComparisonViewMode, DifferenceViewMode, SceneTreeNode } from './HeavyAssetViewer';
import './ProductWorkspace.premium.css';

const HeavyAssetViewer = lazy(() => import('./HeavyAssetViewer').then((module) => ({ default: module.HeavyAssetViewer })));
const MotionComparisonLab = lazy(() => import('./MotionComparisonLab').then((module) => ({ default: module.MotionComparisonLab })));
const ModelGallery = lazy(() => import('./ModelGallery').then((module) => ({ default: module.ModelGallery })));
const StressLab = lazy(() => import('./StressLab').then((module) => ({ default: module.StressLab })));
const heavyPayloadMb = (heavyAssets.reduce((total, asset) => total + asset.bytes, 0) / 1_000_000).toFixed(1);

export type WorkspaceView = 'overview' | 'project' | 'assets' | 'gallery' | 'motion' | 'stress' | 'evidence' | 'sources' | 'releases' | 'settings';

interface AssetDeepLink {
  assetId: string;
  componentId: string | null;
  load: boolean;
  compare: boolean;
  comparisonMode: ComparisonViewMode;
  differenceMode: DifferenceViewMode;
}

interface ComparisonQueueItem {
  assetId: string;
  componentId: string;
}

interface ImportedProject {
  manifest: CreatorFlowManifest;
  fileName: string;
  fileBytes: number;
  importedAt: string;
}

interface ImportNotice {
  tone: 'success' | 'error' | 'info';
  title: string;
  detail: string;
  issues?: ManifestValidationIssue[];
}

function workspaceParams() {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query);
}

function titleCaseRunState(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function readWorkspaceView(): WorkspaceView {
  const value = workspaceParams().get('view') as WorkspaceView | null;
  return value === 'settings' || navigation.some((item) => item.id === value) ? value! : 'overview';
}

function readAssetDeepLink(): AssetDeepLink {
  const params = workspaceParams();
  const asset = heavyAssets.find((item) => item.id === params.get('asset')) ?? heavyAssets[0];
  const component = asset.componentMatches?.find((item) => item.id === params.get('component'));
  const compareMode = params.get('compareMode');
  const diffMode = params.get('diff');
  return {
    assetId: asset.id,
    componentId: component?.id ?? null,
    load: params.get('load') === '1',
    compare: Boolean(component && params.get('compare') === '1'),
    comparisonMode: compareMode === 'overlay' || compareMode === 'blink' || compareMode === 'heatmap' ? compareMode : 'side',
    differenceMode: diffMode === 'ghost' || diffMode === 'isolate' ? diffMode : 'highlight',
  };
}

type NavigationPhase = 'snapshot' | 'fingerprint' | 'source' | 'decision' | 'handoff';

const navigationPhases: Array<{ id: NavigationPhase; label: string }> = [
  { id: 'snapshot', label: '01 · Snapshot' },
  { id: 'fingerprint', label: '02 · Fingerprint + inspect' },
  { id: 'source', label: '03 · Source' },
  { id: 'decision', label: '04 · Decision' },
  { id: 'handoff', label: '05 · Roblox handoff' },
];

const navigation: Array<{ id: WorkspaceView; label: string; icon: typeof LayoutDashboard; phase: NavigationPhase; count?: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, phase: 'snapshot' },
  { id: 'evidence', label: 'Evidence', icon: Fingerprint, phase: 'fingerprint', count: '12' },
  { id: 'assets', label: 'Assets', icon: Boxes, phase: 'fingerprint', count: 'sample' },
  { id: 'gallery', label: 'Model gallery', icon: Boxes, phase: 'fingerprint', count: '24' },
  { id: 'motion', label: 'Animation compare', icon: Activity, phase: 'fingerprint', count: 'Roblox beta' },
  { id: 'stress', label: 'System check', icon: FlaskConical, phase: 'fingerprint', count: '6' },
  { id: 'sources', label: 'Sources', icon: Library, phase: 'source', count: '20' },
  { id: 'project', label: 'Release flow', icon: Workflow, phase: 'decision' },
  { id: 'releases', label: 'Releases', icon: PackageCheck, phase: 'handoff', count: '3' },
];

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="product-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function OverviewView({ onOpenAsset, onOpenEvidence, onOpenMotion }: { onOpenAsset: (assetId?: string) => void; onOpenEvidence: () => void; onOpenMotion: () => void }) {
  return (
    <div className="product-overview">
      <section className="project-status-strip">
        <div><span className="workspace-kicker">Current release</span><strong>Northwind / Release 2.4</strong><small>Demo project profile · local-first policy</small></div>
        <div className="project-readiness"><ShieldCheck size={18} /><span><strong>88% ready</strong><small>12 evidence decisions remain</small></span></div>
        <button className="button button-primary" type="button" onClick={onOpenEvidence}>Review evidence</button>
      </section>

      <section className="product-metrics" aria-label="Project metrics">
        <Metric label="Indexed files" value="12,844" note="Sample profile · 39 creative formats" />
        <Metric label="Project footprint" value="18.4 GB" note="Sample profile, nothing downloaded" />
        <Metric label="Capability asset set" value="446 MB" note="32-file curated demo of real complex assets" />
        <Metric label="Bytes uploaded" value="0" note="Fingerprints leave the machine; files never do" />
      </section>

      <section className="overview-motion-entry">
        <div><Activity size={19} /><span><strong>Check a Roblox animation</strong><small>Compare two permitted animation IDs, then keep the normalized fingerprints with the local evidence record.</small></span></div>
        <button className="button button-secondary" type="button" onClick={onOpenMotion}>Open animation compare</button>
      </section>

      <div className="overview-grid">
        <section className="project-throughput">
          <header><div><span>Index throughput</span><strong>Last seven local scans</strong></div><small>FILES / SECOND</small></header>
          <div className="throughput-chart" aria-label="Local scan throughput ranged from 312 to 428 files per second over seven scans">
            {[56, 68, 62, 81, 73, 92, 86].map((height, index) => <i key={index} style={{ height: `${height}%` }}><span>{312 + index * 19}</span></i>)}
          </div>
          <footer><span>Average 369 files/s</span><span>Content upload disabled</span></footer>
        </section>

        <section className="decision-queue">
          <header><span>Decision queue</span><strong>What needs a human</strong></header>
          <ol>
            <li><span className="queue-state blocked">3</span><div><strong>Missing permission</strong><small>License or ownership evidence required</small></div></li>
            <li><span className="queue-state review">5</span><div><strong>High-confidence matches</strong><small>Compare source and project records</small></div></li>
            <li><span className="queue-state neutral">7</span><div><strong>Low-confidence candidates</strong><small>Visible differences documented by format</small></div></li>
          </ol>
        </section>
      </div>

      <section className="stress-pack-summary">
        <header>
          <div><span>Actual capability proof</span><h2>Complex assets, indexed without pretending they are lightweight.</h2></div>
          <button className="button button-secondary" type="button" onClick={() => onOpenAsset()}>Open asset stress set</button>
        </header>
        <div className="stress-pack-rows">
          {heavyAssets.map((asset) => (
            <button key={asset.id} type="button" onClick={() => onOpenAsset(asset.id)}>
              <img src={asset.previewUrl} alt="" />
              <span><strong>{asset.name}</strong><small>{asset.description}</small></span>
              <dl><div><dt>Payload</dt><dd>{asset.size}</dd></div><div><dt>Scene</dt><dd>{asset.nodes} nodes · {asset.textures} textures</dd></div></dl>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function AssetsView() {
  const [initialRoute] = useState(readAssetDeepLink);
  const [selectedId, setSelectedId] = useState(initialRoute.assetId);
  const [loadedId, setLoadedId] = useState<string | null>(initialRoute.load || initialRoute.componentId ? initialRoute.assetId : null);
  const [assetFilter, setAssetFilter] = useState<'all' | 'roblox' | 'matched' | '100mb'>('all');
  const [matchMapEnabled, setMatchMapEnabled] = useState(() => Boolean(heavyAssets.find((asset) => asset.id === initialRoute.assetId)?.componentMatches?.length));
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(initialRoute.componentId);
  const [differenceMode, setDifferenceMode] = useState<DifferenceViewMode>(initialRoute.differenceMode);
  const [comparisonActive, setComparisonActive] = useState(initialRoute.compare);
  const [comparisonMode, setComparisonMode] = useState<ComparisonViewMode>(initialRoute.comparisonMode);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0);
  const [sceneNodes, setSceneNodes] = useState<SceneTreeNode[]>([]);
  const [focusedSceneNodeId, setFocusedSceneNodeId] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [comparisonQueue, setComparisonQueue] = useState<ComparisonQueueItem[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('creatorflow:comparison-queue:v1') ?? '[]') as ComparisonQueueItem[];
      return stored.filter((item) => heavyAssets.some((asset) => asset.id === item.assetId && asset.componentMatches?.some((match) => match.id === item.componentId)));
    } catch {
      return [];
    }
  });
  const selected = heavyAssets.find((asset) => asset.id === selectedId) ?? heavyAssets[0];
  const selectedComponent = selected.componentMatches?.find((match) => match.id === selectedComponentId);
  const focusedSceneNode = sceneNodes.find((node) => node.id === focusedSceneNodeId);
  const comparisonAsset = selectedComponent ? heavyAssets.find((asset) => asset.id === selectedComponent.source.assetId) : undefined;
  const visibleAssets = heavyAssets.filter((asset) => assetFilter === 'all'
    || (assetFilter === 'roblox' ? Boolean(asset.robloxWorkflow) : assetFilter === 'matched' ? Boolean(asset.componentMatches?.length) : asset.bytes >= 100_000_000));
  const visibleMatches = useMemo(() => selected.componentMatches?.filter((match) => match.similarity >= confidenceThreshold) ?? [], [confidenceThreshold, selected.componentMatches]);
  const queueIndex = comparisonQueue.findIndex((item) => item.assetId === selected.id && item.componentId === selectedComponentId);
  const selectedPinned = queueIndex >= 0;

  useEffect(() => {
    try {
      localStorage.setItem('creatorflow:comparison-queue:v1', JSON.stringify(comparisonQueue));
    } catch {
      // The comparison queue still works for this mounted session when storage is unavailable.
    }
  }, [comparisonQueue]);

  useEffect(() => {
    if (!selectedComponentId || !sceneNodes.length) return;
    const node = sceneNodes.filter((item) => item.matchIds.includes(selectedComponentId)).sort((a, b) => b.depth - a.depth)[0];
    if (node) setFocusedSceneNodeId(node.id);
  }, [sceneNodes, selectedComponentId]);

  useEffect(() => {
    const params = workspaceParams();
    params.set('view', 'assets');
    params.set('asset', selected.id);
    if (selectedComponentId) params.set('component', selectedComponentId); else params.delete('component');
    params.set('load', loadedId === selected.id ? '1' : '0');
    params.set('compare', comparisonActive ? '1' : '0');
    params.set('compareMode', comparisonMode);
    params.set('diff', differenceMode);
    window.history.replaceState(null, '', `#workspace?${params.toString()}`);
  }, [comparisonActive, comparisonMode, differenceMode, loadedId, selected.id, selectedComponentId]);

  function select(id: string) {
    const nextAsset = heavyAssets.find((asset) => asset.id === id);
    setSelectedId(id);
    setLoadedId(null);
    setSelectedComponentId(null);
    setDifferenceMode('highlight');
    setComparisonActive(false);
    setComparisonMode('side');
    setMatchMapEnabled(Boolean(nextAsset?.componentMatches?.length));
    setSceneNodes([]);
    setFocusedSceneNodeId(null);
  }

  function selectComponent(id: string) {
    setSelectedComponentId(id);
    setDifferenceMode('highlight');
    setComparisonActive(false);
    setMatchMapEnabled(true);
  }

  function selectSceneNode(id: string) {
    setFocusedSceneNodeId(id);
    const node = sceneNodes.find((item) => item.id === id);
    if (node?.matchIds.length === 1) selectComponent(node.matchIds[0]);
  }

  function changeThreshold(value: number) {
    setConfidenceThreshold(value);
    if (selectedComponent && selectedComponent.similarity < value) {
      setSelectedComponentId(null);
      setComparisonActive(false);
    }
  }

  function togglePinned() {
    if (!selectedComponentId) return;
    const key = `${selected.id}:${selectedComponentId}`;
    setComparisonQueue((current) => selectedPinned ? current.filter((item) => `${item.assetId}:${item.componentId}` !== key) : [...current, { assetId: selected.id, componentId: selectedComponentId }]);
  }

  function openQueueItem(item: ComparisonQueueItem) {
    setSelectedId(item.assetId);
    setLoadedId(item.assetId);
    setSelectedComponentId(item.componentId);
    setComparisonActive(true);
    setMatchMapEnabled(true);
    setSceneNodes([]);
    setFocusedSceneNodeId(null);
  }

  async function copyViewLink() {
    const params = workspaceParams();
    params.set('view', 'assets');
    params.set('asset', selected.id);
    params.set('load', loadedId === selected.id ? '1' : '0');
    if (selectedComponentId) params.set('component', selectedComponentId); else params.delete('component');
    params.set('compare', comparisonActive ? '1' : '0');
    params.set('compareMode', comparisonMode);
    params.set('diff', differenceMode);
    const url = `${window.location.origin}${window.location.pathname}#workspace?${params.toString()}`;
    try {
      await Promise.race([
        navigator.clipboard.writeText(url),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Clipboard timeout')), 600)),
      ]);
      setLinkStatus('copied');
    } catch {
      const field = document.createElement('textarea');
      field.value = url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      setLinkStatus(document.execCommand('copy') ? 'copied' : 'error');
      field.remove();
    }
    window.setTimeout(() => setLinkStatus('idle'), 1800);
  }

  return (
    <div className="workspace-assets-view">
      <RobloxAssetStressSet />
      <section className="asset-browser">
        <header><div><span>Bundled licensed fixtures</span><strong>Interactive rigs and production GLBs</strong></div><small>{heavyPayloadMb} MB actual GLB payload · load on demand</small></header>
        <div className="asset-browser-columns">
          <div className="heavy-asset-list" role="list" aria-label="Complex project assets">
            <div className="heavy-asset-filterbar" aria-label="Filter complex assets">
              <button type="button" className={assetFilter === 'all' ? 'selected' : ''} onClick={() => setAssetFilter('all')}>All</button>
              <button type="button" className={assetFilter === 'roblox' ? 'selected' : ''} onClick={() => setAssetFilter('roblox')}>Roblox workflow</button>
              <button type="button" className={assetFilter === 'matched' ? 'selected' : ''} onClick={() => setAssetFilter('matched')}>Has matches</button>
              <button type="button" className={assetFilter === '100mb' ? 'selected' : ''} onClick={() => setAssetFilter('100mb')}>100 MB+</button>
            </div>
            {visibleAssets.map((asset) => (
              <button key={asset.id} type="button" onClick={() => select(asset.id)} className={asset.id === selected.id ? 'selected' : ''} aria-pressed={asset.id === selected.id}>
                <img src={asset.previewUrl} alt="" />
                <span><strong>{asset.name}</strong><small>{asset.projectPath}</small>{asset.robloxWorkflow ? <small className="asset-match-count"><Activity size={11} /> {asset.robloxWorkflow.label}</small> : asset.componentMatches?.length ? <small className="asset-match-count"><GitCompare size={11} /> {asset.componentMatches.length} component matches</small> : null}</span>
                <em>{asset.size}</em>
              </button>
            ))}
          </div>
          <div className="heavy-asset-detail">
            <div className="scene-modebar">
              <div className="scene-mode-tabs"><button type="button" className={!matchMapEnabled && !comparisonActive ? 'selected' : ''} onClick={() => { setMatchMapEnabled(false); setComparisonActive(false); }}>Scene</button><button type="button" className={matchMapEnabled && !comparisonActive ? 'selected' : ''} onClick={() => { setMatchMapEnabled(true); setComparisonActive(false); }} disabled={!selected.componentMatches?.length}><ScanSearch size={13} /> Match map</button></div>
              <span>{comparisonActive && selectedComponent ? `${selected.name} / ${selectedComponent.project.label} / comparison` : selectedComponent ? `${selected.name} / ${selectedComponent.project.label}` : `${selected.name} / full scene`}</span>
              <div className="scene-mode-actions"><button type="button" onClick={copyViewLink} aria-label="Copy shareable view link"><Share2 size={13} /> {linkStatus === 'copied' ? 'Copied' : linkStatus === 'error' ? 'Copy failed' : 'Share view'}</button>{comparisonActive ? <button type="button" onClick={() => setComparisonActive(false)}><ArrowLeft size={13} /> Back</button> : null}</div>
            </div>
            {selectedComponent ? (
              <div className={`difference-modebar ${comparisonActive ? 'difference-modebar--comparison' : ''}`}>
                <span>{comparisonActive ? 'Pair display' : 'Difference view'}</span>
                {comparisonActive ? (
                  <div role="group" aria-label="Component comparison display">
                    {(['side', 'overlay', 'blink', 'heatmap'] as ComparisonViewMode[]).map((mode) => <button key={mode} type="button" aria-pressed={comparisonMode === mode} onClick={() => setComparisonMode(mode)}>{mode === 'side' ? 'Side by side' : mode === 'overlay' ? 'Overlay' : mode === 'blink' ? 'Blink A/B' : 'Deviation heatmap'}</button>)}
                  </div>
                ) : (
                  <div role="group" aria-label="Difference display">
                    {(['highlight', 'ghost', 'isolate'] as DifferenceViewMode[]).map((mode) => <button key={mode} type="button" aria-pressed={differenceMode === mode} onClick={() => setDifferenceMode(mode)}>{mode === 'highlight' ? 'Highlight' : mode === 'ghost' ? 'Ghost context' : 'Isolate'}</button>)}
                  </div>
                )}
                <small>{comparisonActive ? comparisonMode === 'overlay' ? 'Blue project · amber source' : comparisonMode === 'blink' ? 'Motion-safe fallback included' : comparisonMode === 'heatmap' ? 'Blue near · coral far' : 'Equal normalized frames' : 'Selected part remains clickable'}</small>
              </div>
            ) : null}
            {comparisonQueue.length ? <section className="comparison-queue-strip" aria-label="Pinned comparison queue"><header><Pin size={13} /><span>Pinned comparisons</span><strong>{queueIndex >= 0 ? `${queueIndex + 1} of ${comparisonQueue.length}` : `${comparisonQueue.length} queued`}</strong></header><div><button type="button" disabled={queueIndex <= 0} onClick={() => openQueueItem(comparisonQueue[queueIndex - 1])} aria-label="Previous pinned comparison"><ChevronLeft size={14} /></button><div>{comparisonQueue.map((item, index) => { const asset = heavyAssets.find((candidate) => candidate.id === item.assetId); const match = asset?.componentMatches?.find((candidate) => candidate.id === item.componentId); return <button key={`${item.assetId}:${item.componentId}`} type="button" className={index === queueIndex ? 'selected' : ''} aria-current={index === queueIndex ? 'true' : undefined} onClick={() => openQueueItem(item)}><span>{asset?.name.replace('.glb', '')}</span><strong>{match?.project.label}</strong><small>{match?.similarity}%</small></button>; })}</div><button type="button" disabled={queueIndex < 0 || queueIndex >= comparisonQueue.length - 1} onClick={() => openQueueItem(comparisonQueue[queueIndex + 1])} aria-label="Next pinned comparison"><ChevronRight size={14} /></button><button type="button" onClick={() => setComparisonQueue([])}>Clear</button></div></section> : null}
            <div className={`asset-investigation-layout ${loadedId === selected.id ? 'with-tree' : ''}`}>
            <div className="heavy-preview-stage">
              {loadedId === selected.id ? (
                <Suspense fallback={<div className="heavy-preview-skeleton">Preparing 3D runtime…</div>}>
                  <HeavyAssetViewer assetId={selected.id} url={selected.modelUrl} label={selected.name} previewUrl={selected.previewUrl} size={selected.size} componentMatches={visibleMatches} selectedComponentId={selectedComponentId} onSelectComponent={selectComponent} onSceneIndex={setSceneNodes} focusedSceneNodeId={focusedSceneNodeId} matchMapEnabled={matchMapEnabled} differenceMode={differenceMode} comparisonActive={comparisonActive} comparisonMode={comparisonMode} comparisonSourceUrl={comparisonAsset?.modelUrl} />
                </Suspense>
              ) : (
                <>
                  <img src={selected.previewUrl} alt={`${selected.name} source preview`} />
                  <div className="heavy-preview-gate">
                    <span><HardDrive size={15} /> On-demand payload · {selected.size}</span>
                    <strong>{selected.componentMatches?.length ? `${selected.componentMatches.length} component matches are indexed before the GLB opens.` : 'Preview stays light until you ask for the model.'}</strong>
                    <button className="button button-primary" type="button" onClick={() => setLoadedId(selected.id)}><Play size={15} /> Load interactive GLB</button>
                  </div>
                </>
              )}
            </div>
            {loadedId === selected.id ? <SceneTreePanel nodes={sceneNodes} selectedNodeId={focusedSceneNodeId} onSelectNode={selectSceneNode} /> : null}
            </div>
            <div className="heavy-detail-copy">
              <div><span>Selected asset</span><h2>{selected.name}</h2><p>{selected.description}</p>{selected.componentMatches?.length || selected.robloxWorkflow ? <div className="asset-capability-badges"><i>{selected.size}</i>{selected.componentMatches?.length ? <><i>{selected.componentMatches.length} matched pairs</i><i>Mesh-level selection</i></> : null}{selected.robloxWorkflow ? <i>{selected.robloxWorkflow.label}</i> : null}</div> : null}{selected.robloxWorkflow ? <small className="roblox-workflow-disclosure">{selected.robloxWorkflow.note}</small> : null}</div>
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Open source record <ExternalLink size={14} /></a>
            </div>
            <MetadataInspector
              kind={focusedSceneNode ? 'Scene object' : selectedComponent ? 'Component finding' : 'Asset'}
              title={focusedSceneNode?.name ?? selectedComponent?.project.label ?? selected.name}
              subtitle={focusedSceneNode ? `${focusedSceneNode.type} inside ${selected.name}` : selectedComponent ? `${selectedComponent.similarity}% relationship in ${selected.name}` : selected.projectPath}
              defaultOpen={Boolean(focusedSceneNode || selectedComponent)}
              sections={[
                {
                  title: focusedSceneNode ? 'Object record' : selectedComponent ? 'Finding record' : 'Asset record',
                  fields: focusedSceneNode ? [
                    { label: 'Runtime object ID', value: focusedSceneNode.id, mono: true, copyValue: focusedSceneNode.id, note: 'Viewer-session identifier; not a stable Roblox Instance ID.' },
                    { label: 'Name / type', value: `${focusedSceneNode.name} / ${focusedSceneNode.type}` },
                    { label: 'Hierarchy depth', value: focusedSceneNode.depth },
                    { label: 'Children', value: focusedSceneNode.childCount },
                    { label: 'Triangles', value: focusedSceneNode.triangleCount?.toLocaleString() ?? 'Not applicable' },
                    { label: 'Visible', value: focusedSceneNode.visible === false ? 'No' : 'Yes' },
                  ] : selectedComponent ? [
                    { label: 'Finding ID', value: selectedComponent.id, mono: true, copyValue: selectedComponent.id },
                    { label: 'Relationship', value: selectedComponent.kind },
                    { label: 'Similarity', value: `${selectedComponent.similarity}%` },
                    { label: 'Method', value: selectedComponent.method },
                    { label: 'Project nodes', value: selectedComponent.project.nodeNames.join(', '), mono: true },
                    { label: 'Source nodes', value: selectedComponent.source.nodeNames.join(', '), mono: true },
                  ] : [
                    { label: 'Asset ID', value: selected.id, mono: true, copyValue: selected.id },
                    { label: 'Project path', value: selected.projectPath, mono: true, copyValue: selected.projectPath },
                    { label: 'File / bytes', value: `${selected.name} / ${selected.bytes.toLocaleString()}` },
                    { label: 'SHA-256', value: selected.hash, mono: true, copyValue: selected.hash },
                    { label: 'Scene summary', value: `${selected.nodes} nodes · ${selected.meshes} meshes · ${selected.primitives} primitives` },
                    { label: 'Materials / textures', value: `${selected.materials} / ${selected.textures}` },
                    ...(selected.robloxWorkflow ? [{ label: 'Roblox use case', value: selected.robloxWorkflow.label, note: selected.robloxWorkflow.note }] : []),
                  ],
                },
                {
                  title: 'Parent asset and provenance',
                  fields: [
                    { label: 'Asset', value: selected.name },
                    { label: 'Project path', value: selected.projectPath, mono: true },
                    { label: 'License', value: selected.license },
                    { label: 'Attribution', value: selected.attribution },
                    { label: 'Source record', value: selected.sourceUrl, mono: true, copyValue: selected.sourceUrl },
                    { label: 'Loaded locally', value: loadedId === selected.id ? 'Yes' : 'No · preview metadata only' },
                  ],
                },
                ...(selectedComponent ? [{
                  title: 'Compared relationship',
                  fields: [
                    { label: 'Project side', value: selectedComponent.project.label },
                    { label: 'Source side', value: selectedComponent.source.label },
                    { label: 'Explanation', value: selectedComponent.relationship },
                    { label: 'Display', value: comparisonActive ? comparisonMode : differenceMode },
                    { label: 'Review state', value: 'Unreviewed' },
                  ],
                }] : []),
              ]}
            />
            {selected.componentMatches?.length ? (
              <section className="subasset-match-panel" aria-labelledby="subasset-match-title">
                <header><div><span>Similar parts in this GLB</span><strong id="subasset-match-title">Select a highlighted component or choose a record.</strong></div><label className="match-threshold-control"><span>Minimum confidence <strong>{confidenceThreshold}%</strong></span><input type="range" min="0" max="100" step="1" value={confidenceThreshold} onChange={(event) => changeThreshold(Number(event.target.value))} aria-label="Minimum component match confidence" /><small>{visibleMatches.length} of {selected.componentMatches.length} visible</small></label></header>
                <div className="subasset-match-grid">
                  <div className="subasset-match-list">
                    {visibleMatches.length ? visibleMatches.map((match) => <button key={match.id} type="button" className={match.id === selectedComponentId ? 'selected' : ''} onClick={() => selectComponent(match.id)}><span><strong>{match.project.label}</strong><small>{match.kind === 'exact-instance' ? 'Exact shared instance' : match.kind === 'geometry' ? 'Geometry relationship' : 'Appearance relationship'}</small></span><em>{match.similarity}%</em></button>) : <div className="filtered-match-empty"><strong>No matches above {confidenceThreshold}%</strong><small>Lower the threshold to restore weaker candidates.</small></div>}
                  </div>
                  <div className="subasset-selection-tray">
                    {selectedComponent ? <><div><span>Selected component</span><strong>{selectedComponent.project.label}</strong><small>{selectedComponent.method}</small></div><div className="subasset-match-route"><span>{selectedComponent.project.label}</span><i>→</i><span>{selectedComponent.source.label}</span><strong>{selectedComponent.similarity}%</strong></div><p>{selectedComponent.relationship}</p><div className="subasset-selection-actions"><button className="button button-primary" type="button" onClick={() => { setLoadedId(selected.id); setComparisonMode('side'); setComparisonActive(true); }}><GitCompare size={15} /> Compare selected pair</button><button className="button button-secondary" type="button" onClick={togglePinned}>{selectedPinned ? <PinOff size={15} /> : <Pin size={15} />}{selectedPinned ? 'Unpin' : 'Pin comparison'}</button></div></> : <div className="subasset-empty"><ScanSearch size={19} /><strong>Choose a component finding</strong><p>After the GLB loads, you can also click any highlighted hull, rigging, sail, or chess piece directly in the viewport.</p></div>}
                  </div>
                </div>
                {selectedComponent ? <div className="subasset-difference-strip">{selectedComponent.differences.map((difference) => <div key={difference.label}><span>{difference.label}</span><p>{difference.project}</p><i>→</i><p>{difference.source}</p></div>)}</div> : null}
              </section>
            ) : null}
            <dl className="complexity-grid">
              <div><dt>Nodes</dt><dd>{selected.nodes}</dd></div>
              <div><dt>Meshes</dt><dd>{selected.meshes}</dd></div>
              <div><dt>Materials</dt><dd>{selected.materials}</dd></div>
              <div><dt>Textures</dt><dd>{selected.textures}</dd></div>
              <div><dt>Embedded images</dt><dd>{selected.images}</dd></div>
              <div><dt>SHA-256</dt><dd><code>{selected.hash.slice(0, 12)}…</code></dd></div>
            </dl>
            <div className="asset-extension-list"><span>Format and runtime features</span>{selected.extensions.map((extension) => <code key={extension}>{extension}</code>)}</div>
            <div className="asset-license-line"><FileCheck2 size={16} /><span><strong>{selected.license} · attribution stored</strong><small>{selected.attribution}</small></span><a href={selected.licenseUrl} target="_blank" rel="noreferrer">License <ExternalLink size={13} /></a></div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SourcesView({ onOpenEvidence }: { onOpenEvidence: () => void }) {
  const rows = [
    ['Khronos glTF Sample Assets', '9 records', 'CC0 / CC BY 4.0', 'Verified'],
    ['Poly Haven', '2 records', 'CC0 1.0', 'Verified'],
    ['MaterialX Project / ASWF', '1 record', 'CC BY 4.0', 'Attribution ready'],
    ['Sketchfab / Loïc Norgeot', '1 record', 'CC BY 4.0', 'Attribution ready'],
    ['Northwind team archive', '5 imports', 'References upstream', 'Linked'],
  ];
  return <section className="workspace-table-view"><header><span>Evidence library</span><h2>Sources and permission records</h2><p>Source records are attached once and reused across releases without uploading the creative payload.</p></header><table><thead><tr><th>Provider</th><th>Records</th><th>License coverage</th><th>State</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>)}</tbody></table><footer className="workspace-table-action"><span><strong>Need to resolve a missing source?</strong><small>The sample source table is an inventory. Decisions are recorded on the underlying evidence item.</small></span><button className="button button-primary" type="button" onClick={onOpenEvidence}>Open unresolved evidence</button></footer></section>;
}

function ReleasesView({ onOpenEvidence, onOpenReleaseFlow }: { onOpenEvidence: () => void; onOpenReleaseFlow: () => void }) {
  return <section className="workspace-table-view"><header><span>Sample evidence checkpoints</span><h2>Release records—not Roblox deployments</h2><p>Building a release here freezes the manifest, checks, and human decisions. It does not call Roblox or make an experience public.</p></header><aside className="release-record-boundary"><FileCheck2 size={16} /><span><strong>CreatorFlow prepares the handoff.</strong><small>Publishing the place version, choosing its audience, and moving live servers remain explicit Roblox actions.</small></span><button className="button button-secondary" type="button" onClick={onOpenReleaseFlow}>See the handoff steps</button><a href="https://create.roblox.com/docs/production/publishing/publish-games-and-places" target="_blank" rel="noreferrer">Roblox publishing guide <ExternalLink size={12} /></a></aside><div className="release-history"><article><span>Current sample</span><strong>Northwind 2.4.0-rc2</strong><small>7 authored decisions pending · 32-file proof pack</small><button className="button button-primary" type="button" onClick={onOpenEvidence}>Continue evidence review</button></article><article><span>Example evidence checkpoint</span><strong>Northwind 2.3.1</strong><small>Illustrative history · shared 32-file fixture pack</small><a href="/assets/creatorflow-real-assets-manifest.json" download="northwind-2.3.1-demo-proof.json">Download demo proof pack</a></article><article><span>Example evidence checkpoint</span><strong>Northwind 2.3.0</strong><small>Illustrative history · shared 32-file fixture pack</small><a href="/assets/creatorflow-real-assets-manifest.json" download="northwind-2.3.0-demo-proof.json">Download demo proof pack</a></article></div></section>;
}

const proofSteps: Array<{
  id: string;
  label: string;
  detail: string;
  signal: string;
  tone: 'clear' | 'local' | 'review' | 'waiting' | 'external';
  view: WorkspaceView;
  icon: typeof Fingerprint;
}> = [
  { id: 'snapshot', label: 'Snapshot', detail: 'Project scope', signal: 'SCOPED', tone: 'clear', view: 'overview', icon: FileCheck2 },
  { id: 'fingerprint', label: 'Fingerprint', detail: 'Local evidence', signal: 'LOCAL', tone: 'local', view: 'evidence', icon: Fingerprint },
  { id: 'source', label: 'Source', detail: 'Permission record', signal: '2 REVIEW', tone: 'review', view: 'sources', icon: Library },
  { id: 'decision', label: 'Decision', detail: 'Human release gate', signal: 'WAITING', tone: 'waiting', view: 'project', icon: ShieldCheck },
  { id: 'handoff', label: 'Roblox', detail: 'Studio handoff', signal: 'EXTERNAL', tone: 'external', view: 'releases', icon: ExternalLink },
];

function proofStepForView(view: WorkspaceView) {
  if (view === 'overview') return 'snapshot';
  if (view === 'sources') return 'source';
  if (view === 'project') return 'decision';
  if (view === 'releases') return 'handoff';
  return 'fingerprint';
}

function WorkspaceProofRibbon({ view, onNavigate, datasetLabel }: { view: WorkspaceView; onNavigate: (view: WorkspaceView) => void; datasetLabel: string }) {
  const activeId = proofStepForView(view);
  return (
    <section className="workspace-proof-ribbon" aria-label={`${datasetLabel} proof ribbon`}>
      <div className="workspace-proof-ribbon-heading">
        <span>Proof ribbon</span>
        <strong>{datasetLabel}</strong>
        <small>Content stays local. Decisions travel with the release record.</small>
      </div>
      <ol>
        {proofSteps.map((step, index) => {
          const Icon = step.icon;
          const active = step.id === activeId;
          return (
            <li key={step.id} data-tone={step.tone}>
              <button type="button" onClick={() => onNavigate(step.view)} aria-current={active ? 'step' : undefined}>
                {active ? <motion.span className="workspace-proof-cursor" layoutId="workspace-proof-cursor" transition={{ type: 'spring', stiffness: 380, damping: 34 }} /> : null}
                <i><Icon size={13} /><em>{String(index + 1).padStart(2, '0')}</em></i>
                <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                <b>{step.signal}</b>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ProductWorkspaceContent({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<WorkspaceView>(readWorkspaceView);
  const [importedProject, setImportedProject] = useState<ImportedProject | null>(null);
  const [activeDataset, setActiveDataset] = useState<'sample' | 'imported' | 'local'>('sample');
  const [bridgeClient, setBridgeClient] = useState<LocalBridgeClient | null>(null);
  const [localProject, setLocalProject] = useState<LocalProjectSummary | null>(null);
  const [localRun, setLocalRun] = useState<LocalScanRun | null>(null);
  const [localSelectedAssetId, setLocalSelectedAssetId] = useState<number | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectMetadataOpen, setProjectMetadataOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState('');
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [importing, setImporting] = useState(false);
  const reduceMotion = useReducedMotion();
  const importInputRef = useRef<HTMLInputElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const activeImport = activeDataset === 'imported' ? importedProject : null;
  const activeManifest = activeImport?.manifest;
  const activeLocal = activeDataset === 'local' ? localProject : null;
  const projectName = activeLocal?.name ?? activeManifest?.project.name ?? 'Northwind';
  const projectSubtitle = activeLocal ? 'Desktop local project' : activeManifest ? `Release ${activeManifest.project.release}` : 'Sample scenario';
  const projectInitials = projectName.split(/\s+|[-_]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CF';

  const navigationItems = useMemo(() => navigation.map((item) => {
    if (activeLocal) {
      if (item.id === 'project') return { ...item, label: 'Scan run', phase: 'snapshot' as const, count: localRun ? titleCaseRunState(localRun.state) : undefined };
      if (item.id === 'assets' || item.id === 'motion') return { ...item, count: 'demo' };
      if (item.id === 'stress') return { ...item, count: '6' };
      if (item.id === 'evidence') return { ...item, count: localRun?.supportedCount ? localRun.supportedCount.toLocaleString() : undefined };
      if (item.id === 'sources' || item.id === 'releases') return { ...item, count: undefined };
      return item;
    }
    if (!activeManifest) return item;
    if (item.id === 'project') return { ...item, label: 'Snapshot review', phase: 'snapshot' as const };
    if (item.id === 'assets' || item.id === 'motion') return { ...item, count: 'demo' };
    if (item.id === 'stress') return { ...item, count: '6' };
    if (item.id === 'evidence') return { ...item, count: activeManifest.assets.length.toLocaleString() };
    if (item.id === 'sources') return { ...item, count: sourceGroups(activeManifest).length.toLocaleString() };
    if (item.id === 'releases') return { ...item, count: '1' };
    return { ...item, count: undefined };
  }), [activeLocal, activeManifest, localRun]);

  useEffect(() => {
    const sync = () => setView(readWorkspaceView());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void LocalBridgeClient.detect(controller.signal).then((client) => {
      if (!client || controller.signal.aborted) return;
      setBridgeClient(client);
      const restoreFallback = () => {
        try {
          const stored = JSON.parse(localStorage.getItem('creatorflow:local-project:v1') ?? 'null') as Partial<LocalProjectSummary> | null;
          if (!stored || typeof stored.projectId !== 'number' || typeof stored.name !== 'string') return;
          void client.listProjectAssets(stored.projectId, 1, 0).then(async (page) => {
            if (controller.signal.aborted) return;
            setLocalProject({ projectId: stored.projectId!, name: stored.name!, experience: stored.experience ?? null });
            if (page.scanRunId) setLocalRun(await client.getScanRun(page.scanRunId));
          }).catch(() => localStorage.removeItem('creatorflow:local-project:v1'));
        } catch {
          localStorage.removeItem('creatorflow:local-project:v1');
        }
      };
      void Promise.all([client.listProjects(), client.getWorkspaceState()]).then(async ([projects, workspace]) => {
        if (controller.signal.aborted) return;
        const restored = projects.items.find((project) => project.projectId === workspace.activeProjectId) ?? projects.items[0];
        if (!restored) return;
        const summary: LocalProjectSummary = { projectId: restored.projectId, name: restored.name, experience: restored.experience ?? null };
        setLocalProject(summary);
        localStorage.setItem('creatorflow:local-project:v1', JSON.stringify(summary));
        if (workspace.activeProjectId === restored.projectId) {
          setActiveDataset('local');
          if (readWorkspaceView() === 'overview') setView('project');
          setLocalSelectedAssetId(workspace.selectedAssetId);
        }
        const runId = workspace.activeScanRunId ?? restored.activeScanRunId;
        if (runId) setLocalRun(await client.getScanRun(runId));
      }).catch(restoreFallback);
    });
    return () => controller.abort();
  }, []);

  const handleLocalRunChange = useCallback((run: LocalScanRun | null) => {
    setLocalRun(run);
    if (bridgeClient && localProject) {
      void bridgeClient.saveWorkspaceState({ activeProjectId: localProject.projectId, activeScanRunId: run?.id ?? null }).catch(() => undefined);
    }
  }, [bridgeClient, localProject]);

  const handleExperienceBound = useCallback((record: LocalProjectRecord) => {
    setLocalProject((current) => {
      if (!current || current.projectId !== record.projectId) return current;
      const next: LocalProjectSummary = { ...current, experience: record.experience ?? null };
      try {
        localStorage.setItem('creatorflow:local-project:v1', JSON.stringify(next));
      } catch {
        // Persisted restore is best-effort; the in-memory declaration is already current.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const closeForPointer = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProjectMenuOpen(false);
        projectMenuRef.current?.querySelector<HTMLButtonElement>('.project-switcher')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeForPointer);
    document.addEventListener('keydown', closeForEscape);
    return () => {
      document.removeEventListener('pointerdown', closeForPointer);
      document.removeEventListener('keydown', closeForEscape);
    };
  }, [projectMenuOpen]);

  function changeView(nextView: WorkspaceView) {
    setView(nextView);
    setNotificationsOpen(false);
    setProjectMetadataOpen(false);
    window.history.pushState(null, '', `#workspace?view=${nextView}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openAsset(assetId = heavyAssets[0].id) {
    setView('assets');
    setNotificationsOpen(false);
    setProjectMetadataOpen(false);
    const params = new URLSearchParams({ view: 'assets', asset: assetId, load: '0', compare: '0', compareMode: 'side', diff: 'highlight' });
    window.history.pushState(null, '', `#workspace?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function submitWorkspaceSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = workspaceQuery.trim().toLowerCase();
    if (!query) {
      setImportNotice({ tone: 'info', title: 'Search needs a term', detail: 'Try an asset name, animation, source, evidence, system check, or release.' });
      return;
    }

    const asset = heavyAssets.find((item) => `${item.name} ${item.projectPath} ${item.description} ${item.robloxWorkflow?.label ?? ''}`.toLowerCase().includes(query));
    if (asset) {
      openAsset(asset.id);
      setImportNotice({ tone: 'info', title: `Opened ${asset.name}`, detail: `Matched ${asset.projectPath}. The GLB remains load-on-demand.` });
      return;
    }

    const destination: WorkspaceView = /anim|motion|retime|rig/.test(query)
      ? 'motion'
      : /source|license|permission|owner/.test(query)
        ? 'sources'
        : /evidence|hash|finding|decision/.test(query)
          ? 'evidence'
          : /system|fixture|broken|dependency|format/.test(query)
            ? 'stress'
            : /publish|release|gate|handoff/.test(query)
              ? 'project'
              : 'assets';
    changeView(destination);
    setImportNotice({ tone: 'info', title: `Opened ${navigation.find((item) => item.id === destination)?.label ?? destination}`, detail: `No exact asset matched “${workspaceQuery.trim()},” so CreatorFlow opened the closest workspace.` });
  }

  function clearSavedViewState() {
    try {
      ['creatorflow:release-map', 'creatorflow:comparison-queue:v1'].forEach((key) => localStorage.removeItem(key));
      setImportNotice({ tone: 'success', title: 'Saved view state cleared', detail: 'Release map positions and pinned asset comparisons will use their defaults the next time they open.' });
      return true;
    } catch {
      setImportNotice({ tone: 'info', title: 'Browser storage unavailable', detail: 'There is no persisted map or comparison state to clear. Current in-memory views still work.' });
      return false;
    }
  }

  function activateSample() {
    setActiveDataset('sample');
    setProjectMenuOpen(false);
    setImportNotice({ tone: 'info', title: 'Sample scenario active', detail: importedProject ? 'Your imported snapshot remains available in the project switcher.' : 'Northwind is authored demonstration data.' });
  }

  function activateImported() {
    if (!importedProject) return;
    setActiveDataset('imported');
    setProjectMenuOpen(false);
    setImportNotice({ tone: 'info', title: `${importedProject.manifest.project.name} reopened`, detail: 'The validated snapshot remains read-only and in memory for this browser session.' });
  }

  function activateLocal() {
    if (!localProject || !bridgeClient) return;
    setActiveDataset('local');
    setProjectMenuOpen(false);
    setImportNotice({ tone: 'info', title: `${localProject.name} reopened`, detail: 'Persisted scanner records and decisions remain on this machine.' });
    void bridgeClient.saveWorkspaceState({ activeProjectId: localProject.projectId, activeScanRunId: localRun?.id ?? null }).catch(() => undefined);
    changeView('project');
  }

  async function openLocalProject() {
    if (!bridgeClient) return;
    setProjectMenuOpen(false);
    try {
      const project = await bridgeClient.pickProject();
      if (!project) return;
      const summary: LocalProjectSummary = { ...project, experience: project.experience ?? null };
      setLocalProject(summary);
      setLocalRun(null);
      setLocalSelectedAssetId(null);
      setActiveDataset('local');
      localStorage.setItem('creatorflow:local-project:v1', JSON.stringify(summary));
      void bridgeClient.saveWorkspaceState({ activeProjectId: summary.projectId, activeScanRunId: null }).catch(() => undefined);
      setImportNotice({ tone: 'success', title: `${summary.name} selected locally`, detail: 'Folder permission came from the native desktop picker. No creative payload was uploaded.' });
      changeView('project');
    } catch (reason) {
      setImportNotice({ tone: 'error', title: 'Local project could not be opened', detail: reason instanceof Error ? reason.message : 'The desktop bridge rejected the project selection.' });
    }
  }

  function openImporter() {
    setProjectMenuOpen(false);
    importInputRef.current?.click();
  }

  function clearImportedProject() {
    const clearedName = importedProject?.manifest.project.name ?? 'Imported project';
    setImportedProject(null);
    if (activeDataset === 'imported') setActiveDataset('sample');
    setProjectMenuOpen(false);
    setImportNotice({ tone: 'info', title: `${clearedName} cleared`, detail: 'The original JSON file was not changed. Northwind sample data is active again.' });
  }

  async function importManifest(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    const result = await validateManifestFile(file);
    setImporting(false);
    if (!result.ok) {
      setImportNotice({
        tone: 'error',
        title: importedProject ? 'Replacement rejected — current project preserved' : 'Manifest import rejected',
        detail: `${file.name} did not pass CreatorFlow manifest validation.`,
        issues: result.issues,
      });
      return;
    }

    const next: ImportedProject = { manifest: result.manifest, fileName: file.name, fileBytes: file.size, importedAt: new Date().toISOString() };
    setImportedProject(next);
    setActiveDataset('imported');
    setImportNotice({ tone: 'success', title: `${result.manifest.project.name} imported`, detail: `${result.manifest.assets.length.toLocaleString()} scanner records validated. No creative asset payloads were opened or uploaded.` });
    changeView('overview');
  }

  return (
    <div className="product-workspace">
      <WorkspaceWelcome onNavigate={changeView} />
      <aside className="product-sidebar">
        <button className="product-sidebar-brand" type="button" onClick={onExit} aria-label="Return to CreatorFlow landing page"><BrandMark /></button>
        <div className="project-switcher-wrap" ref={projectMenuRef}>
          <button className="project-switcher" type="button" onClick={() => setProjectMenuOpen((current) => !current)} aria-haspopup="menu" aria-expanded={projectMenuOpen} aria-label={`Switch project. Current dataset: ${projectName}, ${activeLocal ? 'desktop local project' : activeManifest ? 'imported scanner snapshot' : 'sample scenario'}`}>
            <span>{projectInitials}</span><div><strong>{projectName}</strong><small>{activeLocal ? 'Desktop local project' : activeManifest ? 'Imported snapshot' : 'Sample scenario'}</small></div><ChevronDown size={14} />
          </button>
          {projectMenuOpen ? (
            <div className="project-switcher-menu" role="menu" aria-label="Project datasets">
              <span>Project data</span>
              <button type="button" role="menuitem" aria-current={activeDataset === 'sample' ? 'true' : undefined} onClick={activateSample}><span>NP</span><div><strong>Northwind</strong><small>Sample scenario</small></div>{activeDataset === 'sample' ? <Check size={14} /> : null}</button>
              {localProject && bridgeClient ? <button type="button" role="menuitem" aria-current={activeDataset === 'local' ? 'true' : undefined} onClick={activateLocal}><span>{localProject.name.slice(0, 2).toUpperCase()}</span><div><strong>{localProject.name}</strong><small>Persisted local project</small></div>{activeDataset === 'local' ? <Check size={14} /> : null}</button> : null}
              {importedProject ? <button type="button" role="menuitem" aria-current={activeDataset === 'imported' ? 'true' : undefined} onClick={activateImported}><span>{importedProject.manifest.project.name.slice(0, 2).toUpperCase()}</span><div><strong>{importedProject.manifest.project.name}</strong><small>Imported · {importedProject.manifest.project.release}</small></div>{activeDataset === 'imported' ? <Check size={14} /> : null}</button> : null}
              <div className="project-switcher-menu-actions">
                {bridgeClient ? <button type="button" role="menuitem" onClick={() => { void openLocalProject(); }} aria-label={localProject ? 'Choose another local project with desktop folder picker' : 'Open local project with desktop folder picker'}><FolderOpen size={14} /> {localProject ? 'Choose another local project…' : 'Open local project…'}</button> : null}
                <button type="button" role="menuitem" onClick={openImporter} aria-label={importedProject ? 'Replace imported scanner manifest' : 'Import scanner manifest'}><Upload size={14} /> {importedProject ? 'Replace imported manifest…' : 'Import scanner manifest…'}</button>
                {importedProject ? <button type="button" role="menuitem" onClick={clearImportedProject} aria-label="Clear imported project"><Trash2 size={14} /> Clear imported snapshot</button> : null}
              </div>
            </div>
          ) : null}
        </div>
        <input ref={importInputRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Choose CreatorFlow manifest JSON" onChange={(event) => { void importManifest(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        <nav aria-label="Product workspace, ordered by proof stage">
          {navigationPhases.filter((phase) => navigationItems.some((item) => item.phase === phase.id)).map((phase) => (
            <div className="product-nav-group" data-phase={phase.id} key={phase.id}>
              <span className="product-nav-group-label">{phase.label}</span>
              {navigationItems.filter((item) => item.phase === phase.id).map((item) => {
                const Icon = item.icon;
                const selected = view === item.id;
                return <button key={item.id} type="button" className={selected ? 'selected' : ''} onClick={() => changeView(item.id)} aria-label={`Open ${item.label}`} aria-pressed={selected}>{selected ? <motion.i className="product-nav-active-rail" layoutId="product-nav-active-rail" transition={{ type: 'spring', stiffness: 420, damping: 38 }} /> : null}<Icon size={16} /><span>{item.label}</span>{item.count ? <small>{item.count}</small> : null}</button>;
              })}
            </div>
          ))}
          <button className={`product-mobile-settings${view === 'settings' ? ' selected' : ''}`} type="button" onClick={() => changeView('settings')} aria-label="Open workspace settings" aria-current={view === 'settings' ? 'page' : undefined}><Settings size={16} /><span>Settings</span></button>
        </nav>
        <div className="product-sidebar-bottom"><button className={view === 'settings' ? 'selected' : ''} type="button" aria-label="Open workspace settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => changeView('settings')}><Settings size={16} /><span>Settings</span></button><button type="button" aria-label="Return to CreatorFlow landing page" onClick={onExit}><ArrowLeft size={16} /><span>Back to site</span></button></div>
      </aside>

      <div className="product-workspace-main">
        <header className="product-topbar">
          <div><span>{projectName} · {projectSubtitle}</span><strong>{view === 'settings' ? 'Settings' : navigationItems.find((item) => item.id === view)?.label}</strong><small className="dataset-indicator" aria-label={`Active dataset: ${activeLocal ? 'desktop local project' : activeManifest ? 'imported scanner snapshot' : 'sample scenario'}`}>{activeLocal ? 'Desktop local project' : activeManifest ? 'Imported scanner snapshot' : 'Sample scenario'}</small></div>
          <form className="product-search" role="search" onSubmit={submitWorkspaceSearch}><label><Search size={15} /><input aria-label="Search current project" value={workspaceQuery} onChange={(event) => setWorkspaceQuery(event.target.value)} placeholder={activeLocal ? 'Find a workspace or demo asset…' : activeManifest ? 'Find a workspace or demo asset…' : 'Asset, animation, evidence, release…'} /></label><button type="submit" aria-label="Search CreatorFlow workspace"><Search size={15} /></button></form>
          <button className="project-metadata-trigger" type="button" aria-expanded={projectMetadataOpen} onClick={() => setProjectMetadataOpen((current) => !current)}><FileJson2 size={16} /><span>Metadata</span></button>
          <button type="button" aria-label={activeLocal || activeManifest ? 'No notifications for current read-only workspace state' : 'Notifications'} aria-expanded={activeLocal || activeManifest ? undefined : notificationsOpen} disabled={Boolean(activeLocal || activeManifest)} onClick={() => setNotificationsOpen((current) => !current)}><Bell size={17} />{activeLocal || activeManifest ? null : <i />}</button>
          <div className="workspace-user"><span>BC</span><div><strong>Bryan Cruz</strong><small>Owner</small></div></div>
        </header>

        {view !== 'settings' ? <WorkspaceProofRibbon view={view} onNavigate={changeView} datasetLabel={`${projectName} · ${activeLocal ? 'local project' : activeManifest ? 'imported snapshot' : 'sample trace'}`} /> : null}

        {projectMetadataOpen ? <section className="project-metadata-panel" aria-label="Current project metadata"><MetadataInspector
          kind="Project"
          title={projectName}
          subtitle={projectSubtitle}
          sections={[
            {
              title: 'Identity and scope',
              fields: [
                { label: 'Project name', value: projectName },
                { label: 'Project ID', value: activeLocal ? String(activeLocal.projectId) : activeManifest ? `manifest:${activeManifest.project.name}:${activeManifest.project.release}` : 'sample:northwind', mono: true, copyValue: activeLocal ? String(activeLocal.projectId) : activeManifest ? `manifest:${activeManifest.project.name}:${activeManifest.project.release}` : 'sample:northwind' },
                { label: 'Dataset', value: activeLocal ? 'Desktop local project' : activeManifest ? 'Imported read-only snapshot' : 'Authored sample scenario' },
                { label: 'Release', value: activeManifest?.project.release ?? (activeLocal ? 'Set during release export' : '2.4.0-rc2 sample') },
                { label: 'Intended experience', value: activeLocal?.experience ? `${activeLocal.experience.experienceName} (declared by you, not verified)` : activeManifest?.experience ? `${activeManifest.experience.experienceName} (declared, not verified)` : activeLocal ? 'Not yet declared' : activeManifest ? 'Not declared in this manifest' : 'Not applicable' },
                { label: 'Current view', value: navigationItems.find((item) => item.id === view)?.label ?? view },
              ],
            },
            {
              title: 'Evidence state',
              fields: [
                { label: 'Records', value: activeManifest ? activeManifest.assets.length.toLocaleString() : activeLocal ? (localRun?.supportedCount?.toLocaleString() ?? 'No completed scan') : '12,844 sample records' },
                { label: 'Active scan run', value: localRun?.id ?? (activeLocal ? 'None' : 'Not applicable'), mono: Boolean(localRun?.id), copyValue: localRun?.id },
                { label: 'Run state', value: localRun ? titleCaseRunState(localRun.state) : 'Not running' },
                { label: 'Snapshot generated', value: activeManifest ? new Date(activeManifest.generatedAt).toLocaleString() : activeLocal ? 'Stored by desktop scanner' : 'Authored demonstration' },
                { label: 'Payload policy', value: 'Creative files remain local; portable fingerprints and decisions form the evidence record.' },
              ],
            },
          ]}
        /></section> : null}

        {notificationsOpen ? <section className="workspace-utility-panel workspace-notifications-panel" aria-label="Sample notifications"><header><span><Bell size={15} /><strong>Sample notifications</strong></span><button type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}><X size={14} /></button></header><div><button type="button" onClick={() => changeView('motion')}><Activity size={15} /><span><strong>Animator sign-off is pending</strong><small>Open Animation compare and review the candidate evidence.</small></span><ChevronRight size={13} /></button><button type="button" onClick={() => changeView('sources')}><Library size={15} /><span><strong>Two permission records need attention</strong><small>Review the sample source inventory and unresolved evidence.</small></span><ChevronRight size={13} /></button></div></section> : null}

        {importNotice ? <div className={`manifest-import-notice notice-${importNotice.tone}`} role={importNotice.tone === 'error' ? 'alert' : 'status'} aria-live="polite"><div>{importNotice.tone === 'error' ? <X size={16} /> : <Check size={16} />}<span><strong>{importNotice.title}</strong><small>{importNotice.detail}</small>{importNotice.issues?.length ? <ul>{importNotice.issues.slice(0, 4).map((issue, index) => <li key={`${issue.path}-${issue.message}-${index}`}><code>{issue.path}</code> {issue.message}</li>)}{importNotice.issues.length > 4 ? <li>And {importNotice.issues.length - 4} more validation issue{importNotice.issues.length - 4 === 1 ? '' : 's'}.</li> : null}</ul> : null}</span></div><button type="button" aria-label="Dismiss import message" onClick={() => setImportNotice(null)}><X size={14} /></button></div> : null}
        {importing ? <div className="manifest-import-progress" role="status" aria-live="polite">Validating manifest schema and record totals…</div> : null}

        <main className={`product-view product-view-${view}`}>
          {view !== 'settings' ? (
            <WorkspaceDatasetBanner
              mode={activeLocal ? 'local' : activeManifest ? 'imported' : 'sample'}
              projectName={projectName}
              release={activeManifest?.project.release}
              onSwitch={() => setProjectMenuOpen(true)}
            />
          ) : null}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              className="product-view-frame"
              key={`${activeDataset}-${view}`}
              initial={reduceMotion ? false : { opacity: 0, y: 10, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(2px)' }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.25, 1, 0.5, 1] }}
            >
              {view === 'overview' ? activeLocal && bridgeClient ? <LocalProjectOverview client={bridgeClient} project={activeLocal} run={localRun} onOpenRun={() => changeView('project')} onOpenEvidence={() => changeView('evidence')} onExperienceBound={handleExperienceBound} /> : activeManifest && activeImport ? <ImportedProjectOverview manifest={activeManifest} fileBytes={activeImport.fileBytes} onOpenEvidence={() => changeView('evidence')} /> : <OverviewView onOpenAsset={openAsset} onOpenEvidence={() => changeView('evidence')} onOpenMotion={() => changeView('motion')} /> : null}
              {view === 'project' ? activeLocal && bridgeClient ? <LocalScanView client={bridgeClient} project={activeLocal} onRunChange={handleLocalRunChange} onOpenEvidence={() => changeView('evidence')} /> : activeManifest ? <ImportedProjectRun manifest={activeManifest} onOpenEvidence={() => changeView('evidence')} /> : <ReleasePathLab onNavigate={changeView} /> : null}
              {view === 'assets' ? <>{activeLocal ? <CapabilityDemoNotice projectName={activeLocal.name} kind="assets" dataset="local" /> : activeManifest ? <CapabilityDemoNotice projectName={activeManifest.project.name} kind="assets" /> : null}<AssetsView /></> : null}
              {view === 'gallery' ? <Suspense fallback={<div className="workspace-view-loading">Opening model gallery…</div>}><ModelGallery /></Suspense> : null}
              {view === 'motion' ? <Suspense fallback={<div className="workspace-view-loading">Opening animation comparison…</div>}><MotionComparisonLab bridgeClient={bridgeClient} project={localProject} /></Suspense> : null}
              {view === 'stress' ? <Suspense fallback={<div className="workspace-view-loading">Opening system check…</div>}><StressLab /></Suspense> : null}
              {view === 'evidence' ? activeLocal && bridgeClient ? <LocalEvidenceView client={bridgeClient} project={activeLocal} initialSelectedAssetId={localSelectedAssetId} onSelectAsset={setLocalSelectedAssetId} /> : activeManifest ? <ImportedEvidenceView manifest={activeManifest} /> : <div className="workspace-evidence-view"><PreflightWorkspace startSignal={0} /></div> : null}
              {view === 'sources' ? activeLocal ? <LocalSourcesBoundary onOpenEvidence={() => changeView('evidence')} /> : activeManifest ? <ImportedSourcesView manifest={activeManifest} /> : <SourcesView onOpenEvidence={() => changeView('evidence')} /> : null}
              {view === 'releases' ? activeLocal && bridgeClient ? <LocalReleasesView client={bridgeClient} project={activeLocal} run={localRun} /> : activeManifest && activeImport ? <ImportedReleasesView manifest={activeManifest} fileName={activeImport.fileName} /> : <ReleasesView onOpenEvidence={() => changeView('evidence')} onOpenReleaseFlow={() => changeView('project')} /> : null}
              {view === 'settings' ? <WorkspaceSettingsView onClearSavedViewState={clearSavedViewState} /> : null}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export function ProductWorkspace({ onExit }: { onExit: () => void }) {
  return <WorkspacePreferencesProvider><ProductWorkspaceContent onExit={onExit} /></WorkspacePreferencesProvider>;
}
