import {
  AlertTriangle,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileCheck2,
  FileJson,
  FolderOpen,
  HardDrive,
  Library,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  LocalBridgeClient,
  type LocalAssetDetail,
  type LocalDecision,
  type LocalDecisionType,
  type LocalIntendedExperience,
  type LocalProjectRecord,
  type LocalProjectSummary,
  type LocalRelease,
  type LocalScanAsset,
  type LocalScanEvent,
  type LocalScanRun,
} from '../bridge/localBridge';
import { decisionBasis, OWNERSHIP_BASIS, sourceBasis, verificationBasis } from '../bridge/evidenceBasis';
import { EvidenceBasisMark } from './EvidenceBasisMark';
import { formatBytes, titleCaseManifestValue } from '../manifest/manifest';

export type ParsedExperienceForm =
  | { ok: true; value: { universeId: number; placeId: number; experienceName: string } }
  | { ok: false; error: string };

/**
 * Pure validation for the intended-experience bind form: positive-integer universe/place IDs
 * and a non-blank experience name. Extracted so it is unit-testable without a DOM/render harness.
 */
export function parseExperienceFormInput(input: { universeId: string; placeId: string; experienceName: string }): ParsedExperienceForm {
  const universeId = Number(input.universeId.trim());
  const placeId = Number(input.placeId.trim());
  const experienceName = input.experienceName.trim();
  if (!Number.isInteger(universeId) || universeId < 1) {
    return { ok: false, error: 'Universe ID must be a positive whole number.' };
  }
  if (!Number.isInteger(placeId) || placeId < 1) {
    return { ok: false, error: 'Place ID must be a positive whole number.' };
  }
  if (!experienceName) {
    return { ok: false, error: 'Experience name is required.' };
  }
  return { ok: true, value: { universeId, placeId, experienceName } };
}

function experienceSummary(experience: LocalIntendedExperience) {
  return `${experience.experienceName} · universe ${experience.universeId} / place ${experience.placeId}`;
}

export type ParsedPublishedPlaceVersion =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Pure validation for the "record published place version" form: a positive integer.
 * Extracted so it is unit-testable without a DOM/render harness (mirrors {@link parseExperienceFormInput}).
 */
export function parsePublishedPlaceVersionInput(input: string): ParsedPublishedPlaceVersion {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: 'Place version must be a positive whole number.' };
  }
  return { ok: true, value };
}

/**
 * Resolves a display label for a release's rollback target: the prior release's name plus a
 * short id tag, looked up client-side from the already-fetched project release list (no new
 * fetch). Falls back to the raw id when the prior release isn't in that list.
 */
export function resolveRollbackTargetLabel(previousReleaseId: string, releases: LocalRelease[]): string {
  const prior = releases.find((release) => release.id === previousReleaseId);
  if (!prior) return previousReleaseId;
  const name = prior.release ?? prior.releaseName ?? prior.id;
  return `${name} (v${prior.id.slice(0, 8)})`;
}

const defaultExclusions = ['.git', '.gradle', '.idea', '.mvn', '.next', '.nuxt', '.turbo', 'build', 'coverage', 'dist', 'node_modules', 'out', 'target'];
const formatGroups = [
  { id: 'images', label: 'Images & design', formats: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'exr', 'psd', 'sketch'] },
  { id: 'audio', label: 'Audio', formats: ['wav', 'aif', 'aiff', 'au', 'mp3', 'ogg', 'flac'] },
  { id: '3d', label: '3D scenes', formats: ['glb', 'gltf', 'fbx', 'obj', 'blend'] },
  { id: 'fonts', label: 'Fonts', formats: ['ttf', 'otf', 'woff', 'woff2'] },
] as const;
type FormatGroupId = (typeof formatGroups)[number]['id'];

function terminal(run: LocalScanRun | null) {
  return Boolean(run && (run.state === 'CANCELLED' || run.state === 'COMPLETED' || run.state === 'FAILED'));
}

function stateLabel(state: LocalScanRun['state']) {
  return titleCaseManifestValue(state);
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="product-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

export function LocalProjectOverview({ client, project, run, onOpenRun, onOpenEvidence, onExperienceBound }: { client: LocalBridgeClient; project: LocalProjectSummary; run: LocalScanRun | null; onOpenRun: () => void; onOpenEvidence: () => void; onExperienceBound: (record: LocalProjectRecord) => void }) {
  const experience = project.experience ?? null;
  const [editing, setEditing] = useState(false);
  const [universeId, setUniverseId] = useState(experience ? String(experience.universeId) : '');
  const [placeId, setPlaceId] = useState(experience ? String(experience.placeId) : '');
  const [experienceName, setExperienceName] = useState(experience?.experienceName ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setUniverseId(experience ? String(experience.universeId) : '');
    setPlaceId(experience ? String(experience.placeId) : '');
    setExperienceName(experience?.experienceName ?? '');
  }, [experience?.universeId, experience?.placeId, experience?.experienceName]);

  async function saveExperience(event: FormEvent) {
    event.preventDefault();
    const parsed = parseExperienceFormInput({ universeId, placeId, experienceName });
    if (!parsed.ok) { setError(parsed.error); return; }
    setSaving(true);
    setError('');
    try {
      const updated = await client.bindExperience(project.projectId, parsed.value);
      onExperienceBound(updated);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the intended experience');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="product-overview local-project-overview">
      <section className="project-status-strip">
        <div><span className="workspace-kicker">Desktop-owned local project</span><strong>{project.name}</strong><small>{run ? `${run.release} · ${stateLabel(run.state)}` : 'Folder permission granted · no persisted scan reopened yet'}</small></div>
        <div className="project-readiness"><HardDrive size={18} /><span><strong>{run ? stateLabel(run.state) : 'Ready to scan'}</strong><small>Creative payload remains on this machine</small></span></div>
        <button className="button button-primary" type="button" onClick={run ? onOpenEvidence : onOpenRun}>{run ? 'Open local evidence' : 'Configure scan'}</button>
      </section>
      <section className="product-metrics" aria-label="Local project metrics">
        <Metric label="Supported assets" value={(run?.supportedCount ?? 0).toLocaleString()} note="Persisted from the latest local run" />
        <Metric label="Bytes processed" value={formatBytes(run?.bytesProcessed ?? 0)} note="Read locally by the Java scanner" />
        <Metric label="Recoverable warnings" value={(run?.warnings.length ?? 0).toLocaleString()} note="Available in Project run" />
        <Metric label="Creative bytes uploaded" value="0 B" note="Loopback bridge only" />
      </section>
      <section className="local-overview-boundary">
        <Workflow size={19} />
        <div><strong>{run ? 'Persisted run available' : 'Choose the scan boundary'}</strong><p>{run ? 'The Evidence workspace reloads immutable asset records and append-only decisions from SQLite.' : 'Set release, format groups, directory exclusions, hidden-file policy, and symbolic-link policy before Java traverses the selected root.'}</p></div>
        <button className="button button-secondary" type="button" onClick={onOpenRun}>{run ? 'Review run' : 'Set scan scope'}</button>
      </section>
      <section className="local-overview-boundary local-experience-declaration" aria-labelledby="local-experience-title">
        <FileCheck2 size={19} />
        <div>
          <strong id="local-experience-title">Intended Roblox experience</strong>
          <p>{experience ? `Declared by you: ${experienceSummary(experience)}. CreatorFlow has not verified ownership of or access to this experience.` : 'Not yet declared. This is a human declaration only — CreatorFlow does not verify ownership of or access to any experience you bind here — but it is stamped onto every release you export from this project.'}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => setEditing((current) => !current)} aria-expanded={editing}>{experience ? 'Edit declaration' : 'Declare experience'}</button>
        {editing ? (
          <form className="local-decision-form local-experience-form" onSubmit={saveExperience}>
            <label><span>Universe ID</span><input inputMode="numeric" value={universeId} onChange={(event) => setUniverseId(event.target.value)} placeholder="e.g. 1234567890" /></label>
            <label><span>Place ID</span><input inputMode="numeric" value={placeId} onChange={(event) => setPlaceId(event.target.value)} placeholder="e.g. 9876543210" /></label>
            <label><span>Experience name</span><input value={experienceName} onChange={(event) => setExperienceName(event.target.value)} placeholder="As it appears in Roblox…" maxLength={120} /></label>
            {error ? <small role="alert">{error}</small> : null}
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Save declaration</button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

export function LocalScanView({ client, project, onRunChange, onOpenEvidence }: { client: LocalBridgeClient; project: LocalProjectSummary; onRunChange: (run: LocalScanRun | null) => void; onOpenEvidence: () => void }) {
  const [release, setRelease] = useState('Working');
  const [exclusions, setExclusions] = useState(defaultExclusions.join(', '));
  const [selectedGroups, setSelectedGroups] = useState(() => new Set(formatGroups.map((group) => group.id)));
  const [includeHidden, setIncludeHidden] = useState(false);
  const [followLinks, setFollowLinks] = useState(false);
  const [run, setRun] = useState<LocalScanRun | null>(null);
  const [lastEvent, setLastEvent] = useState<LocalScanEvent | null>(null);
  const [eventWarnings, setEventWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;
    setRun(null);
    setLastEvent(null);
    setError('');
    void client.listProjectAssets(project.projectId, 1, 0).then(async (page) => {
      if (!active || !page.scanRunId) return;
      const restored = await client.getScanRun(page.scanRunId);
      if (!active) return;
      setRun(restored);
      setRelease(restored.release);
      onRunChange(restored);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not reopen the latest scan');
    });
    return () => { active = false; };
  }, [client, onRunChange, project.projectId]);

  useEffect(() => {
    if (!run || terminal(run)) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void client.followScan(run.id, {
      onRun: (next) => { setRun(next); onRunChange(next); },
      onEvent: (event) => {
        setLastEvent(event);
        if (event.warning) setEventWarnings((current) => current.includes(event.warning!) ? current : [...current, event.warning!]);
        if (event.error) setError(event.error);
      },
      onError: (reason) => setError(reason.message),
    }).then((cleanup) => { if (disposed) cleanup(); else stop = cleanup; });
    return () => { disposed = true; stop?.(); };
  }, [client, onRunChange, run?.id]);

  function toggleGroup(groupId: FormatGroupId) {
    setSelectedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  async function startScan(event: FormEvent) {
    event.preventDefault();
    setStarting(true);
    setError('');
    setEventWarnings([]);
    setLastEvent(null);
    try {
      const next = await client.startScan(project.projectId, {
        release: release.trim() || 'Working',
        excludedDirectoryNames: exclusions.split(',').map((value) => value.trim()).filter(Boolean),
        supportedFileTypes: formatGroups.filter((group) => selectedGroups.has(group.id)).flatMap((group) => [...group.formats]),
        includeHidden,
        followSymbolicLinks: followLinks,
      });
      setRun(next);
      onRunChange(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the local scan');
    } finally {
      setStarting(false);
    }
  }

  async function cancelScan() {
    if (!run) return;
    try {
      await client.cancelScan(run.id);
      setRun((current) => current ? { ...current, state: 'CANCELLATION_REQUESTED' } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel the scan');
    }
  }

  const progress = run?.discoveredCount ? Math.min(100, Math.round((run.processedCount / run.discoveredCount) * 100)) : 0;
  const warnings = [...new Set([...(run?.warnings ?? []), ...eventWarnings])];
  const running = Boolean(run && !terminal(run));

  return (
    <section className="local-scan-workspace" aria-labelledby="local-scan-title">
      <header className="local-scan-heading">
        <div><span>Desktop scan</span><h2 id="local-scan-title">Scan {project.name} without surrendering the files.</h2><p>The native folder picker owns the root. This browser can choose policy and observe progress, but it cannot submit an arbitrary filesystem path.</p></div>
        <div className="local-bridge-badge"><ShieldCheck size={16} /><span><strong>Secure local bridge</strong><small>Same-origin session · CSRF protected</small></span></div>
      </header>

      <div className="local-scan-layout">
        <form className="local-scan-scope" onSubmit={startScan}>
          <header><FolderOpen size={16} /><div><strong>Scan boundary</strong><small>{project.name} · project ID {project.projectId}</small></div></header>
          <label><span>Release label</span><input value={release} onChange={(event) => setRelease(event.target.value)} maxLength={120} disabled={running} /></label>
          <fieldset disabled={running}><legend>Supported file groups</legend><div className="local-format-groups">{formatGroups.map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroups.has(group.id)} onChange={() => toggleGroup(group.id)} /><span><strong>{group.label}</strong><small>{group.formats.join(', ')}</small></span></label>)}</div></fieldset>
          <label><span>Excluded directory names</span><textarea rows={3} value={exclusions} onChange={(event) => setExclusions(event.target.value)} disabled={running} /><small>Comma-separated names; paths are rejected by the scanner.</small></label>
          <div className="local-policy-toggles"><label><input type="checkbox" checked={includeHidden} onChange={(event) => setIncludeHidden(event.target.checked)} disabled={running} /><span><strong>Include hidden files</strong><small>Off by default</small></span></label><label><input type="checkbox" checked={followLinks} onChange={(event) => setFollowLinks(event.target.checked)} disabled={running} /><span><strong>Follow symbolic links</strong><small>Root containment still enforced</small></span></label></div>
          <button className="button button-primary" type="submit" disabled={running || starting || selectedGroups.size === 0}>{starting ? <LoaderCircle className="spin" size={15} /> : run && terminal(run) ? <RotateCcw size={15} /> : <Play size={15} />}{run && terminal(run) ? 'Start another immutable run' : 'Start local scan'}</button>
        </form>

        <section className="local-scan-monitor" aria-live="polite">
          {run ? <>
            <header><div><span className="local-run-state" data-state={run.state.toLowerCase()}>{running ? <LoaderCircle className="spin" size={14} /> : run.state === 'COMPLETED' ? <Check size={14} /> : run.state === 'FAILED' ? <AlertTriangle size={14} /> : <Square size={12} />}{stateLabel(run.state)}</span><strong>{run.release}</strong><small>Run {run.id.slice(0, 12)}…</small></div>{running ? <button className="button button-secondary" type="button" onClick={cancelScan} disabled={run.state === 'CANCELLATION_REQUESTED'}><Ban size={14} /> {run.state === 'CANCELLATION_REQUESTED' ? 'Stopping safely…' : 'Cancel scan'}</button> : null}</header>
            <div className="local-progress-copy"><span>{lastEvent?.currentRelativePath ?? (terminal(run) ? 'Run closed' : 'Preparing project traversal…')}</span><strong>{progress}%</strong></div>
            <div className="local-progress-track" role="progressbar" aria-label="Local scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
            <dl className="local-progress-metrics"><div><dt>Discovered</dt><dd>{run.discoveredCount.toLocaleString()}</dd></div><div><dt>Processed</dt><dd>{run.processedCount.toLocaleString()}</dd></div><div><dt>Bytes read</dt><dd>{formatBytes(run.bytesProcessed)}</dd></div><div><dt>Warnings</dt><dd>{warnings.length.toLocaleString()}</dd></div></dl>
            <div className="local-accounting" aria-label="Scanner file accounting"><div><span>Supported</span><strong>{run.supportedCount}</strong></div><div><span>Ignored</span><strong>{run.ignoredCount}</strong></div><div><span>Excluded</span><strong>{run.excludedCount}</strong></div><div><span>Unreadable</span><strong>{run.unreadableCount}</strong></div><div><span>Missing deps</span><strong>{run.missingDependencyCount}</strong></div><div><span>Failed</span><strong>{run.failedCount}</strong></div></div>
            {error ? <div className="local-scan-error" role="alert"><AlertTriangle size={15} /><span><strong>Run needs attention</strong><small>{error}</small></span></div> : null}
            {warnings.length ? <details className="local-warning-list"><summary>{warnings.length} warning{warnings.length === 1 ? '' : 's'} recorded</summary><ul>{warnings.slice(-12).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></details> : null}
            {run.state === 'CANCELLED' ? <div className="local-partial-result"><Square size={15} /><span><strong>Cancelled cleanly</strong><small>Partial immutable asset records remain available for inspection.</small></span><button type="button" onClick={onOpenEvidence}>Open partial evidence</button></div> : null}
            {run.state === 'COMPLETED' ? <div className="local-partial-result complete"><Check size={15} /><span><strong>Scan complete</strong><small>{run.supportedCount.toLocaleString()} supported assets persisted locally.</small></span><button type="button" onClick={onOpenEvidence}>Review evidence</button></div> : null}
          </> : <div className="local-monitor-empty"><Circle size={20} /><strong>No scan running</strong><p>Confirm the boundary on the left. Progress, current path, accounting, warnings, cancellation, and recovery appear here.</p></div>}
        </section>
      </div>
    </section>
  );
}

export function LocalEvidenceView({ client, project, initialSelectedAssetId = null, onSelectAsset }: { client: LocalBridgeClient; project: LocalProjectSummary; initialSelectedAssetId?: number | null; onSelectAsset?: (assetId: number | null) => void }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LocalScanAsset[]>([]);
  const [scanRunId, setScanRunId] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedAssetId);
  const [detail, setDetail] = useState<LocalAssetDetail | null>(null);
  const [history, setHistory] = useState<LocalDecision[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decisionType, setDecisionType] = useState<LocalDecisionType>('NEEDS_REVIEW');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [licenseName, setLicenseName] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [sourceSaving, setSourceSaving] = useState(false);
  const limit = 100;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void client.listProjectAssets(project.projectId, limit, offset).then((result) => {
      if (!active) return;
      setPage(result.items);
      setScanRunId(result.scanRunId ?? '');
      setSelectedId((current) => current ?? result.items[0]?.id ?? null);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not reopen persisted assets'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, offset, project.projectId]);

  useEffect(() => {
    onSelectAsset?.(selectedId);
    if (selectedId === null) { setDetail(null); setHistory([]); return; }
    let active = true;
    void client.saveWorkspaceState({ activeProjectId: project.projectId, activeScanRunId: scanRunId || null, selectedAssetId: selectedId }).catch(() => undefined);
    void Promise.all([client.getAsset(selectedId), client.getDecisionHistory(selectedId)]).then(([nextDetail, nextHistory]) => {
      if (!active) return;
      setDetail(nextDetail);
      setHistory(nextHistory.items);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not open the asset record'); });
    return () => { active = false; };
  }, [client, onSelectAsset, project.projectId, scanRunId, selectedId]);

  useEffect(() => {
    setSourceName(detail?.sourceEvidence?.source ?? '');
    setLicenseName(detail?.sourceEvidence?.license ?? '');
    setEvidenceUrl(detail?.sourceEvidence?.evidenceUrl ?? '');
  }, [detail?.asset.id, detail?.sourceEvidence]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? page.filter((asset) => [asset.relativePath, asset.fileName, asset.fileType, asset.sha256, ...asset.findings].some((value) => value.toLocaleLowerCase().includes(normalized))) : page;
  }, [page, query]);

  async function saveDecision(event: FormEvent) {
    event.preventDefault();
    if (!detail || !reason.trim()) return;
    setSaving(true);
    setError('');
    try {
      await client.recordDecision(detail.asset.id, decisionType, reason.trim(), detail.latestDecision?.id);
      const [nextDetail, nextHistory] = await Promise.all([client.getAsset(detail.asset.id), client.getDecisionHistory(detail.asset.id)]);
      setDetail(nextDetail);
      setHistory(nextHistory.items);
      setReason('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not record the decision');
    } finally {
      setSaving(false);
    }
  }

  async function saveSourceEvidence(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setSourceSaving(true);
    setError('');
    try {
      await client.recordSourceEvidence(detail.asset.id, sourceName.trim() || null, licenseName.trim() || null, evidenceUrl.trim() || null);
      setDetail(await client.getAsset(detail.asset.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save source evidence');
    } finally {
      setSourceSaving(false);
    }
  }

  return (
    <section className="local-evidence-workspace" aria-labelledby="local-evidence-title">
      <header className="local-scan-heading"><div><span>Persisted local evidence</span><h2 id="local-evidence-title">Reopen what the scanner actually stored.</h2><p>These immutable records come from SQLite. Selecting an asset loads its findings, source evidence, and append-only decision history.</p></div><div className="local-bridge-badge"><HardDrive size={16} /><span><strong>{project.name}</strong><small>{scanRunId ? `Run ${scanRunId.slice(0, 12)}…` : 'No persisted run'}</small></span></div></header>
      <div className="local-evidence-toolbar"><label><Search size={14} /><input aria-label="Search persisted local assets" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search current page…" /></label><span>{visible.length} of {page.length} records on this page</span></div>
      {error ? <div className="local-scan-error" role="alert"><AlertTriangle size={15} /><span><strong>Local evidence unavailable</strong><small>{error}</small></span></div> : null}
      <div className="local-evidence-layout">
        <div className="local-asset-ledger">
          {loading ? <div className="local-monitor-empty"><LoaderCircle className="spin" size={20} /><strong>Reopening persisted records…</strong></div> : visible.length ? visible.map((asset) => <button key={asset.id} type="button" className={selectedId === asset.id ? 'selected' : ''} aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)}><span className="manifest-file-icon">{asset.fileType.slice(0, 4).toUpperCase() || 'FILE'}</span><span><strong>{asset.fileName}</strong><small>{asset.relativePath} · {formatBytes(asset.sizeBytes)}</small></span><em data-state={asset.verification.toLowerCase()}>{titleCaseManifestValue(asset.verification)}</em></button>) : <div className="local-monitor-empty"><FolderOpen size={20} /><strong>No persisted assets on this page</strong><p>{query ? 'Clear the search to restore this page.' : 'Run or complete a local scan first.'}</p></div>}
          <footer><button type="button" disabled={offset === 0} onClick={() => setOffset((current) => Math.max(0, current - limit))}><ChevronLeft size={14} /> Previous</button><span>Records {offset + 1}–{offset + page.length}</span><button type="button" disabled={page.length < limit} onClick={() => setOffset((current) => current + limit)}>Next <ChevronRight size={14} /></button></footer>
        </div>
        <aside className="local-asset-inspector">
          {detail ? <><header><span>Asset record</span><h3>{detail.asset.fileName}</h3><p>{detail.asset.relativePath}</p></header><dl><div><dt>Verification</dt><dd>{titleCaseManifestValue(detail.asset.verification)} <EvidenceBasisMark basis={verificationBasis()} /></dd></div><div><dt>Size</dt><dd>{formatBytes(detail.asset.sizeBytes)}</dd></div><div><dt>Dimensions</dt><dd>{detail.asset.width && detail.asset.height ? `${detail.asset.width} × ${detail.asset.height}` : 'Not reported'}</dd></div><div><dt>Findings</dt><dd>{detail.findings.length}</dd></div><div><dt>Ownership</dt><dd><EvidenceBasisMark basis={OWNERSHIP_BASIS} /> <small>No Roblox ownership or permission API is called.</small></dd></div></dl><section><span>SHA-256</span><code>{detail.asset.sha256}</code></section><section><span>Findings</span>{detail.findings.length ? <ul>{detail.findings.map((finding) => <li key={finding.id}><strong>{finding.code}</strong><small>{finding.message}{finding.matchDistance !== null ? ` · distance ${finding.matchDistance}` : ''}</small></li>)}</ul> : <p>No findings recorded.</p>}</section><form className="local-decision-form local-source-form" onSubmit={saveSourceEvidence}><strong>Source evidence</strong><label><span>Source</span><input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Provider, archive, or owner…" /></label><label><span>License</span><input value={licenseName} onChange={(event) => setLicenseName(event.target.value)} placeholder="License or ownership basis…" /></label><label><span>Evidence URL</span><input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://…" /></label><button className="button button-secondary" type="submit" disabled={sourceSaving}>{sourceSaving ? <LoaderCircle className="spin" size={14} /> : <Library size={14} />} Save source record</button><small>{detail.sourceEvidence?.resolved ? 'Resolved source and license pair' : 'Source remains unresolved until both fields are recorded'}</small> <EvidenceBasisMark basis={sourceBasis(detail.sourceEvidence)} /></form><section><span>Latest decision</span>{detail.latestDecision ? <div><strong>{titleCaseManifestValue(detail.latestDecision.type)}</strong> <EvidenceBasisMark basis={decisionBasis(detail.latestDecision) ?? 'DECLARED'} /><small>{detail.latestDecision.reason}</small></div> : <p>No human decision recorded.</p>}<small>{history.length} append-only record{history.length === 1 ? '' : 's'} in history</small></section><form className="local-decision-form" onSubmit={saveDecision}><label><span>{detail.latestDecision ? 'Superseding decision' : 'Decision'}</span><select value={decisionType} onChange={(event) => setDecisionType(event.target.value as LocalDecisionType)}><option value="APPROVED">Approved</option><option value="NEEDS_REVIEW">Needs review</option><option value="BLOCKED">Blocked</option><option value="EXCLUDED">Excluded</option></select></label><label><span>Reason</span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence behind this decision…" /></label><button className="button button-primary" type="submit" disabled={saving || !reason.trim()}>{saving ? <LoaderCircle className="spin" size={14} /> : <FileCheck2 size={14} />} Record decision</button></form></> : <div className="local-monitor-empty"><Circle size={20} /><strong>Select a persisted asset</strong><p>Its detailed evidence and decision history will open here.</p></div>}
        </aside>
      </div>
    </section>
  );
}

export function LocalReleasesView({ client, project, run }: { client: LocalBridgeClient; project: LocalProjectSummary; run: LocalScanRun | null }) {
  const [releases, setReleases] = useState<LocalRelease[]>([]);
  const [releaseName, setReleaseName] = useState(run?.release ?? 'Working');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [publishedVersionInputs, setPublishedVersionInputs] = useState<Record<string, string>>({});
  const [publishingReleaseId, setPublishingReleaseId] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setReleaseName(run?.release ?? 'Working');
  }, [run?.release]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void client.listProjectReleases(project.projectId).then((result) => {
      if (active) setReleases(result.items);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load persisted releases');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, project.projectId]);

  async function createRelease(event: FormEvent) {
    event.preventDefault();
    if (!run) return;
    setCreating(true);
    setError('');
    try {
      const created = await client.createRelease(project.projectId, { scanRunId: run.id, release: releaseName.trim() || run.release });
      setReleases((current) => [created, ...current.filter((release) => release.id !== created.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the release');
    } finally {
      setCreating(false);
    }
  }

  async function recordPublishedVersion(release: LocalRelease, event: FormEvent) {
    event.preventDefault();
    const parsed = parsePublishedPlaceVersionInput(publishedVersionInputs[release.id] ?? '');
    if (!parsed.ok) {
      setPublishErrors((current) => ({ ...current, [release.id]: parsed.error }));
      return;
    }
    setPublishingReleaseId(release.id);
    setPublishErrors((current) => ({ ...current, [release.id]: '' }));
    try {
      const updated = await client.recordPublishedVersion(release.id, parsed.value);
      setReleases((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (reason) {
      setPublishErrors((current) => ({
        ...current,
        [release.id]: reason instanceof Error ? reason.message : 'Could not record the published place version',
      }));
    } finally {
      setPublishingReleaseId(null);
    }
  }

  const canCreate = run?.state === 'COMPLETED';

  return <section className="local-releases-workspace" aria-labelledby="local-releases-title"><header className="local-scan-heading"><div><span>Persisted releases</span><h2 id="local-releases-title">Export the evidence that actually passed—or failed—the gate.</h2><p>Each release is rebuilt from the immutable scan, latest source evidence, and latest append-only decisions. Manifest and policy-report downloads come from the desktop bridge.</p></div><div className="local-bridge-badge"><FileJson size={16} /><span><strong>{project.name}</strong><small>{releases.length} persisted release{releases.length === 1 ? '' : 's'}</small></span></div></header><form className="local-release-create" onSubmit={createRelease}><label><span>Release name</span><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} maxLength={120} /></label><div><span>Source run</span><strong>{run ? `${run.release} · ${stateLabel(run.state)}` : 'No active persisted run'}</strong></div><button className="button button-primary" type="submit" disabled={!canCreate || creating}>{creating ? <LoaderCircle className="spin" size={14} /> : <FileCheck2 size={14} />} Build release record</button></form>{error ? <div className="local-scan-error" role="alert"><AlertTriangle size={15} /><span><strong>Release operation failed</strong><small>{error}</small></span></div> : null}<div className="local-release-list">{loading ? <div className="local-monitor-empty"><LoaderCircle className="spin" size={20} /><strong>Loading releases…</strong></div> : releases.length ? releases.map((release) => <article key={release.id}><header><span className="local-run-state" data-state={release.policyResult === 'PASS' ? 'completed' : 'failed'}>{release.policyResult === 'PASS' ? <Check size={13} /> : <AlertTriangle size={13} />}{release.policyResult}</span><div><strong>{release.release ?? release.releaseName ?? 'Release'}</strong><small>{new Date(release.createdAt).toLocaleString()} · run {release.scanRunId.slice(0, 10)}…</small></div></header><dl><div><dt>Added</dt><dd>{release.comparison.added}</dd></div><div><dt>Changed</dt><dd>{release.comparison.changed}</dd></div><div><dt>Removed</dt><dd>{release.comparison.removed}</dd></div><div><dt>Unresolved</dt><dd>{release.comparison.unresolved}</dd></div><div><dt>Approved</dt><dd>{release.comparison.approved}</dd></div><div><dt>Blocked</dt><dd>{release.comparison.blocked}</dd></div></dl>{release.experience ? <p className="local-release-experience">Declared experience (not verified): {experienceSummary(release.experience)}</p> : null}{release.comparison.previousReleaseId ? <p className="local-release-rollback">Rollback target: {resolveRollbackTargetLabel(release.comparison.previousReleaseId, releases)} — <a href={client.releaseManifestUrl(release.comparison.previousReleaseId)} download>manifest</a>. Roll back to this release in Roblox Studio if this one must be reverted — CreatorFlow does not perform the rollback.</p> : null}{release.publishedPlaceVersion != null ? <p className="local-release-published">Published as place version {release.publishedPlaceVersion} <EvidenceBasisMark basis="DECLARED" compact /> <small>(self-reported — not verified against Roblox)</small></p> : <form className="local-decision-form local-release-publish-form" onSubmit={(event) => recordPublishedVersion(release, event)}><label><span>Record the Roblox place version you published</span><input inputMode="numeric" value={publishedVersionInputs[release.id] ?? ''} onChange={(event) => setPublishedVersionInputs((current) => ({ ...current, [release.id]: event.target.value }))} placeholder="e.g. 42" /></label>{publishErrors[release.id] ? <small role="alert">{publishErrors[release.id]}</small> : null}<button className="button button-secondary" type="submit" disabled={publishingReleaseId === release.id}>{publishingReleaseId === release.id ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Record published version</button></form>}<div className="local-release-downloads"><a href={release.manifestUrl} download><FileJson size={13} /> Manifest JSON</a><a href={release.reportUrl} download><ShieldCheck size={13} /> Gate report</a></div>{release.comparison.addedPaths.length || release.comparison.changedPaths.length || release.comparison.removedPaths.length ? <details><summary>Path-level comparison</summary><div>{release.comparison.addedPaths.map((path) => <span key={`a-${path}`}>Added · {path}</span>)}{release.comparison.changedPaths.map((path) => <span key={`c-${path}`}>Changed · {path}</span>)}{release.comparison.removedPaths.map((path) => <span key={`r-${path}`}>Removed · {path}</span>)}</div></details> : null}</article>) : <div className="local-monitor-empty"><FileJson size={20} /><strong>No releases exported yet</strong><p>{canCreate ? 'Build the first immutable release record from the completed scan.' : 'Complete or reopen a completed local scan before creating a release.'}</p></div>}</div></section>;
}

export function LocalSourcesBoundary({ onOpenEvidence }: { onOpenEvidence: () => void }) {
  return <section className="local-workspace-boundary"><Library size={22} /><div><span>Persisted source evidence</span><h2>Source records live with each immutable asset.</h2><p>Open Evidence to inspect or append the real source/license record saved for a selected asset. Project-wide source aggregation is the remaining source-library API boundary.</p></div><button className="button button-primary" type="button" onClick={onOpenEvidence}>Open persisted evidence</button></section>;
}
