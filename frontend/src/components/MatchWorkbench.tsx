import { ArrowLeftRight, Check, ExternalLink, Link2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { lazy, Suspense, useState } from 'react';
import type { AssetRecord, SourceMatch } from '../data';
import { AssetArtwork } from './AssetArtwork';
import { StatusMark } from './StatusMark';

const GlbComparisonViewer = lazy(() => import('./GlbComparisonViewer').then((module) => ({ default: module.GlbComparisonViewer })));

interface MatchWorkbenchProps {
  asset: AssetRecord;
  onClose: () => void;
  onUseSource: (match: SourceMatch) => void;
}

export function MatchWorkbench({ asset, onClose, onUseSource }: MatchWorkbenchProps) {
  const matches = asset.matches ?? [];
  const [selectedId, setSelectedId] = useState(matches[0]?.id ?? '');
  const [split, setSplit] = useState(52);
  const [comparisonMode, setComparisonMode] = useState<'side' | 'wipe' | 'blink'>(matches[0]?.similarity === 100 ? 'wipe' : 'side');
  const selected = matches.find((match) => match.id === selectedId) ?? matches[0];

  if (!selected) return null;

  const visibleDifferenceCount = selected.differences.filter((difference) => difference.visibility === 'visible').length;
  const primaryVisibleDifference = selected.differences.find((difference) => difference.visibility === 'visible');
  const matchLabel = selected.similarity === 100 ? 'Exact byte match' : `${selected.similarity}% match confidence`;
  const isModelComparison = Boolean(asset.modelUrl && selected.modelUrl);

  return (
    <motion.section
      id="match-workbench"
      className="match-workbench"
      aria-labelledby="match-workbench-title"
      initial={{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
      animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0)' }}
      exit={{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }}
      transition={{ duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="match-workbench-header">
        <div>
          <span>Match investigation · sample records</span>
          <h3 id="match-workbench-title">Trace the finding before making the call.</h3>
        </div>
        <button className="icon-close" type="button" onClick={onClose} aria-label="Close match investigation"><X size={18} /></button>
      </header>

      <div className="match-workbench-grid">
        <div className="comparison-bay">
          <div className="comparison-toolbar">
            <span><ArrowLeftRight size={14} /> Visual comparison</span>
            <div className="comparison-score"><strong>{matchLabel}</strong><small>{selected.similarity === 100 ? 'Same bytes, same appearance' : 'Not a pixel-difference percentage'}</small></div>
          </div>
          <div className="comparison-modebar" aria-label="Comparison display mode">
            <div>
              <button type="button" className={comparisonMode === 'side' ? 'selected' : ''} onClick={() => setComparisonMode('side')} aria-pressed={comparisonMode === 'side'}>Side by side</button>
              <button type="button" className={comparisonMode === 'blink' ? 'selected' : ''} onClick={() => setComparisonMode('blink')} aria-pressed={comparisonMode === 'blink'}>Blink A/B</button>
              <button type="button" className={comparisonMode === 'wipe' ? 'selected' : ''} onClick={() => setComparisonMode('wipe')} aria-pressed={comparisonMode === 'wipe'}>Registered wipe</button>
            </div>
            <span>{comparisonMode === 'side' ? 'Complete files, equal framing, no hidden half.' : comparisonMode === 'blink' ? 'Full-frame alternation makes appearance edits unmistakable.' : isModelComparison ? 'Both models share one camera; the divider reveals the edit.' : 'A registered divider reveals the project and candidate at the same scale.'}</span>
          </div>
          {primaryVisibleDifference ? (
            <div className="comparison-watch">
              <span>Watch for</span>
              <strong>{primaryVisibleDifference.label}</strong>
              <p>{primaryVisibleDifference.sourceValue} <i aria-hidden="true">→</i> {primaryVisibleDifference.projectValue}</p>
            </div>
          ) : (
            <div className="comparison-watch comparison-watch-exact"><span>Expected result</span><strong>No visible change</strong><p>This record points to the exact same project bytes.</p></div>
          )}
          <div className={`comparison-viewport comparison-mode-${comparisonMode} variant-${selected.variant} confidence-${selected.similarity < 50 ? 'low' : selected.similarity < 80 ? 'medium' : 'high'} ${isModelComparison ? 'comparison-viewport-model' : 'comparison-viewport-artwork'}`}>
            {isModelComparison ? (
              <Suspense fallback={<div className="model-state"><span />Preparing 3D comparison…</div>}>
                <GlbComparisonViewer split={split} mode={comparisonMode} projectUrl={asset.modelUrl!} sourceUrl={selected.modelUrl!} projectLabel={asset.name} sourceLabel={selected.title} fallbackUrl={asset.previewUrl} initialRotation={asset.modelRotation} />
              </Suspense>
            ) : (
              <>
                <div className="comparison-layer comparison-project" style={comparisonMode === 'wipe' ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : undefined}><AssetArtwork kind={asset.kind} previewUrl={asset.previewUrl} version="project" similarity={selected.similarity} title={`${asset.name} project preview`} /></div>
                <div className="comparison-layer comparison-source" style={comparisonMode === 'wipe' ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}><AssetArtwork kind={asset.kind} previewUrl={asset.previewUrl} version="source" similarity={selected.similarity} title={`${selected.title} source preview`} /></div>
              </>
            )}
            {comparisonMode === 'wipe' ? <div className="comparison-split" style={{ left: `${split}%` }} aria-hidden="true"><i /></div> : null}
            {comparisonMode === 'side' ? <div className="comparison-split comparison-split-static" style={{ left: '50%' }} aria-hidden="true" /> : null}
            {comparisonMode !== 'blink' ? <span className="comparison-label comparison-label-a">Project asset</span> : null}
            {comparisonMode !== 'blink' ? <span className="comparison-label comparison-label-b">Source record</span> : null}
          </div>
          {comparisonMode === 'wipe' ? (
            <label className="comparison-range">
              <span>Registered reveal</span>
              <input type="range" min="8" max="92" value={split} onChange={(event) => setSplit(Number(event.target.value))} />
            </label>
          ) : null}
          <section className="difference-register" aria-labelledby="difference-register-title">
            <header>
              <span id="difference-register-title">Detected deltas</span>
              <strong>{visibleDifferenceCount ? `${visibleDifferenceCount} visible · ${selected.differences.length - visibleDifferenceCount} record-only` : 'No visual delta'}</strong>
            </header>
            <div className="difference-columns" aria-hidden="true"><span>Source record</span><span>Project asset</span></div>
            {selected.differences.map((difference) => (
              <div className={`difference-row difference-${difference.visibility}`} key={`${selected.id}-${difference.label}`}>
                <div className="difference-name">
                  <span>{difference.category}</span>
                  <strong>{difference.label}</strong>
                </div>
                <p>{difference.sourceValue}</p>
                <i aria-hidden="true">→</i>
                <p>{difference.projectValue}</p>
                <em>{difference.visibility === 'visible' ? 'Visible' : difference.visibility === 'exact' ? 'Exact' : 'Record only'}</em>
              </div>
            ))}
          </section>
          <p className="comparison-relationship">{selected.relationship}</p>
        </div>

        <div className="match-source-list" aria-label="Matching source records">
          <div className="match-list-heading"><span>Matching records</span><strong>{matches.length}</strong></div>
          {matches.map((match, index) => (
            <button
              key={match.id}
              className={match.id === selected.id ? 'selected' : ''}
              type="button"
              onClick={() => { setSelectedId(match.id); setComparisonMode(match.similarity === 100 ? 'wipe' : 'side'); }}
              aria-pressed={match.id === selected.id}
            >
              <span className="source-index">0{index + 1}</span>
              <span><strong>{match.title}</strong><small>{match.provider}</small></span>
              <span className="source-similarity">{match.similarity}%</span>
            </button>
          ))}
        </div>

        <aside className="match-record">
          <div className="match-record-state"><StatusMark value="review" /><span>{selected.recordType}</span></div>
          <h4>{selected.title}</h4>
          <p>{selected.provider}</p>
          <dl>
            <div><dt>Method</dt><dd>{selected.method}</dd></div>
            <div><dt>Registered</dt><dd>{selected.firstRegistered}</dd></div>
            <div><dt>License</dt><dd>{selected.license}</dd></div>
            <div><dt>Record hash</dt><dd><code>{selected.hash.slice(0, 18)}…</code></dd></div>
          </dl>
          {selected.sourceUrl || selected.licenseUrl ? (
            <div className="match-record-links">
              {selected.sourceUrl ? <a href={selected.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open evidence record</a> : null}
              {selected.licenseUrl ? <a href={selected.licenseUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Read license</a> : null}
            </div>
          ) : null}
          <div className="match-limit"><Link2 size={15} /><p><strong>What this proves</strong>The project file is technically related to this record. Permission still comes from the attached license and your release decision.</p></div>
          <button className="button button-primary" type="button" onClick={() => onUseSource(selected)}><Check size={16} /> Attach source and required credit</button>
        </aside>
      </div>
    </motion.section>
  );
}
