import {
  AlertTriangle,
  Box,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  FileBox,
  Folder,
  Gamepad2,
  MonitorUp,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  robloxProjectFindings,
  robloxProjectNodes,
  robloxProjectSnapshot,
  type ProjectEvidenceState,
  type RobloxProjectNode,
} from '../fixtures/robloxProjectExample';
import { MetadataInspector, type MetadataSection } from './MetadataInspector';

function evidenceLabel(state: ProjectEvidenceState) {
  if (state === 'clear') return 'Evidence clear';
  if (state === 'review') return 'Review';
  if (state === 'blocked') return 'Blocked';
  return 'Not evidence-scanned';
}

function NodeIcon({ node }: { node: RobloxProjectNode }) {
  if (node.kind === 'project') return <Gamepad2 size={14} />;
  if (node.kind === 'service') return <FileBox size={14} />;
  if (node.kind === 'folder') return <Folder size={14} />;
  if (node.kind === 'animation') return <Play size={14} />;
  if (node.kind === 'script') return <Code2 size={14} />;
  if (node.kind === 'ui') return <MonitorUp size={14} />;
  return <Box size={14} />;
}

export function RobloxProjectExample({ onOpenPair }: { onOpenPair: (clipName: string) => void }) {
  const [selectedId, setSelectedId] = useState('project');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['project', 'workspace', 'replicated-storage', 'assets', 'animations', 'guide-animations']));
  const [search, setSearch] = useState('');
  const [findingsOnly, setFindingsOnly] = useState(false);
  const [revision, setRevision] = useState(18);
  const [simulatedAt, setSimulatedAt] = useState<string | null>(null);

  const nodeMap = useMemo(() => new Map(robloxProjectNodes.map((node) => [node.id, node])), []);
  const childrenMap = useMemo(() => {
    const map = new Map<string | null, RobloxProjectNode[]>();
    robloxProjectNodes.forEach((node) => map.set(node.parentId, [...(map.get(node.parentId) ?? []), node]));
    return map;
  }, []);
  const selected = nodeMap.get(selectedId) ?? robloxProjectNodes[0];
  const selectedChildren = childrenMap.get(selected.id) ?? [];

  const visibleIds = useMemo(() => {
    if (!search.trim() && !findingsOnly) return new Set(robloxProjectNodes.map((node) => node.id));
    const query = search.trim().toLowerCase();
    const direct = robloxProjectNodes.filter((node) => {
      const searchMatch = !query || `${node.name} ${node.path} ${node.className}`.toLowerCase().includes(query);
      const findingMatch = !findingsOnly || Boolean(node.findingIds?.length);
      return searchMatch && findingMatch;
    });
    const ids = new Set<string>();
    direct.forEach((node) => {
      let current: RobloxProjectNode | undefined = node;
      while (current) {
        ids.add(current.id);
        current = current.parentId ? nodeMap.get(current.parentId) : undefined;
      }
    });
    return ids;
  }, [findingsOnly, nodeMap, search]);

  const breadcrumbs = useMemo(() => {
    const items: RobloxProjectNode[] = [];
    let current: RobloxProjectNode | undefined = selected;
    while (current) {
      items.unshift(current);
      current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    }
    return items;
  }, [nodeMap, selected]);

  function selectNode(id: string) {
    setSelectedId(id);
    const next = new Set(expanded);
    let current = nodeMap.get(id);
    while (current?.parentId) {
      next.add(current.parentId);
      current = nodeMap.get(current.parentId);
    }
    setExpanded(next);
  }

  function toggleNode(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function simulateStudioEdit() {
    setRevision((current) => current + 1);
    setSimulatedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    selectNode('animation-wave');
  }

  function renderTree(parentId: string | null, depth: number): ReactNode {
    return (childrenMap.get(parentId) ?? []).filter((node) => visibleIds.has(node.id)).map((node) => {
      const children = (childrenMap.get(node.id) ?? []).filter((child) => visibleIds.has(child.id));
      const open = expanded.has(node.id) || Boolean(search.trim()) || findingsOnly;
      return (
        <Fragment key={node.id}>
          <div className="roblox-tree-row" data-selected={selected.id === node.id} data-evidence={node.evidenceState} style={{ '--tree-depth': depth } as CSSProperties}>
            <button className="roblox-tree-toggle" type="button" disabled={!children.length} onClick={() => toggleNode(node.id)} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}><ChevronRight size={12} className={open ? 'open' : ''} /></button>
            <button className="roblox-tree-select" type="button" onClick={() => selectNode(node.id)} aria-current={selected.id === node.id ? 'true' : undefined}><NodeIcon node={node} /><span><strong>{node.name}</strong><small>{node.className}</small></span>{node.findingIds?.length ? <AlertTriangle size={12} /> : null}</button>
          </div>
          {children.length && open ? renderTree(node.id, depth + 1) : null}
        </Fragment>
      );
    });
  }

  const metadataSections: MetadataSection[] = [
    {
      title: 'Studio record',
      fields: [
        { label: 'Path', value: selected.path, mono: true, copyValue: selected.path },
        { label: 'Class', value: selected.className },
        { label: 'Evidence', value: evidenceLabel(selected.evidenceState) },
        { label: 'Since checkpoint', value: selected.changeState },
        { label: 'Direct children', value: selectedChildren.length },
        { label: 'Snapshot revision', value: revision, mono: true },
      ],
    },
    {
      title: 'Evidence context',
      fields: [
        { label: 'Source status', value: selected.sourceStatus === 'recorded' ? 'Recorded' : selected.sourceStatus === 'missing' ? 'Missing' : 'Not required for this record' },
        { label: 'License', value: selected.license ?? 'Inherited or not applicable' },
        { label: 'References', value: selected.references?.length ? selected.references.join(', ') : 'No indexed references', mono: Boolean(selected.references?.length) },
        { label: 'Finding count', value: selected.findingIds?.length ?? 0 },
        { label: 'Capture source', value: 'Fictional plugin snapshot' },
        { label: 'Raw payload', value: 'Not stored in this example' },
      ],
    },
    ...(selected.animation ? [{
      title: 'Animation metadata',
      fields: [
        { label: 'Animation ID', value: selected.animation.animationId, mono: true, copyValue: selected.animation.animationId },
        { label: 'Fixture clip', value: selected.animation.fixtureClipName },
        { label: 'Rig', value: selected.animation.rigType },
        { label: 'Duration', value: `${selected.animation.durationSeconds.toFixed(3)} seconds` },
        { label: 'Tracks / keys', value: `${selected.animation.trackCount} / ${selected.animation.keyCount.toLocaleString()}` },
        { label: 'Pair lab', value: 'Available' },
      ],
    }] : []),
  ];

  return (
    <section className="roblox-project-example" aria-labelledby="example-project-title">
      <header className="roblox-project-masthead">
        <div><span>Representative Studio snapshot · fictional data</span><h2 id="example-project-title">Northwind Museum</h2><p>A full project context for testing hierarchy, assets, scripts, animation references, evidence, and changes without flattening everything into one table.</p></div>
        <div><small>Release</small><strong>{robloxProjectSnapshot.release}</strong><em>{robloxProjectSnapshot.capturedAt}</em></div>
      </header>

      <div className="roblox-project-summary" aria-label="Example project summary">
        <div><strong>{robloxProjectSnapshot.totals.instances}</strong><small>Studio instances</small></div>
        <div><strong>{robloxProjectSnapshot.totals.evidenceAssets}</strong><small>Evidence assets</small></div>
        <div><strong>{robloxProjectSnapshot.totals.animations}</strong><small>Animations</small></div>
        <div><strong>{robloxProjectSnapshot.totals.scripts}</strong><small>Scripts indexed</small></div>
        <div><strong>{robloxProjectSnapshot.totals.unresolved}</strong><small>Open findings</small></div>
      </div>

      <div className="roblox-project-sync" data-simulated={simulatedAt ? 'true' : 'false'}>
        <Radio size={15} /><span><strong>Sample Studio event stream · revision {revision}</strong><small>{simulatedAt ? `Wave changed at ${simulatedAt}; one metadata delta was received.` : 'This control demonstrates how a paired Studio plugin would batch live Instance changes.'}</small></span><button type="button" onClick={simulateStudioEdit}><RefreshCw size={13} /> Simulate Studio edit</button>
      </div>

      <div className="roblox-project-workbench">
        <aside className="roblox-project-explorer">
          <header><strong>Explorer</strong><small>Low-level Parts are grouped under their parent models.</small></header>
          <label><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find Instance or path…" aria-label="Search example Roblox project" /></label>
          <button className="roblox-findings-filter" type="button" aria-pressed={findingsOnly} onClick={() => setFindingsOnly((current) => !current)}><CircleDot size={13} /> Findings only <small>{robloxProjectFindings.length}</small></button>
          <div className="roblox-project-tree" role="tree">{renderTree(null, 0)}</div>
        </aside>

        <section className="roblox-project-selection">
          <nav aria-label="Selected project path">{breadcrumbs.map((item, index) => <Fragment key={item.id}>{index ? <ChevronRight size={11} /> : null}<button type="button" onClick={() => selectNode(item.id)}>{item.name}</button></Fragment>)}</nav>
          <header><span><NodeIcon node={selected} /></span><div><small>{selected.className}</small><h3>{selected.name}</h3><p>{selected.note ?? 'Select a child record to inspect its project role, evidence state, and references.'}</p></div><em data-evidence={selected.evidenceState}>{evidenceLabel(selected.evidenceState)}</em></header>

          {selected.id === 'project' ? <div className="roblox-project-preview"><article><img src="/assets/dutch-ship-large-01.png" alt="Harbor exhibit preview" /><span>Harbor exhibit</span></article><article><img src="/assets/beautiful-game.jpg" alt="Chess hall preview" /><span>Grand gallery</span></article><article><img src="/assets/mosquito-in-amber.jpg" alt="Amber case preview" /><span>Amber case</span></article><article><img src="/assets/corset.jpg" alt="Wardrobe exhibit preview" /><span>Wardrobe study</span></article></div> : selected.previewUrl ? <div className="roblox-selection-preview"><img src={selected.previewUrl} alt={`${selected.name} preview`} /><span><Sparkles size={14} /> Licensed fixture preview</span></div> : null}

          {selected.animation ? <section className="roblox-animation-selection"><div><span>Animation evidence</span><strong>{selected.animation.fixtureClipName} · {selected.animation.rigType}</strong><small>{selected.animation.durationSeconds.toFixed(2)}s · {selected.animation.trackCount} tracks · {selected.animation.keyCount.toLocaleString()} keys</small></div><button className="button button-primary" type="button" onClick={() => onOpenPair(selected.animation!.fixtureClipName)}><Play size={14} /> Open in pair compare</button></section> : null}

          <section className="roblox-project-child-table" aria-label={`Children of ${selected.name}`}>
            <header><strong>{selectedChildren.length ? 'Direct children' : 'Project relationships'}</strong><small>{selectedChildren.length ? `${selectedChildren.length} records` : `${selected.references?.length ?? 0} indexed references`}</small></header>
            {selectedChildren.length ? selectedChildren.map((child) => <button key={child.id} type="button" onClick={() => selectNode(child.id)}><NodeIcon node={child} /><span><strong>{child.name}</strong><small>{child.className}</small></span><em data-evidence={child.evidenceState}>{evidenceLabel(child.evidenceState)}</em><ChevronRight size={13} /></button>) : selected.references?.length ? selected.references.map((reference) => <div key={reference}><ExternalLink size={13} /><code>{reference}</code></div>) : <p>No child or reference records are attached to this selection.</p>}
          </section>
        </section>

        <aside className="roblox-project-inspector"><MetadataInspector kind="Roblox Instance" title={selected.name} subtitle={selected.path} sections={metadataSections} /></aside>
      </div>

      <section className="roblox-project-findings" aria-labelledby="project-findings-title">
        <header><div><AlertTriangle size={15} /><span><strong id="project-findings-title">Open evidence queue</strong><small>Change does not automatically mean suspicious.</small></span></div><em>{robloxProjectFindings.length} items</em></header>
        <div>{robloxProjectFindings.map((finding) => { const node = nodeMap.get(finding.nodeId)!; return <button key={finding.id} type="button" data-state={finding.state} onClick={() => selectNode(finding.nodeId)}><span><strong>{finding.title}</strong><small>{finding.detail}</small></span><em>{node.path}</em><ChevronRight size={13} /></button>; })}</div>
      </section>

      <footer className="roblox-project-boundary"><ShieldCheck size={15} /><span><strong>This is a representative snapshot, not a runnable Roblox place.</strong><small>The current bridge accepts animation comparisons. A future plugin can stream live Studio state, but saved or published evidence still requires an explicit checkpoint.</small></span></footer>
    </section>
  );
}
