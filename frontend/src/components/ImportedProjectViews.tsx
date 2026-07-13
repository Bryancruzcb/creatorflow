import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  FileCheck2,
  FileJson,
  Fingerprint,
  FlaskConical,
  FolderOpen,
  HardDrive,
  Library,
  Search,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  MANIFEST_PAGE_SIZE,
  formatBytes,
  titleCaseManifestValue,
  type CreatorFlowManifest,
  type ManifestDecision,
  type ManifestVerification,
} from '../manifest/manifest';

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="product-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function generatedLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function verificationDescription(value: ManifestVerification) {
  if (value === 'CLEAR') return 'No exact or perceptual relationship was reported by this scan.';
  if (value === 'SIMILAR') return 'The scanner reported a perceptual relationship that needs human review.';
  return 'The scanner reported matching file identity.';
}

export function ImportedProjectOverview({ manifest, fileBytes, onOpenEvidence }: { manifest: CreatorFlowManifest; fileBytes: number; onOpenEvidence: () => void }) {
  const footprint = manifest.assets.reduce((total, asset) => total + asset.sizeBytes, 0);
  const resolvedSources = manifest.summary.total - manifest.summary.unresolvedSources;
  const reviewCount = manifest.summary.similar + manifest.summary.duplicate;
  const verificationRows: Array<{ key: ManifestVerification; label: string; value: number }> = [
    { key: 'CLEAR', label: 'Clear', value: manifest.summary.clear },
    { key: 'SIMILAR', label: 'Similar', value: manifest.summary.similar },
    { key: 'DUPLICATE', label: 'Duplicate', value: manifest.summary.duplicate },
  ];

  return (
    <div className="product-overview imported-overview">
      <section className="project-status-strip">
        <div><span className="workspace-kicker">Imported scanner snapshot</span><strong>{manifest.project.name} / {manifest.project.release}</strong><small>Generated {generatedLabel(manifest.generatedAt)} · read-only in this browser session</small></div>
        <div className="project-readiness"><ShieldCheck size={18} /><span><strong>{manifest.summary.pendingDecisions} pending</strong><small>{manifest.summary.unresolvedSources} unresolved source records</small></span></div>
        <button className="button button-primary" type="button" onClick={onOpenEvidence}>Inspect records</button>
      </section>

      <section className="product-metrics" aria-label="Imported project metrics">
        <Metric label="Indexed records" value={manifest.summary.total.toLocaleString()} note="Reported by the scanner manifest" />
        <Metric label="Recorded footprint" value={formatBytes(footprint)} note="Sum of manifest file sizes" />
        <Metric label="Source records" value={`${resolvedSources} resolved`} note={`${manifest.summary.unresolvedSources} unresolved`} />
        <Metric label="Creative payload uploaded" value="0 B" note="Only the JSON snapshot was opened" />
      </section>

      <div className="overview-grid">
        <section className="imported-verification-summary">
          <header><div><span>Verification distribution</span><strong>What the scanner actually reported</strong></div><small>{manifest.summary.total.toLocaleString()} records</small></header>
          <div className="verification-bars">
            {verificationRows.map((row) => (
              <div key={row.key}>
                <span><strong>{row.label}</strong><small>{verificationDescription(row.key)}</small></span>
                <i aria-hidden="true"><b data-verification={row.key.toLowerCase()} style={{ width: `${manifest.summary.total ? (row.value / manifest.summary.total) * 100 : 0}%` }} /></i>
                <em>{row.value.toLocaleString()}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="decision-queue">
          <header><span>Snapshot queue</span><strong>Recorded review work</strong></header>
          <ol>
            <li><span className="queue-state blocked">{manifest.summary.unresolvedSources}</span><div><strong>Unresolved sources</strong><small>Provider and license are both required</small></div></li>
            <li><span className="queue-state review">{reviewCount}</span><div><strong>Reported relationships</strong><small>Similar and duplicate records</small></div></li>
            <li><span className="queue-state neutral">{manifest.summary.pendingDecisions}</span><div><strong>Pending decisions</strong><small>Read-only until local persistence is connected</small></div></li>
          </ol>
        </section>
      </div>

      <section className="imported-snapshot-boundary">
        <FileJson size={20} />
        <div><strong>Read-only scanner snapshot</strong><p>Creative asset payloads were not imported. Paths, hashes, dimensions, fingerprints, findings, source records, and scanner decisions come directly from this manifest.</p></div>
        <span>{formatBytes(fileBytes)} JSON</span>
      </section>
    </div>
  );
}

export function ImportedProjectRun({ manifest, onOpenEvidence }: { manifest: CreatorFlowManifest; onOpenEvidence: () => void }) {
  const stages = [
    { state: 'complete', title: 'Manifest opened locally', detail: `${manifest.summary.total.toLocaleString()} records passed schema and semantic validation.` },
    { state: 'complete', title: 'Scanner snapshot verified', detail: 'Summary totals, project-relative paths, match references, and evidence URLs agree with the asset records.' },
    { state: 'complete', title: 'Evidence workspace prepared', detail: 'Real hashes, findings, fingerprints, source records, and decisions are available for inspection.' },
    { state: manifest.summary.unresolvedSources ? 'current' : 'complete', title: 'Resolve source evidence', detail: manifest.summary.unresolvedSources ? `${manifest.summary.unresolvedSources} records lack a complete source and license pair.` : 'Every record contains a source and license pair.' },
    { state: 'ready', title: 'Adopt as a local project', detail: 'In the desktop-owned workspace, choose the original folder through the native picker; imported JSON remains intentionally read-only.' },
    { state: 'ready', title: 'Export and enforce the release', detail: 'A completed local scan can be persisted, reviewed, exported, compared, and enforced by the CI gate.' },
  ] as const;

  return (
    <div className="project-run imported-project-run">
      <section className="project-status-strip">
        <div><span className="workspace-kicker">Validated import path</span><strong>{manifest.project.name} / {manifest.project.release}</strong><small>Manifest v0.1 · generated {generatedLabel(manifest.generatedAt)}</small></div>
        <div className="project-readiness"><Workflow size={18} /><span><strong>Read-only boundary maintained</strong><small>Choose the local folder to create durable workflow state</small></span></div>
        <button className="button button-primary" type="button" onClick={onOpenEvidence}>Open evidence</button>
      </section>

      <section className="project-run-flow imported-run-flow">
        <header><h2>A real snapshot, with honest integration boundaries</h2><p>The browser can validate and investigate this scanner output now. It does not fabricate owners, history, previews, decisions, or project performance.</p></header>
        <ol className="project-run-stages">
          {stages.map((stage, index) => (
            <li className="project-run-stage" data-state={stage.state} key={stage.title}>
              <span>{stage.state === 'complete' ? <Check size={14} /> : stage.state === 'current' ? <AlertTriangle size={14} /> : <Circle size={11} />}</span>
              <div><strong>{index + 1}. {stage.title}</strong><small>{stage.detail}</small></div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

type VerificationFilter = 'ALL' | ManifestVerification;
type DecisionFilter = 'ALL' | ManifestDecision;

export function ImportedEvidenceView({ manifest }: { manifest: CreatorFlowManifest }) {
  const [query, setQuery] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>('ALL');
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('ALL');
  const [page, setPage] = useState(1);
  const [selectedIndex, setSelectedIndex] = useState(manifest.assets.length ? 0 : -1);

  const filtered = useMemo(() => manifest.assets.map((asset, index) => ({ asset, index })).filter(({ asset }) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matchesQuery = !normalizedQuery || [asset.path, asset.fileName, asset.fileType, asset.sha256, asset.source.source, asset.source.license, ...asset.findings]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    return matchesQuery
      && (verificationFilter === 'ALL' || asset.verification === verificationFilter)
      && (decisionFilter === 'ALL' || asset.decision === decisionFilter);
  }), [decisionFilter, manifest.assets, query, verificationFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / MANIFEST_PAGE_SIZE));
  const visible = filtered.slice((page - 1) * MANIFEST_PAGE_SIZE, page * MANIFEST_PAGE_SIZE);
  const selected = selectedIndex >= 0 ? manifest.assets[selectedIndex] : undefined;

  useEffect(() => setPage(1), [query, verificationFilter, decisionFilter]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  useEffect(() => {
    if (!visible.length) {
      setSelectedIndex(-1);
      return;
    }
    if (!visible.some((record) => record.index === selectedIndex)) setSelectedIndex(visible[0].index);
  }, [selectedIndex, visible]);

  return (
    <section className="imported-evidence" aria-labelledby="imported-evidence-title">
      <header className="imported-view-heading">
        <div><span>Imported evidence</span><h2 id="imported-evidence-title">Scanner records, without authored filler</h2><p>Search the actual manifest inventory, then inspect its hashes, findings, source fields, and match references.</p></div>
        <div className="snapshot-disclosure"><FileCheck2 size={16} /><span><strong>Read-only scanner snapshot</strong><small>Creative asset payloads were not imported.</small></span></div>
      </header>

      <div className="imported-evidence-controls">
        <label className="imported-search"><Search size={15} /><span className="sr-only">Search imported records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search path, hash, source, finding…" /></label>
        <label><span>Verification</span><select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value as VerificationFilter)}><option value="ALL">All states</option><option value="CLEAR">Clear</option><option value="SIMILAR">Similar</option><option value="DUPLICATE">Duplicate</option></select></label>
        <label><span>Decision</span><select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value as DecisionFilter)}><option value="ALL">All decisions</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="NEEDS_REVIEW">Needs review</option><option value="BLOCKED">Blocked</option><option value="EXCLUDED">Excluded</option></select></label>
        <output aria-live="polite">{filtered.length.toLocaleString()} of {manifest.assets.length.toLocaleString()} records</output>
      </div>

      <div className="imported-evidence-layout">
        <div className="imported-ledger-wrap">
          <div className="imported-ledger-scroll" tabIndex={0} aria-label="Imported evidence ledger">
            <table className="imported-ledger">
              <thead><tr><th>Asset record</th><th>Verification</th><th>Source</th><th>Decision</th><th>Findings</th></tr></thead>
              <tbody>
                {visible.map(({ asset, index }) => (
                  <tr key={asset.path} className={selectedIndex === index ? 'selected' : ''}>
                    <td><button type="button" onClick={() => setSelectedIndex(index)} aria-pressed={selectedIndex === index}><span className="manifest-file-icon">{asset.fileType.slice(0, 4).toUpperCase() || 'FILE'}</span><span><strong>{asset.fileName}</strong><small>{asset.path} · {formatBytes(asset.sizeBytes)}</small></span></button></td>
                    <td><span className="manifest-state" data-state={asset.verification.toLowerCase()}>{titleCaseManifestValue(asset.verification)}</span></td>
                    <td>{asset.source.source ? <><strong>{asset.source.source}</strong><small>{asset.source.license ?? 'License unresolved'}</small></> : <span className="manifest-state" data-state="unresolved">Unresolved</span>}</td>
                    <td><span className="manifest-state" data-state={asset.decision.toLowerCase()}>{titleCaseManifestValue(asset.decision)}</span></td>
                    <td>{asset.findings.length.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? <div className="imported-empty"><Search size={20} /><strong>No records match these filters</strong><small>Clear the search or broaden a state filter.</small></div> : null}
          </div>

          <footer className="imported-pagination">
            <span>Page {page} of {pageCount} · {MANIFEST_PAGE_SIZE} records per page</span>
            <div><button type="button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={14} /> Previous</button><button type="button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={14} /></button></div>
          </footer>
        </div>

        <aside className="manifest-record-inspector" aria-label={selected ? `Manifest record for ${selected.fileName}` : 'Manifest record inspector'}>
          {selected ? (
            <>
              <header><span>Selected record</span><h3>{selected.fileName}</h3><p>{selected.path}</p></header>
              <dl className="manifest-record-grid">
                <div><dt>Verification</dt><dd><span className="manifest-state" data-state={selected.verification.toLowerCase()}>{titleCaseManifestValue(selected.verification)}</span></dd></div>
                <div><dt>Decision</dt><dd><span className="manifest-state" data-state={selected.decision.toLowerCase()}>{titleCaseManifestValue(selected.decision)}</span></dd></div>
                <div><dt>Type</dt><dd>{selected.fileType || 'Unknown'}</dd></div>
                <div><dt>Size</dt><dd>{formatBytes(selected.sizeBytes)}</dd></div>
                <div><dt>Dimensions</dt><dd>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : 'Not reported'}</dd></div>
                <div><dt>Matches</dt><dd>{selected.matches.length}</dd></div>
              </dl>
              <section><span>SHA-256</span><code>{selected.sha256}</code></section>
              <section><span>Fingerprints</span><dl className="manifest-fingerprints"><div><dt>dHash</dt><dd><code>{selected.fingerprints.dHash ?? 'Not available'}</code></dd></div><div><dt>pHash</dt><dd><code>{selected.fingerprints.pHash ?? 'Not available'}</code></dd></div><div><dt>Audio</dt><dd><code>{selected.fingerprints.audio ?? 'Not available'}</code></dd></div></dl></section>
              <section><span>Source evidence</span>{selected.source.source || selected.source.license ? <div className="manifest-source-record"><strong>{selected.source.source ?? 'Source unresolved'}</strong><small>{selected.source.license ?? 'License unresolved'}</small>{selected.source.evidenceUrl ? <a href={selected.source.evidenceUrl} target="_blank" rel="noreferrer">Open evidence <ExternalLink size={13} /></a> : null}</div> : <p>No source or license pair was recorded by the scanner.</p>}</section>
              <section><span>Findings</span>{selected.findings.length ? <ul>{selected.findings.map((finding, index) => <li key={`${finding}-${index}`}>{finding}</li>)}</ul> : <p>No findings recorded.</p>}</section>
              {selected.matches.length ? <section><span>Match references</span><ol className="manifest-match-list">{selected.matches.map((match, index) => <li key={`${match.matchedAssetId}-${match.layer}-${index}`}><strong>{match.matchedFileName}</strong><small>{match.layer} · distance {match.distance} · asset ID {match.matchedAssetId}</small><p>{match.note}</p></li>)}</ol></section> : null}
            </>
          ) : <div className="imported-empty"><FolderOpen size={20} /><strong>This manifest contains no asset records</strong><small>The snapshot is valid, but there is nothing to inspect.</small></div>}
        </aside>
      </div>
    </section>
  );
}

interface SourceGroup {
  key: string;
  source: string | null;
  license: string | null;
  evidenceUrl: string | null;
  count: number;
}

export function sourceGroups(manifest: CreatorFlowManifest): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  manifest.assets.forEach((asset) => {
    const key = JSON.stringify([asset.source.source, asset.source.license, asset.source.evidenceUrl]);
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { key, ...asset.source, count: 1 });
  });
  return [...groups.values()].sort((a, b) => Number(!a.source) - Number(!b.source) || (a.source ?? '').localeCompare(b.source ?? ''));
}

export function ImportedSourcesView({ manifest }: { manifest: CreatorFlowManifest }) {
  const groups = useMemo(() => sourceGroups(manifest), [manifest]);
  return (
    <section className="workspace-table-view imported-sources-view">
      <header><span>Imported source evidence</span><h2>Source and license pairs in this snapshot</h2><p>Rows are derived only from manifest records. Repeated source/license/evidence combinations are grouped without inventing providers or coverage.</p></header>
      <div className="workspace-table-scroll" tabIndex={0} aria-label="Imported source records">
        <table><thead><tr><th>Source</th><th>Records</th><th>License</th><th>Evidence</th></tr></thead><tbody>{groups.map((group) => <tr key={group.key}><td>{group.source ? <strong>{group.source}</strong> : <span className="manifest-state" data-state="unresolved">Unresolved source</span>}</td><td>{group.count.toLocaleString()}</td><td>{group.license ?? 'Not recorded'}</td><td>{group.evidenceUrl ? <a href={group.evidenceUrl} target="_blank" rel="noreferrer">Open record <ExternalLink size={13} /></a> : 'Not recorded'}</td></tr>)}</tbody></table>
      </div>
      {!groups.length ? <div className="imported-empty"><Library size={20} /><strong>No source records</strong><small>This valid manifest contains no asset records.</small></div> : null}
    </section>
  );
}

export function ImportedReleasesView({ manifest, fileName }: { manifest: CreatorFlowManifest; fileName: string }) {
  function downloadSnapshot() {
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || `${manifest.project.name}-${manifest.project.release}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="workspace-table-view imported-releases-view">
      <header><span>Imported release snapshot</span><h2>One record, exactly as scanned</h2><p>No sample history is mixed into an imported project. Persistence, reconstructed releases, and CI policy output appear here only after the desktop bridge milestone.</p></header>
      <div className="release-history"><article><span>Imported</span><strong>{manifest.project.name} / {manifest.project.release}</strong><small>{manifest.summary.total.toLocaleString()} records · generated {generatedLabel(manifest.generatedAt)}</small><button className="button button-secondary" type="button" onClick={downloadSnapshot}><ArrowDownToLine size={14} /> Download snapshot</button></article></div>
      <div className="imported-release-boundary"><HardDrive size={18} /><div><strong>Session-only import</strong><p>Replacing or clearing this project does not modify the original JSON file. Decisions are not persisted into imported snapshots.</p></div></div>
    </section>
  );
}

export function CapabilityDemoNotice({ projectName, kind, dataset = 'imported' }: { projectName: string; kind: 'assets' | 'stress'; dataset?: 'imported' | 'local' }) {
  return (
    <aside className="capability-demo-notice" aria-label="Capability demonstration boundary">
      {kind === 'assets' ? <Fingerprint size={17} /> : <FlaskConical size={17} />}
      <div><strong>Curated capability demonstration</strong><p>This {kind === 'assets' ? '3D asset set' : 'stress workload set'} is separate from {projectName}. No {dataset === 'local' ? 'selected local-project' : 'imported project'} payloads are loaded in this view.</p></div>
    </aside>
  );
}
