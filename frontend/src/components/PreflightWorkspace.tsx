import {
  ArrowDownToLine,
  ChevronRight,
  FileCheck2,
  Filter,
  FolderOpen,
  RotateCcw,
  ScanSearch,
  SearchCheck,
  ShieldCheck,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRecord, EvidenceStatus, SourceMatch } from '../data';
import { initialAssets } from '../data';
import { buildReleaseManifest } from '../manifest/releaseManifest';
import { AssetArtwork } from './AssetArtwork';
import { MatchWorkbench } from './MatchWorkbench';
import { StatusMark } from './StatusMark';

type ScanState = 'idle' | 'scanning' | 'complete';
type FilterValue = 'all' | EvidenceStatus;

interface PreflightWorkspaceProps {
  startSignal: number;
}

const scanMessages = [
  'Indexing project files',
  'Computing exact hashes',
  'Comparing visual signatures',
  'Inspecting audio fingerprints',
  'Checking license records',
];

export function PreflightWorkspace({ startSignal }: PreflightWorkspaceProps) {
  const reduceMotion = useReducedMotion();
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [progress, setProgress] = useState(0);
  const [assets, setAssets] = useState<AssetRecord[]>(initialAssets);
  const [selectedId, setSelectedId] = useState(initialAssets[0].id);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [notice, setNotice] = useState('');
  const [investigatingId, setInvestigatingId] = useState<string | null>(null);
  const lastSignal = useRef(0);

  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  const unresolved = assets.filter((asset) => asset.decision === 'blocked' || asset.decision === 'pending' || asset.decision === 'needs-review');
  const blocked = assets.filter((asset) => asset.status === 'blocked' && asset.decision !== 'excluded').length;
  const review = assets.filter((asset) => asset.status === 'review' && asset.decision !== 'approved').length;
  const clear = assets.filter((asset) => asset.decision === 'approved').length;
  const releaseReady = scanState === 'complete' && unresolved.length === 0;
  const investigatingAsset = assets.find((asset) => asset.id === investigatingId);

  const visibleAssets = useMemo(
    () => (filter === 'all' ? assets : assets.filter((asset) => asset.status === filter)),
    [assets, filter],
  );

  const startScan = useCallback(() => {
    setNotice('');
    setScanState('scanning');
    setProgress(0);
    setAssets(initialAssets);
    setSelectedId(initialAssets[0].id);
    setFilter('all');
    setInvestigatingId(null);
  }, []);

  useEffect(() => {
    if (startSignal > lastSignal.current) {
      lastSignal.current = startSignal;
      startScan();
    }
  }, [startSignal, startScan]);

  useEffect(() => {
    if (scanState !== 'scanning') return;

    if (reduceMotion) {
      setProgress(100);
      setScanState('complete');
      return;
    }

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(100, current + 4);
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => setScanState('complete'), 180);
        }
        return next;
      });
    }, 70);

    return () => window.clearInterval(timer);
  }, [scanState, reduceMotion]);

  function updateSelected(changes: Partial<AssetRecord>, message: string) {
    setAssets((current) => current.map((asset) => (asset.id === selected.id ? { ...asset, ...changes } : asset)));
    setNotice(message);
  }

  function applyPreparedResolutions() {
    setAssets((current) => current.map((asset) => {
      if (asset.id === 'avocado-prop' || asset.id === 'harbor-fish') {
        return { ...asset, license: 'CC0 1.0 · upstream source record attached', decision: 'approved', status: 'clear' };
      }
      if (asset.id === 'ui-icon-set') {
        return { ...asset, decision: 'excluded' };
      }
      if (asset.id === 'ambient-loop') {
        return { ...asset, decision: 'excluded' };
      }
      return asset;
    }));
    setNotice('Prepared resolutions applied: two CC0 source records attached and two unverified assets excluded from this release.');
  }

  function openInvestigation(asset: AssetRecord) {
    setSelectedId(asset.id);
    setInvestigatingId(asset.id);
    setNotice(`Opened ${asset.matches?.length ?? 0} matching source records for ${asset.name}.`);
    window.setTimeout(() => {
      document.getElementById('match-workbench')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }, 60);
  }

  function attachSourceRecord(match: SourceMatch) {
    if (!investigatingAsset) return;
    setAssets((current) => current.map((asset) => asset.id === investigatingAsset.id ? {
      ...asset,
      origin: match.provider,
      license: `${match.license} · source record attached`,
      status: 'clear',
      decision: 'approved',
    } : asset));
    setNotice(`${match.title} attached to ${investigatingAsset.name}; required credit added to the release record.`);
    setInvestigatingId(null);
  }

  function exportManifest() {
    if (!releaseReady) return;
    const manifest = buildReleaseManifest(assets, {
      projectName: 'Northwind',
      release: '1.2.0',
      generatedAt: new Date().toISOString(),
    });
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'northwind-1.2-creative-manifest.json';
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Creative asset manifest exported for Northwind 1.2.');
  }

  const scanMessage = scanMessages[Math.min(scanMessages.length - 1, Math.floor(progress / 21))];

  return (
    <section className="sample-preflight" id="sample-preflight" aria-labelledby="sample-title">
      <div className="sample-intro">
        <div>
          <p className="section-index">Interactive sample</p>
          <h2 id="sample-title">Make the release decision.</h2>
          <p>Run the sample, inspect the evidence, apply the prepared human decisions, then export the manifest. Nothing uploads; this demo runs entirely in your browser.</p>
        </div>
        {scanState !== 'scanning' && (
          <button className="button button-primary" type="button" onClick={startScan}>
            {scanState === 'complete' ? <RotateCcw size={16} /> : <ScanSearch size={16} />}
            {scanState === 'complete' ? 'Run the scan again' : 'Run sample preflight'}
          </button>
        )}
      </div>

      <div className="core-milestone" aria-label="Production core milestone">
        <span>Production bridge</span>
        <div><strong>Java core → manifest v0.1</strong><small>32 real local files scanned · 0 bytes uploaded · source gaps preserved</small></div>
        <a href="/assets/creatorflow-real-assets-manifest.json" download="creatorflow-real-assets-manifest.json">Download generated manifest <ArrowDownToLine size={14} /></a>
        <a href="/creatorflow-manifest-v0.1.schema.json" download="creatorflow-manifest-v0.1.schema.json">JSON Schema <ArrowDownToLine size={14} /></a>
      </div>

      <div className={`preflight-app scan-${scanState}`}>
        <header className="preflight-toolbar">
          <div className="preflight-project">
            <FolderOpen size={16} />
            <span><strong>Northwind</strong><small>Release 1.2 · local project</small></span>
          </div>
          <div className="preflight-scan-state" aria-live="polite">
            {scanState === 'idle' && <><span className="state-dot" />Ready to scan</>}
            {scanState === 'scanning' && <><span className="state-dot scanning" />{scanMessage}</>}
            {scanState === 'complete' && <><ShieldCheck size={15} />Preflight complete</>}
          </div>
          <button className="button button-secondary toolbar-export" type="button" disabled={!releaseReady} onClick={exportManifest}>
            <ArrowDownToLine size={15} /> Export manifest
          </button>
        </header>

        <AnimatePresence mode="wait">
          {scanState === 'idle' && (
            <motion.div key="idle" className="preflight-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="empty-folder" aria-hidden="true"><FolderOpen size={35} /></div>
              <h3>Project selected. No preflight yet.</h3>
              <p>CreatorFlow will index 248 creative files, compare their fingerprints, and check the release records already in this folder.</p>
              <button className="button button-primary" type="button" onClick={startScan}><ScanSearch size={16} /> Start local scan</button>
            </motion.div>
          )}

          {scanState === 'scanning' && (
            <motion.div key="scanning" className="scan-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="scan-stage-copy">
                <span className="section-index">Local analysis</span>
                <h3>{scanMessage}</h3>
                <p>Files remain on this machine. The sample registry comparison sends fingerprints only.</p>
              </div>
              <div className="scan-readout">
                <strong>{progress}%</strong>
                <div className="scan-track" role="progressbar" aria-label="Preflight scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <motion.span animate={{ width: `${progress}%` }} transition={{ duration: 0.08 }} />
                </div>
                <dl>
                  <div><dt>Files indexed</dt><dd>{Math.round(progress * 2.48)} / 248</dd></div>
                  <div><dt>Bytes uploaded</dt><dd>0</dd></div>
                </dl>
              </div>
            </motion.div>
          )}

          {scanState === 'complete' && (
            <motion.div key="complete" className="preflight-layout" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="preflight-main">
                <div className="preflight-controls">
                  <div className="filter-group" role="group" aria-label="Filter evidence by status">
                    <Filter size={14} aria-hidden="true" />
                    {(['all', 'blocked', 'review', 'clear'] as FilterValue[]).map((value) => (
                      <button key={value} type="button" className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
                        {value === 'all' ? 'All assets' : value[0].toUpperCase() + value.slice(1)}
                      </button>
                    ))}
                  </div>
                  <span>{visibleAssets.length} of {assets.length} sample assets</span>
                </div>

                <div className="ledger-scroll" tabIndex={0} aria-label="Creative asset preflight ledger">
                  <table className="asset-ledger">
                    <thead>
                      <tr><th>Asset</th><th>Origin</th><th>License</th><th>Automated evidence</th><th>Release state</th></tr>
                    </thead>
                    <tbody>
                      {visibleAssets.map((asset) => (
                        <tr key={asset.id} className={selected.id === asset.id ? 'selected' : ''}>
                          <td>
                            <button type="button" className="asset-select" onClick={() => { setSelectedId(asset.id); setNotice(''); }} aria-pressed={selected.id === asset.id}>
                              <AssetArtwork kind={asset.kind} previewUrl={asset.previewUrl} title={asset.name} />
                              <span><strong>{asset.name}</strong><small>{asset.path} · {asset.size}</small></span>
                              <ChevronRight size={14} />
                            </button>
                          </td>
                          <td><strong>{asset.origin}</strong><small>{asset.firstSeen}</small></td>
                          <td><span>{asset.license}</span></td>
                          <td>
                            <StatusMark value={asset.status} />
                            {asset.matches?.length ? (
                              <button className="match-link" type="button" onClick={() => openInvestigation(asset)}>
                                <SearchCheck size={13} /> {asset.fingerprint} <ChevronRight size={13} />
                              </button>
                            ) : <small>{asset.fingerprint}</small>}
                          </td>
                          <td><StatusMark value={asset.decision} /><small>{asset.owner}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="decision-panel" aria-label={`Evidence for ${selected.name}`}>
                <div className="decision-title">
                  <span className="section-index">Selected evidence</span>
                  <h3>{selected.name}</h3>
                  <code>{selected.path}/{selected.name}</code>
                </div>
                <AssetArtwork kind={selected.kind} previewUrl={selected.previewUrl} title={selected.name} />
                <div className="decision-finding">
                  <StatusMark value={selected.status} />
                  <p>{selected.evidence}</p>
                  {selected.matches?.length ? (
                    <button className="inspect-matches" type="button" onClick={() => openInvestigation(selected)}>
                      <SearchCheck size={15} /> Inspect {selected.matches.length} matching source records <ChevronRight size={14} />
                    </button>
                  ) : null}
                </div>
                <dl className="decision-meta">
                  <div><dt>Source</dt><dd>{selected.origin}</dd></div>
                  <div><dt>License</dt><dd>{selected.license}</dd></div>
                  <div><dt>SHA-256</dt><dd><code>{selected.hash.slice(0, 16)}…</code></dd></div>
                </dl>

                {selected.decision !== 'approved' && selected.decision !== 'excluded' ? (
                  <div className="resolution-actions">
                    <h4>Record a human decision</h4>
                    <button type="button" onClick={() => updateSelected({ status: 'clear', decision: 'approved', license: 'License and attribution recorded' }, `License record attached to ${selected.name}.`)}>
                      <FileCheck2 size={16} /><span><strong>Attach license record</strong><small>Record the source and required credit.</small></span>
                    </button>
                    <button type="button" onClick={() => updateSelected({ decision: 'excluded' }, `${selected.name} excluded from Northwind 1.2.`)}>
                      <StatusMark value="excluded" compact /><span><strong>Exclude from release</strong><small>Keep the file in the project, but not in this build.</small></span>
                    </button>
                  </div>
                ) : (
                  <div className="resolved-note"><StatusMark value={selected.decision} /> This asset no longer blocks the release.</div>
                )}

                {unresolved.length > 0 && (
                  <button type="button" className="button button-secondary prepared-button" onClick={applyPreparedResolutions}>
                    Apply prepared sample resolutions
                  </button>
                )}
              </aside>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {scanState === 'complete' && investigatingAsset?.matches?.length ? (
            <MatchWorkbench
              key={investigatingAsset.id}
              asset={investigatingAsset}
              onClose={() => setInvestigatingId(null)}
              onUseSource={attachSourceRecord}
            />
          ) : null}
        </AnimatePresence>

        {scanState === 'complete' && (
          <footer className="release-bar">
            <div className={`release-summary ${releaseReady ? 'ready' : ''}`} aria-live="polite">
              <StatusMark value={releaseReady ? 'clear' : blocked > 0 ? 'blocked' : 'review'} />
              <span><strong>{releaseReady ? 'Ready to export' : 'Release needs a decision'}</strong><small>{releaseReady ? `${clear} approved · ${assets.length - clear} excluded` : `${blocked} blocked · ${review} need review · ${clear} approved`}</small></span>
            </div>
            <div className="release-actions">
              {!releaseReady && <button className="button button-secondary" type="button" onClick={applyPreparedResolutions}>Resolve sample exceptions</button>}
              <button className="button button-primary" type="button" disabled={!releaseReady} onClick={exportManifest}><ArrowDownToLine size={16} /> Export release manifest</button>
            </div>
          </footer>
        )}
      </div>
      <div className="live-notice" aria-live="polite">{notice}</div>
    </section>
  );
}
