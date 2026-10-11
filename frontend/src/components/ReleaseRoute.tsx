import {
  ArrowDownToLine,
  ArrowRight,
  AudioWaveform,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleMinus,
  FileCheck2,
  FileDown,
  Film,
  Fingerprint,
  GitBranch,
  HardDrive,
  Image,
  ListChecks,
  Lock,
  Minus,
  Mountain,
  OctagonX,
  Receipt,
  RotateCcw,
  ScanSearch,
  SearchCheck,
  Shapes,
  ShieldCheck,
  TriangleAlert,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { assetUrl } from '../assetUrl';
import type { AssetKind, AssetRecord, SourceMatch } from '../data';
import { initialAssets } from '../data';
import { buildReleaseManifest } from '../manifest/releaseManifest';
import {
  SAMPLE_RELEASE,
  SCAN_STEPS,
  applyPreparedResolutions,
  assetsInGroup,
  attachSourceRecord,
  currentStationIndex,
  evidenceSplit,
  excludeFromRelease,
  recordLicense,
  releaseCounts,
  releaseGroup,
  routeStations,
  primaryMatch,
  walkedThrough,
  type ReleaseCounts,
  type ReleaseGroup,
  type ScanPhase,
  type Station,
  type StationState,
} from '../releaseRoute';
import { contourPaths, routePaths, type Point } from '../routeGeometry';
import { BrandMark } from './BrandMark';
import { MatchWorkbench } from './MatchWorkbench';
import './ReleaseRoute.css';

/**
 * The landing page: the sample release drawn as a survey route.
 *
 * The verdict sits at the top like a survey marker, and the release runs as a route across
 * CreatorFlow's own contours through four stations — Scan, Evidence, Exceptions, Export — each
 * opening into a card. Every count and every station word comes from `releaseRoute.ts`, the same
 * rules the workspace's release bar uses, so the route cannot say "done" while files are open.
 *
 * State is a handful of cells (the asset records, the scan phase, which file is open, which file
 * is under investigation, the measured layout). Everything on screen is derived from them.
 */

type WorkspaceEntry = 'overview' | 'motion';

interface ReleaseRouteProps {
  onOpenWorkspace: (view?: WorkspaceEntry) => void;
  /** Where the scan starts. The landing page opens on the finished sample; tests use the others. */
  initialPhase?: Exclude<ScanPhase, 'failed'>;
  /** Content that continues on the survey canvas below the route (the live rig). */
  children?: ReactNode;
}

const GROUP: Record<ReleaseGroup, { label: string; Icon: LucideIcon }> = {
  blocked: { label: 'Blocked', Icon: OctagonX },
  review: { label: 'Needs review', Icon: CircleDot },
  clear: { label: 'Approved', Icon: CircleCheck },
  excluded: { label: 'Excluded', Icon: CircleMinus },
};

const STATE_ICON: Record<StationState, LucideIcon> = {
  done: CircleCheck,
  review: CircleDot,
  open: OctagonX,
  ready: FileDown,
  locked: Lock,
  next: ScanSearch,
  running: ScanSearch,
  waiting: Lock,
  failed: TriangleAlert,
};

const STATION_ICON: Record<Station['id'], LucideIcon> = {
  scan: ScanSearch,
  evidence: Fingerprint,
  exceptions: ListChecks,
  export: FileDown,
};

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  model: Box,
  mesh: Mountain,
  mountain: Mountain,
  sprite: Image,
  texture: Image,
  icons: Shapes,
  wave: AudioWaveform,
  font: Type,
  video: Film,
  receipt: Receipt,
};

const DECISION_WORD: Record<AssetRecord['decision'], string> = {
  approved: 'Approved',
  'needs-review': 'Needs review',
  blocked: 'Blocked',
  pending: 'Pending',
  excluded: 'Excluded',
};

/** Each station node sits a little off the lane's centre line, so the route bends between them. */
const NODE_OFFSET = [-36, 34, -24, 30];

/** Scan walkthrough pacing, the same as the workspace sample: +4% every 70 ms. */
const SCAN_TICK_MS = 70;
const SCAN_STEP_PERCENT = 4;

/** Contours are re-traced only when the height crosses one of these bands. */
const TERRAIN_BAND = 400;

const MANIFEST_URL = assetUrl('assets/creatorflow-real-assets-manifest.json');
const SCHEMA_URL = assetUrl('creatorflow-manifest-v0.1.schema.json');
const RIG_POSTER_URL = assetUrl('assets/robot-expressive-preview.svg');

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(dot);
}

const firstBlockedId = (assets: readonly AssetRecord[]) => assetsInGroup(assets, 'blocked')[0]?.id ?? null;

// ------------------------------------------------------------------------------- small parts

function SurveyMarker() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="m-ring" cx="32" cy="32" r="29" />
      <circle className="m-inner" cx="32" cy="32" r="21" />
      <path className="m-tick" d="M32 1v7M32 56v7M1 32h7M56 32h7" />
      <path className="m-tri" d="M32 19 44.5 41h-25Z" />
      <circle className="m-dot" cx="32" cy="34" r="2.6" />
    </svg>
  );
}

function HereTag({ className }: { className: string }) {
  return (
    <span className={`route-here ${className}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><path d="M12 9v6M9 12h6" /></svg>
      You are here
    </span>
  );
}

function GroupTag({ group }: { group: ReleaseGroup }) {
  const { label, Icon } = GROUP[group];
  return <span className={`route-tag tone-${group}`}><Icon aria-hidden="true" />{label}</span>;
}

function StationStatus({ station }: { station: Station }) {
  const Icon = STATE_ICON[station.state];
  return <span className={`route-status state-${station.state}`}><Icon aria-hidden="true" />{station.word}</span>;
}

function StepFoot({ station }: { station: Station }) {
  return (
    <span className="route-step">
      <span>{station.body}</span>
      <span className="route-step-out"><ArrowRight aria-hidden="true" /> {station.output}</span>
    </span>
  );
}

function CardHead({ station, here }: { station: Station; here: boolean }) {
  return (
    <header className="route-card-head">
      <div>
        <p className="route-label">Station {station.number}</p>
        <h2 id={`station-title-${station.id}`}>{station.title}</h2>
      </div>
      {here ? <HereTag className="route-here-head" /> : null}
      <StationStatus station={station} />
    </header>
  );
}

interface StopProps {
  station: Station;
  index: number;
  here: boolean;
  wide?: boolean;
  children: ReactNode;
}

function Stop({ station, index, here, wide = false, children }: StopProps) {
  const NodeIcon = STATION_ICON[station.id];
  return (
    <li className="route-stop" id={`station-${station.id}`} style={{ '--route-dx': `${NODE_OFFSET[index]}px` } as CSSProperties}>
      <div className="route-lane">
        <span className={`route-node state-${station.state}`} data-route-point aria-hidden="true"><NodeIcon /></span>
        {here ? <HereTag className="route-here-lane" /> : null}
      </div>
      <article className={`route-card${wide ? ' wide' : ''}`} aria-labelledby={`station-title-${station.id}`}>
        {children}
      </article>
    </li>
  );
}

// ------------------------------------------------------------------------------- file rows

interface FileActions {
  openId: string | null;
  investigatingId: string | null;
  onToggle: (id: string) => void;
  onRecordLicense: (asset: AssetRecord) => void;
  onExclude: (asset: AssetRecord) => void;
  onInvestigate: (asset: AssetRecord) => void;
  onCloseInvestigation: () => void;
  onUseSource: (match: SourceMatch) => void;
}

function FileDetail({ asset, actions }: { asset: AssetRecord; actions: FileActions }) {
  const match = primaryMatch(asset);
  const group = releaseGroup(asset);
  const records = asset.matches?.length ?? 0;
  return (
    <div className="route-detail" id={`file-detail-${asset.id}`}>
      <div>
        <h4 className="route-label">What the scan found</h4>
        <p>{asset.evidence}</p>
        {match ? (
          <>
            <h4 className="route-label">Matched record</h4>
            <p className="route-match"><span>{match.title}</span><b className="num">{match.similarity}%</b></p>
            <div className="route-meter" aria-hidden="true"><i style={{ width: `${match.similarity}%` }} /></div>
            <p className="route-match-sub">{match.provider} · {match.method} · {plural(records, 'record', 'records')}</p>
          </>
        ) : null}
      </div>
      <div>
        <h4 className="route-label">Record</h4>
        <dl className="route-facts">
          <dt>Decision</dt><dd>{DECISION_WORD[asset.decision]}</dd>
          <dt>Owner</dt><dd>{asset.owner}</dd>
          <dt>Origin</dt><dd>{asset.origin}</dd>
          <dt>License</dt><dd>{asset.license}</dd>
          <dt>Evidence</dt><dd>{asset.fingerprint}</dd>
          <dt>First seen</dt><dd className="num">{asset.firstSeen}</dd>
          <dt>SHA-256</dt><dd className="mono">{asset.hash}</dd>
        </dl>
        <div className="route-actions">
          {group === 'blocked' || group === 'review' ? (
            <>
              <button className="button button-secondary" type="button" onClick={() => actions.onRecordLicense(asset)}><FileCheck2 size={16} aria-hidden="true" />Attach license record</button>
              <button className="button button-secondary" type="button" onClick={() => actions.onExclude(asset)}><Minus size={16} aria-hidden="true" />Exclude from release</button>
            </>
          ) : null}
          {records > 0 ? (
            <button className="button button-secondary" type="button" aria-expanded={actions.investigatingId === asset.id} onClick={() => actions.onInvestigate(asset)}>
              <SearchCheck size={16} aria-hidden="true" />Inspect {plural(records, 'matching source record', 'matching source records')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FileRow({ asset, actions }: { asset: AssetRecord; actions: FileActions }) {
  const group = releaseGroup(asset);
  const open = actions.openId === asset.id;
  const { label, Icon } = GROUP[group];
  return (
    <li className={`route-file${open ? ' open' : ''}`}>
      <button
        className="route-file-button"
        type="button"
        aria-expanded={open}
        aria-controls={open ? `file-detail-${asset.id}` : undefined}
        onClick={() => actions.onToggle(asset.id)}
      >
        <span className={`route-file-icon tone-${group}`}><Icon aria-hidden="true" /><span className="sr-only">{label}:</span></span>
        <span className="route-file-name"><span className="mono">{asset.name}</span><small>{asset.path} · {asset.size}</small></span>
        <span className="route-file-reason">{asset.license}</span>
        <span className={`route-file-owner${asset.owner === 'Unassigned' ? ' none' : ''}`}>{asset.owner}</span>
        <span className="route-file-chevron"><ChevronDown aria-hidden="true" /></span>
      </button>
      {open ? <FileDetail asset={asset} actions={actions} /> : null}
    </li>
  );
}

function GroupList({ assets, group, title, actions }: { assets: readonly AssetRecord[]; group: ReleaseGroup; title?: string; actions: FileActions }) {
  const items = assetsInGroup(assets, group);
  if (items.length === 0) return null;
  const { label, Icon } = GROUP[group];
  const investigating = items.find((asset) => asset.id === actions.investigatingId);
  return (
    <>
      <h3 className="route-group-head"><span className={`tone-${group}`}><Icon aria-hidden="true" /></span>{title ?? label} <span className="route-group-count num">{items.length}</span></h3>
      <ul className="route-files">{items.map((asset) => <FileRow key={asset.id} asset={asset} actions={actions} />)}</ul>
      {investigating ? (
        <div className="route-workbench">
          <MatchWorkbench key={investigating.id} asset={investigating} onClose={actions.onCloseInvestigation} onUseSource={actions.onUseSource} />
        </div>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------- the verdict

function verdictCopy(counts: ReleaseCounts): { tone: ReleaseGroup; word: string; Icon: LucideIcon; headline: string; lede: string } {
  const project = `${SAMPLE_RELEASE.projectName} ${SAMPLE_RELEASE.shortRelease}`;
  const excluded = counts.excluded ? ` ${plural(counts.excluded, 'file is', 'files are')} left out of this release.` : '';
  if (counts.ready) {
    return {
      tone: 'clear', word: 'Ready.', Icon: CircleCheck, headline: `${project} can ship.`,
      lede: `Every file has a decision. ${plural(counts.clear, 'file is', 'files are')} approved.${excluded}`,
    };
  }
  const review = counts.review ? ` ${counts.review} ${counts.blocked ? 'more ' : ''}${counts.review === 1 ? 'needs' : 'need'} a person to review the evidence.` : '';
  const approved = ` ${counts.clear} ${counts.clear === 1 ? 'is' : 'are'} approved.`;
  if (counts.blocked) {
    return {
      tone: 'blocked', word: 'Blocked.', Icon: OctagonX, headline: `${project} can't ship yet.`,
      lede: `${plural(counts.blocked, 'file is', 'files are')} blocked: a license or rights record is missing or incomplete.${review}${approved}${excluded}`,
    };
  }
  return {
    tone: 'review', word: 'Needs review.', Icon: CircleDot, headline: `${project} can't ship yet.`,
    lede: `${review.trim()}${approved}${excluded}`,
  };
}

function Verdict({ counts, stations, current, onOpenMotion }: { counts: ReleaseCounts; stations: Station[]; current: number; onOpenMotion: () => void }) {
  const copy = verdictCopy(counts);
  const cta = counts.blocked
    ? { href: '#station-exceptions', text: `Start with the ${plural(counts.blocked, 'blocker', 'blockers')}` }
    : counts.review
      ? { href: '#station-evidence', text: `Review the ${plural(counts.review, 'file', 'files')}` }
      : { href: '#station-export', text: 'Export the manifest' };
  return (
    <div className="route-stop route-top">
      <div className="route-lane"><span className={`route-marker tone-${copy.tone}`} data-route-point><SurveyMarker /></span></div>
      <section className="route-verdict" aria-labelledby="verdict-title">
        <p className="route-label">Verdict · {SAMPLE_RELEASE.projectName} release {SAMPLE_RELEASE.shortRelease} · sample data</p>
        <h1 id="verdict-title"><span className={`route-verdict-word tone-${copy.tone}`}><copy.Icon aria-hidden="true" />{copy.word}</span> {copy.headline}</h1>
        <p className="route-lede">{copy.lede}</p>
        <ul className="route-readout num">
          <li className="strong"><span className="tone-blocked"><OctagonX aria-hidden="true" /></span><b>{counts.blocked}</b> blocked</li>
          <li className="strong"><span className="tone-review"><CircleDot aria-hidden="true" /></span><b>{counts.review}</b> need review</li>
          <li className="strong"><span className="tone-clear"><CircleCheck aria-hidden="true" /></span><b>{counts.clear}</b> approved</li>
          {counts.excluded ? <li className="strong"><span className="tone-excluded"><CircleMinus aria-hidden="true" /></span><b>{counts.excluded}</b> excluded</li> : null}
          <li><HardDrive aria-hidden="true" />{counts.total} sample files</li>
          <li><Lock aria-hidden="true" />0 bytes uploaded</li>
        </ul>
        <nav className="route-summary" aria-label="Release route">
          <ol>
            {stations.map((station, index) => (
              <li key={station.id}>
                {index ? <ChevronRight className="route-summary-sep" aria-hidden="true" /> : null}
                <a href={`#station-${station.id}`} aria-current={index === current ? 'step' : undefined}>
                  <span className="mono">{station.number}</span>{station.name}<StationStatus station={station} />
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="route-cta">
          <a className="button button-primary" href={cta.href}>{cta.text} <ArrowRight size={16} aria-hidden="true" /></a>
          <button className="button button-secondary" type="button" onClick={onOpenMotion}><Fingerprint size={16} aria-hidden="true" />Compare two Roblox animations</button>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------- station cards

function ScanCard({ station, here, assets, onRescan }: { station: Station; here: boolean; assets: readonly AssetRecord[]; onRescan: () => void }) {
  return (
    <>
      <div className="route-art">
        <ul className="route-tiles" aria-label={`${assets.length} files indexed`}>
          {assets.map((asset) => {
            const KindIcon = KIND_ICON[asset.kind];
            return <li key={asset.id}><KindIcon aria-hidden="true" />{extensionOf(asset.name)}<span className="sr-only"> {asset.name}</span></li>;
          })}
        </ul>
        <p className="route-art-caption"><span>{assets.length} files indexed and fingerprinted</span><span className="mono">{SAMPLE_RELEASE.projectName} / Release {SAMPLE_RELEASE.shortRelease}</span></p>
      </div>
      <CardHead station={station} here={here} />
      <div className="route-card-body">
        <ul className="route-checks">{SCAN_STEPS.map((step) => <li key={step}><Check aria-hidden="true" />{step}</li>)}</ul>
        <p className="route-facts-line num">
          <span><HardDrive aria-hidden="true" />{assets.length} sample files</span>
          <span><Lock aria-hidden="true" />0 bytes uploaded</span>
          <span><CircleCheck aria-hidden="true" />{SCAN_STEPS.length} of {SCAN_STEPS.length} checks ran</span>
        </p>
        <p className="route-note"><ShieldCheck aria-hidden="true" />Sample walkthrough: these findings were prepared in advance, nothing was uploaded.</p>
      </div>
      <footer className="route-card-foot">
        <StepFoot station={station} />
        <button className="button button-secondary route-push" type="button" onClick={onRescan}><RotateCcw size={16} aria-hidden="true" />Run the scan again</button>
      </footer>
    </>
  );
}

function EvidenceCard({ station, here, assets, actions, onOpenMotion }: { station: Station; here: boolean; assets: readonly AssetRecord[]; actions: FileActions; onOpenMotion: () => void }) {
  const { near, weak } = evidenceSplit(assets);
  const similarity = (asset: AssetRecord) => primaryMatch(asset)?.similarity ?? 0;
  const nearAt = near.length ? similarity(near[0]) : 0;
  const weakRange = weak.length ? `${similarity(weak[weak.length - 1])}–${similarity(weak[0])}%` : '';
  const stripLabel = `Match strength for ${assets.length} files: ${plural(near.length, 'file', 'files')} at ${nearAt} percent, the others at ${weak.map(similarity).join(', ')} percent`;
  return (
    <>
      <div className="route-art">
        <div className="route-strip" role="img" aria-label={stripLabel}>
          {weak.map((asset) => <i key={asset.id} style={{ left: `${similarity(asset)}%`, height: `${Math.round(14 + similarity(asset) * 0.5)}px` }} />)}
          {near.length ? <i className="wide" style={{ left: `${nearAt}%`, height: '62px' }} /> : null}
        </div>
        <p className="route-strip-axis" aria-hidden="true"><span>0%</span><span>match strength</span><span>100%</span></p>
      </div>
      <CardHead station={station} here={here} />
      <div className="route-card-body">
        <div className="route-evidence-cols">
          {near.length ? (
            <div>
              <h3>Near-exact copies <span className="mono num">{near.length} at {nearAt}%</span></h3>
              <p>{near.every((asset) => asset.origin === near[0].origin) ? `All ${near.length} trace to ${near[0].origin}. ` : ''}What decides each one is whether its source record is attached.</p>
              <ul className="route-shots">
                {near.map((asset) => (
                  <li key={asset.id}>
                    {asset.previewUrl ? <img src={asset.previewUrl} alt={`Preview of ${asset.name}`} width={44} height={44} loading="lazy" /> : <span className="route-shot-icon" aria-hidden="true"><Box /></span>}
                    <span><span className="mono">{asset.name}</span><GroupTag group={releaseGroup(asset)} /></span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {weak.length ? (
            <div>
              <h3>Weak resemblances <span className="mono num">{weak.length} at {weakRange}</span></h3>
              <p>Leads for a person to check.</p>
              <ul className="route-weak">
                {weak.map((asset) => (
                  <li key={asset.id}>
                    <span className="route-weak-pct num">{similarity(asset)}%</span>
                    <span className="mono">{asset.name}</span>
                    <span className="route-weak-method">{primaryMatch(asset)?.method}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <p className="route-note"><ShieldCheck aria-hidden="true" />A match is a lead for a person to review, never proof of copying.</p>
      </div>
      <GroupList assets={assets} group="review" title="Needs a person to review" actions={actions} />
      <div className="route-trail">
        <img src={RIG_POSTER_URL} alt="Joint diagram of the RobotExpressive animation rig" width={64} height={73} loading="lazy" />
        <div>
          <p>Animations follow their own trail: two Roblox animation IDs in, one motion fingerprint out.</p>
          <span className="route-trail-links">
            <button className="route-link" type="button" onClick={onOpenMotion}><GitBranch aria-hidden="true" />Compare two Roblox animations</button>
            <a className="route-link quiet" href="#product">See the live rig below</a>
          </span>
        </div>
      </div>
      <footer className="route-card-foot"><StepFoot station={station} /></footer>
    </>
  );
}

function ExceptionsCard({ station, here, assets, counts, actions, onResolve }: { station: Station; here: boolean; assets: readonly AssetRecord[]; counts: ReleaseCounts; actions: FileActions; onResolve: () => void }) {
  const order: ReleaseGroup[] = ['blocked', 'review', 'clear', 'excluded'];
  const blockers = assetsInGroup(assets, 'blocked');
  const ownerless = blockers.filter((asset) => asset.owner === 'Unassigned').length;
  const stillInReview = counts.review ? ` The ${plural(counts.review, 'file', 'files')} that need review ${counts.review === 1 ? 'is' : 'are'} still open in station 02.` : '';
  const lead = blockers.length
    ? <><b>Start with the {plural(blockers.length, 'blocker', 'blockers')}.</b> {ownerless === blockers.length ? (blockers.length === 1 ? 'It has no owner yet.' : 'None of them has an owner yet.') : ownerless ? `${ownerless} of them ${ownerless === 1 ? 'has' : 'have'} no owner yet.` : 'Each one has an owner.'}{stillInReview}</>
    : <>No file is blocked.{stillInReview}</>;
  const tally = `${counts.total} files: ${counts.blocked} blocked, ${counts.review} need review, ${counts.clear} approved${counts.excluded ? `, ${counts.excluded} excluded` : ''}`;
  return (
    <>
      <div className="route-art">
        <div className="route-tally" role="img" aria-label={tally}>
          {order.flatMap((group) => assetsInGroup(assets, group).map((asset) => {
            const { Icon } = GROUP[group];
            return <span key={asset.id} className={`tone-${group}`}><Icon aria-hidden="true" /></span>;
          }))}
        </div>
        <p className="route-tally-key num" aria-hidden="true">
          {order.filter((group) => group !== 'excluded' || counts.excluded).map((group) => {
            const { Icon } = GROUP[group];
            const word = group === 'review' ? 'need review' : GROUP[group].label.toLowerCase();
            return <span key={group}><span className={`tone-${group}`}><Icon /></span>{counts[group]} {word}</span>;
          })}
        </p>
      </div>
      <CardHead station={station} here={here} />
      <p className="route-card-lead">{lead}</p>
      <GroupList assets={assets} group="blocked" actions={actions} />
      <footer className="route-card-foot">
        {counts.unresolved ? <button className="button button-primary" type="button" onClick={onResolve}><FileCheck2 size={16} aria-hidden="true" />Resolve sample exceptions</button> : null}
        <StepFoot station={station} />
      </footer>
    </>
  );
}

function ExportCard({ station, here, assets, counts, actions, onExport }: { station: Station; here: boolean; assets: readonly AssetRecord[]; counts: ReleaseCounts; actions: FileActions; onExport: () => void }) {
  return (
    <>
      <CardHead station={station} here={here} />
      <div className="route-card-body">
        <p id="export-reason">
          {counts.ready
            ? 'Every file is decided. The manifest is ready.'
            : <>Export unlocks when every file is decided. <b>{plural(counts.unresolved, 'file is', 'files are')} still open.</b></>}
        </p>
        <p className="route-actions">
          <button
            className={`button ${counts.ready ? 'button-primary' : 'button-secondary route-locked'}`}
            type="button"
            aria-disabled={!counts.ready}
            aria-describedby="export-reason"
            onClick={counts.ready ? onExport : undefined}
          >
            {counts.ready ? <ArrowDownToLine size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}Export release manifest
          </button>
        </p>
      </div>
      <GroupList assets={assets} group="clear" title="Ready for the manifest" actions={actions} />
      <GroupList assets={assets} group="excluded" title="Left out of this release" actions={actions} />
      <footer className="route-card-foot">
        <span className="route-links">
          <a href={MANIFEST_URL} download="creatorflow-real-assets-manifest.json"><ArrowDownToLine aria-hidden="true" />Download generated manifest</a>
          <a href={SCHEMA_URL} download="creatorflow-manifest-v0.1.schema.json"><ArrowDownToLine aria-hidden="true" />JSON Schema</a>
        </span>
        <StepFoot station={station} />
      </footer>
    </>
  );
}

// ------------------------------------------------------------------------------- the four views

interface ResultViewProps {
  assets: readonly AssetRecord[];
  counts: ReleaseCounts;
  stations: Station[];
  current: number;
  actions: FileActions;
  onRescan: () => void;
  onResolve: () => void;
  onExport: () => void;
  onOpenMotion: () => void;
}

function ResultView({ assets, counts, stations, current, actions, onRescan, onResolve, onExport, onOpenMotion }: ResultViewProps) {
  const [scan, evidence, exceptions, exporting] = stations;
  const investigatingIn = (group: ReleaseGroup) => assets.some((asset) => asset.id === actions.investigatingId && releaseGroup(asset) === group);
  return (
    <>
      <Verdict counts={counts} stations={stations} current={current} onOpenMotion={onOpenMotion} />
      <ol className="route-stops">
        <Stop station={scan} index={0} here={current === 0}><ScanCard station={scan} here={current === 0} assets={assets} onRescan={onRescan} /></Stop>
        <Stop station={evidence} index={1} here={current === 1} wide={investigatingIn('review')}>
          <EvidenceCard station={evidence} here={current === 1} assets={assets} actions={actions} onOpenMotion={onOpenMotion} />
        </Stop>
        <Stop station={exceptions} index={2} here={current === 2} wide>
          <ExceptionsCard station={exceptions} here={current === 2} assets={assets} counts={counts} actions={actions} onResolve={onResolve} />
        </Stop>
        <Stop station={exporting} index={3} here={current === 3} wide={investigatingIn('clear') || investigatingIn('excluded')}>
          <ExportCard station={exporting} here={current === 3} assets={assets} counts={counts} actions={actions} onExport={onExport} />
        </Stop>
      </ol>
    </>
  );
}

function QuietCard({ station, here, children }: { station: Station; here: boolean; children?: ReactNode }) {
  return (
    <>
      <CardHead station={station} here={here} />
      <div className="route-card-body">{children}</div>
    </>
  );
}

function PendingVerdict({ tone, label, headline, lede, children }: { tone: ReleaseGroup | 'neutral'; label: string; headline: ReactNode; lede: string; children?: ReactNode }) {
  return (
    <div className="route-stop route-top">
      <div className="route-lane"><span className={`route-marker tone-${tone}`} data-route-point><SurveyMarker /></span></div>
      <section className="route-verdict" aria-labelledby="verdict-title">
        <p className="route-label">{label}</p>
        <h1 id="verdict-title">{headline}</h1>
        <p className="route-lede">{lede}</p>
        {children}
      </section>
    </div>
  );
}

const VERDICT_LABEL = `Verdict · ${SAMPLE_RELEASE.projectName} release ${SAMPLE_RELEASE.shortRelease} · sample data`;

/** Before the scan: no verdict, and the route starts at station 01. */
export function IdleView({ stations, total, onStart }: { stations: Station[]; total: number; onStart: () => void }) {
  const [scan, ...rest] = stations;
  return (
    <>
      <PendingVerdict tone="neutral" label={VERDICT_LABEL} headline="No verdict yet." lede={`The route starts with a local scan of ${total} prepared sample files. Nothing uploads.`} />
      <ol className="route-stops">
        <Stop station={scan} index={0} here>
          <CardHead station={scan} here />
          <div className="route-state">
            <p>Project selected. No preflight yet. {total} prepared sample files in {SAMPLE_RELEASE.projectName} {SAMPLE_RELEASE.shortRelease}, ready to scan.</p>
            <button className="button button-primary" type="button" onClick={onStart}><ScanSearch size={16} aria-hidden="true" />Start local scan</button>
          </div>
          <footer className="route-card-foot"><StepFoot station={scan} /></footer>
        </Stop>
        {rest.map((station, index) => (
          <Stop key={station.id} station={station} index={index + 1} here={false}>
            <QuietCard station={station} here={false}>{station.id === 'export' ? <p className="route-note flush"><Lock aria-hidden="true" />Export unlocks when every file is decided.</p> : null}</QuietCard>
          </Stop>
        ))}
      </ol>
    </>
  );
}

/** While the simulated scan runs: the route's own shape in skeleton blocks, so nothing jumps when it lands. */
export function ScanningView({ stations, progress }: { stations: Station[]; progress: number }) {
  const step = Math.min(SCAN_STEPS.length - 1, Math.floor(progress / 21));
  const heights = [300, 560, 920, 280];
  return (
    <>
      <div className="route-stop route-top">
        <div className="route-lane"><span className="route-marker tone-neutral" data-route-point><SurveyMarker /></span></div>
        <section className="route-verdict" aria-labelledby="verdict-title" aria-busy="true">
          <p className="route-label">{VERDICT_LABEL}</p>
          <h1 id="verdict-title" className="route-scanning-title">Scanning the sample…</h1>
          <p className="route-lede">Simulated walkthrough · step {step + 1} of {SCAN_STEPS.length}: {SCAN_STEPS[step]}. The findings were prepared in advance.</p>
          <div className="route-progress" role="progressbar" aria-label="Simulated scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="route-skeleton" style={{ width: 'min(520px, 100%)', height: 30, marginTop: 24 }} />
        </section>
      </div>
      <ol className="route-stops" aria-hidden="true">
        {stations.map((station, index) => (
          <li key={station.id} className="route-stop" style={{ '--route-dx': `${NODE_OFFSET[index]}px` } as CSSProperties}>
            <div className="route-lane"><span className="route-node state-skeleton" data-route-point /></div>
            <div className={`route-card${index === 2 ? ' wide' : ''}`} style={{ height: heights[index] }}>
              <div className="route-art"><div className="route-skeleton" style={{ height: 40 }} /></div>
              <div className="route-card-body">
                {['120px', '60%', '90%', '75%'].map((width) => <div key={width} className="route-skeleton" style={{ width, height: 14, marginTop: 12 }} />)}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/** When the result could not be drawn: say so, keep the route's shape, and offer a fresh start. */
export function FailedView({ stations, onRetry }: { stations: Station[]; onRetry: () => void }) {
  const [scan, ...rest] = stations;
  return (
    <>
      <PendingVerdict
        tone="blocked"
        label={VERDICT_LABEL}
        headline={<span className="route-verdict-word tone-blocked"><TriangleAlert aria-hidden="true" />No verdict.</span>}
        lede="The sample check stopped before it reached a verdict. Nothing was uploaded."
      />
      <ol className="route-stops">
        <Stop station={scan} index={0} here>
          <CardHead station={scan} here />
          <div className="route-state error" role="alert">
            <h3><TriangleAlert aria-hidden="true" />The check could not finish</h3>
            <p>Something went wrong while drawing the sample results. Running the check again starts from the prepared sample.</p>
            <button className="button button-primary" type="button" onClick={onRetry}><RotateCcw size={16} aria-hidden="true" />Run the check again</button>
          </div>
          <footer className="route-card-foot"><StepFoot station={scan} /></footer>
        </Stop>
        {rest.map((station, index) => (
          <Stop key={station.id} station={station} index={index + 1} here={false}><QuietCard station={station} here={false} /></Stop>
        ))}
      </ol>
    </>
  );
}

/** Catches a render error in the result so the page shows the failed route instead of going blank. */
class ResultBoundary extends Component<{ fallback: (retry: () => void) => ReactNode; onFail: () => void; onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('The release route could not render its result.', error, info.componentStack);
    this.props.onFail();
  }

  private retry = () => {
    this.props.onRetry();
    this.setState({ failed: false });
  };

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

// ------------------------------------------------------------------------------- layout cells

interface Size {
  width: number;
  height: number;
}

/** The survey's measured size, updated only when it actually changes. */
function useElementSize(ref: React.RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.target.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Bumps once the web fonts have loaded, because text reflow moves the station nodes. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;
    void fonts.ready.then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready;
}

const samePoints = (a: readonly Point[], b: readonly Point[]) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

// ------------------------------------------------------------------------------- the page

export function ReleaseRoute({ onOpenWorkspace, initialPhase = 'complete', children }: ReleaseRouteProps) {
  const reduceMotion = useReducedMotion();
  const [assets, setAssets] = useState<AssetRecord[]>(initialAssets);
  const [phase, setPhase] = useState<Exclude<ScanPhase, 'failed'>>(initialPhase);
  const [progress, setProgress] = useState(initialPhase === 'complete' ? 100 : 0);
  const [openId, setOpenId] = useState<string | null>(() => firstBlockedId(initialAssets));
  const [investigatingId, setInvestigatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);

  const counts = useMemo(() => releaseCounts(assets), [assets]);
  const shownPhase: ScanPhase = failed ? 'failed' : phase;
  const stations = useMemo(() => routeStations(shownPhase, counts), [shownPhase, counts]);
  const current = phase === 'complete' && !failed ? currentStationIndex(stations) : 0;
  const walkedTo = walkedThrough(shownPhase, current);

  const resetSample = useCallback(() => {
    setAssets(initialAssets);
    setOpenId(firstBlockedId(initialAssets));
    setInvestigatingId(null);
    setFailed(false);
  }, []);

  const startScan = useCallback(() => {
    resetSample();
    setNotice('');
    setProgress(0);
    setPhase('scanning');
  }, [resetSample]);

  useEffect(() => {
    if (phase !== 'scanning') return;
    if (reduceMotion) {
      setProgress(100);
      setPhase('complete');
      setNotice('Sample scan finished.');
      return;
    }
    let done: number | undefined;
    const timer = window.setInterval(() => {
      setProgress((value) => {
        const next = Math.min(100, value + SCAN_STEP_PERCENT);
        if (next === 100 && done === undefined) {
          window.clearInterval(timer);
          done = window.setTimeout(() => { setPhase('complete'); setNotice('Sample scan finished.'); }, 180);
        }
        return next;
      });
    }, SCAN_TICK_MS);
    return () => { window.clearInterval(timer); if (done !== undefined) window.clearTimeout(done); };
  }, [phase, reduceMotion]);

  const actions: FileActions = {
    openId,
    investigatingId,
    onToggle: (id) => setOpenId((value) => (value === id ? null : id)),
    onRecordLicense: (asset) => { setAssets((value) => recordLicense(value, asset.id)); setNotice(`License record attached to ${asset.name}.`); },
    onExclude: (asset) => { setAssets((value) => excludeFromRelease(value, asset.id)); setNotice(`${asset.name} excluded from ${SAMPLE_RELEASE.projectName} ${SAMPLE_RELEASE.shortRelease}.`); },
    onInvestigate: (asset) => {
      setInvestigatingId((value) => (value === asset.id ? null : asset.id));
      setNotice(`Opened ${plural(asset.matches?.length ?? 0, 'matching source record', 'matching source records')} for ${asset.name}.`);
    },
    onCloseInvestigation: () => setInvestigatingId(null),
    onUseSource: (match) => {
      const asset = assets.find((item) => item.id === investigatingId);
      if (!asset) return;
      setAssets((value) => attachSourceRecord(value, asset.id, match));
      setInvestigatingId(null);
      setNotice(`${match.title} attached to ${asset.name}; required credit added to the release record.`);
    },
  };

  function resolveExceptions() {
    setAssets((value) => applyPreparedResolutions(value));
    setNotice('Prepared resolutions applied: two CC0 source records attached and two unverified assets excluded from this release.');
  }

  function exportManifest() {
    if (!counts.ready) return;
    const manifest = buildReleaseManifest(assets, { projectName: SAMPLE_RELEASE.projectName, release: SAMPLE_RELEASE.release, generatedAt: new Date().toISOString() });
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = SAMPLE_RELEASE.manifestFileName;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Creative asset manifest exported for ${SAMPLE_RELEASE.projectName} ${SAMPLE_RELEASE.shortRelease}.`);
  }

  // Layout: the survey's size and the station nodes' centres drive the contours and the route.
  const surveyRef = useRef<HTMLElement>(null);
  const size = useElementSize(surveyRef);
  const fontsReady = useFontsReady();
  const [points, setPoints] = useState<Point[]>([]);
  const [swing, setSwing] = useState(0);

  useLayoutEffect(() => {
    const survey = surveyRef.current;
    if (!survey) return;
    const box = survey.getBoundingClientRect();
    const next = [...survey.querySelectorAll<HTMLElement>('[data-route-point]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.left - box.left + rect.width / 2), y: Math.round(rect.top - box.top + rect.height / 2) };
    });
    setPoints((value) => (samePoints(value, next) ? value : next));
    const lane = parseFloat(getComputedStyle(survey).getPropertyValue('--route-lane')) || 0;
    setSwing(lane * 0.2);
  }, [size, fontsReady, shownPhase, assets, openId, investigatingId]);

  const terrainHeight = Math.ceil(size.height / TERRAIN_BAND) * TERRAIN_BAND;
  const terrainStep = size.width < 760 ? 10 : 12;
  const terrain = useMemo(() => contourPaths(size.width, terrainHeight, terrainStep), [size.width, terrainHeight, terrainStep]);
  const route = useMemo(() => routePaths(points, walkedTo, swing), [points, walkedTo, swing]);

  const failedStations = routeStations('failed', counts);
  const retry = () => { resetSample(); setPhase('complete'); setProgress(100); };

  return (
    <div id="top" className="route-page">
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="route-bar">
        <a href="#top" className="brand-link" aria-label="CreatorFlow home"><BrandMark /></a>
        <span className="route-crumb"><span aria-hidden="true">/</span><b>{SAMPLE_RELEASE.projectName}</b><span>Release {SAMPLE_RELEASE.shortRelease}</span><span className="route-tag-box">Sample data</span></span>
        <div className="route-bar-actions">
          <button className="button route-ghost" type="button" aria-label="Compare two Roblox animations" onClick={() => onOpenWorkspace('motion')}><Fingerprint size={16} aria-hidden="true" /><span className="route-long">Compare animations</span></button>
          <button className="button button-secondary" type="button" onClick={() => onOpenWorkspace('overview')}>Open workspace</button>
        </div>
      </header>
      <main id="main" className="route-survey" ref={surveyRef} tabIndex={-1}>
        <svg className="route-terrain" width={size.width} height={terrainHeight} viewBox={`0 0 ${size.width || 1} ${terrainHeight || 1}`} aria-hidden="true" focusable="false">
          <path className="minor" d={terrain.minor} />
          <path className="major" d={terrain.major} />
        </svg>
        <svg className="route-line" width={size.width} height={size.height} viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} aria-hidden="true" focusable="false">
          <path className="ahead" d={route.ahead} />
          <path className="walked" d={route.walked} />
        </svg>
        <div className="route-inner">
          {phase === 'idle' && !failed ? <IdleView stations={stations} total={assets.length} onStart={startScan} /> : null}
          {phase === 'scanning' && !failed ? <ScanningView stations={stations} progress={progress} /> : null}
          {phase === 'complete' ? (
            <ResultBoundary onFail={() => setFailed(true)} onRetry={retry} fallback={(again) => <FailedView stations={failedStations} onRetry={again} />}>
              <ResultView
                assets={assets}
                counts={counts}
                stations={stations}
                current={current}
                actions={actions}
                onRescan={startScan}
                onResolve={resolveExceptions}
                onExport={exportManifest}
                onOpenMotion={() => onOpenWorkspace('motion')}
              />
            </ResultBoundary>
          ) : null}
          {children}
        </div>
        <div className="sr-only" aria-live="polite">{notice}</div>
      </main>
      <footer className="route-footer">
        <div>
          <p><b>Detection proves conflicts, never originality.</b> A clear result means no conflict was found in the registries we checked. Ownership still comes from licenses, declarations, and provenance. Files stay on this machine; fingerprints and decisions travel.</p>
          <a href="https://github.com/Bryancruzcb/creatorflow" target="_blank" rel="noreferrer">View the Java engine on GitHub <ArrowRight size={14} aria-hidden="true" /></a>
        </div>
      </footer>
    </div>
  );
}
