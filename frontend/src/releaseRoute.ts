import type { AssetRecord, SourceMatch } from './data';
import { workflowSteps } from './data';

/**
 * The release route's rules, as calculations over the sample's asset records.
 *
 * The landing page draws the release as a route with four stations, and the workspace's sample
 * preflight shows the same release as a ledger with a release bar. Both used to count inline in
 * `PreflightWorkspace.tsx`. The counts now come from here, so the route's station words, the
 * verdict and the release bar cannot disagree. Everything in this file is a calculation: same
 * input, same output, no effect. The components hold the state and call these.
 */

/** The sample release both the landing page and the workspace sample show. */
export const SAMPLE_RELEASE = {
  projectName: 'Northwind',
  /** The release as the manifest records it. */
  release: '1.2.0',
  /** The release as the page names it. */
  shortRelease: '1.2',
  manifestFileName: 'northwind-1.2-creative-manifest.json',
} as const;

/** The five steps the simulated sample scan walks through, in order. */
export const SCAN_STEPS = [
  'Indexing project files',
  'Computing exact hashes',
  'Comparing visual signatures',
  'Inspecting audio fingerprints',
  'Checking license records',
] as const;

/** Where one file stands in the release. Every file is in exactly one group. */
export type ReleaseGroup = 'blocked' | 'review' | 'clear' | 'excluded';

type Decided = Pick<AssetRecord, 'status' | 'decision'>;

/**
 * A human decision outranks the automated status: an approved file is clear and an excluded
 * file is out of the release, whatever the scan found. Undecided files keep the scan's word,
 * and an undecided file the scan did not block still needs a person to look at it.
 */
export function releaseGroup(asset: Decided): ReleaseGroup {
  if (asset.decision === 'approved') return 'clear';
  if (asset.decision === 'excluded') return 'excluded';
  if (asset.status === 'blocked') return 'blocked';
  return 'review';
}

export interface ReleaseCounts {
  blocked: number;
  review: number;
  clear: number;
  excluded: number;
  /** Files whose decision is still blocked, pending or needs-review. */
  unresolved: number;
  total: number;
  /** Export unlocks only when no file is unresolved. */
  ready: boolean;
}

const UNRESOLVED: ReadonlySet<AssetRecord['decision']> = new Set(['blocked', 'pending', 'needs-review']);

/**
 * The counting rules the release bar has always used, with one correction: an excluded file no
 * longer counts as "needs review". It used to, so excluding a file under review left the bar
 * saying the same number still needed review while the export count had already dropped it.
 */
export function releaseCounts(assets: readonly Decided[]): ReleaseCounts {
  const count = (group: ReleaseGroup) => assets.filter((asset) => releaseGroup(asset) === group).length;
  const unresolved = assets.filter((asset) => UNRESOLVED.has(asset.decision)).length;
  return {
    blocked: count('blocked'),
    review: count('review'),
    clear: count('clear'),
    excluded: count('excluded'),
    unresolved,
    total: assets.length,
    ready: unresolved === 0,
  };
}

export function assetsInGroup<T extends Decided>(assets: readonly T[], group: ReleaseGroup): T[] {
  return assets.filter((asset) => releaseGroup(asset) === group);
}

/** Where the sample scan is. `failed` is what the route shows when it cannot render a result. */
export type ScanPhase = 'idle' | 'scanning' | 'complete' | 'failed';

export type StationId = 'scan' | 'evidence' | 'exceptions' | 'export';

export type StationState =
  | 'done'
  | 'review'
  | 'open'
  | 'ready'
  | 'locked'
  | 'next'
  | 'running'
  | 'waiting'
  | 'failed';

export interface Station {
  id: StationId;
  /** "01" to "04". */
  number: string;
  /** Short name for the route summary. */
  name: string;
  /** The workflow step this station is. */
  title: string;
  state: StationState;
  /** The state in words, always shown beside its icon. */
  word: string;
}

const STATION_NAMES: readonly { id: StationId; name: string }[] = [
  { id: 'scan', name: 'Scan' },
  { id: 'evidence', name: 'Evidence' },
  { id: 'exceptions', name: 'Exceptions' },
  { id: 'export', name: 'Export' },
];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function stationState(index: number, phase: ScanPhase, counts: ReleaseCounts): Pick<Station, 'state' | 'word'> {
  if (index === 3 && phase !== 'complete') return { state: 'locked', word: 'Locked' };
  if (phase === 'idle') return index === 0 ? { state: 'next', word: 'Not run yet' } : { state: 'waiting', word: 'After the scan' };
  if (phase === 'scanning') return index === 0 ? { state: 'running', word: 'Scanning' } : { state: 'waiting', word: 'After the scan' };
  if (phase === 'failed') return index === 0 ? { state: 'failed', word: 'Stopped' } : { state: 'waiting', word: 'Waits for the scan' };
  if (index === 0) return { state: 'done', word: 'Done' };
  if (index === 1) return counts.review > 0 ? { state: 'review', word: plural(counts.review, 'needs review', 'need review') } : { state: 'done', word: 'Done' };
  if (index === 2) return counts.blocked > 0 ? { state: 'open', word: `${counts.blocked} blocked` } : { state: 'done', word: 'Done' };
  return counts.ready ? { state: 'ready', word: 'Ready' } : { state: 'locked', word: 'Locked' };
}

/**
 * The four stations of the route, Scan → Evidence → Exceptions → Export, each with a state that
 * follows from the counts. A station is "Done" only when nothing in it is open: Evidence while any
 * file needs review, Exceptions while any file is blocked, and Export stays locked until every
 * file has a decision (the same rule that enables the export button).
 */
export function routeStations(phase: ScanPhase, counts: ReleaseCounts): Station[] {
  return STATION_NAMES.map((meta, index) => ({
    ...meta,
    number: `0${index + 1}`,
    title: workflowSteps[index].title,
    ...stationState(index, phase, counts),
  }));
}

/** "You are here": the first station that still has open work. Export is never "done", so one always exists. */
export function currentStationIndex(stations: readonly Station[]): number {
  const index = stations.findIndex((station) => station.state !== 'done');
  return index === -1 ? stations.length - 1 : index;
}

/**
 * How far along the route is solid. Route points are the verdict marker (0) then the four
 * stations (1–4). Once the scan has finished, the route is walked up to the current station;
 * before that, nothing is.
 */
export function walkedThrough(phase: ScanPhase, current: number): number {
  return phase === 'complete' ? current + 1 : 0;
}

/**
 * The match a file is judged by: its first source record, which is the one the match workbench
 * opens on. It is deliberately not the highest score — a Khronos file's records end with the
 * team's own import record at 100% ("Exact project SHA-256"), which is the file matching itself in
 * the team archive, not the source it came from.
 */
export function primaryMatch(asset: Pick<AssetRecord, 'matches'>): SourceMatch | undefined {
  return asset.matches?.[0];
}

/** A first record at or above this is shown as a near-exact copy rather than a weak resemblance. */
export const NEAR_EXACT_AT = 90;

export interface EvidenceSplit<T> {
  /** Near-exact copies, in the order the project lists them. */
  near: T[];
  /** Weak resemblances, strongest first. */
  weak: T[];
}

export function evidenceSplit<T extends Pick<AssetRecord, 'matches'>>(assets: readonly T[]): EvidenceSplit<T> {
  const scored = assets.filter((asset) => primaryMatch(asset) !== undefined);
  const similarity = (asset: T) => primaryMatch(asset)?.similarity ?? 0;
  return {
    near: scored.filter((asset) => similarity(asset) >= NEAR_EXACT_AT),
    weak: scored.filter((asset) => similarity(asset) < NEAR_EXACT_AT).sort((a, b) => similarity(b) - similarity(a)),
  };
}

// ---------------------------------------------------------------------------------------------
// Decisions, copy-on-write. Each returns a new array and leaves the one it was given untouched.
// ---------------------------------------------------------------------------------------------

function updateAsset(assets: readonly AssetRecord[], id: string, change: (asset: AssetRecord) => AssetRecord): AssetRecord[] {
  return assets.map((asset) => (asset.id === id ? change(asset) : asset));
}

/** "Attach license record": the file is cleared and approved, with the license recorded. */
export function recordLicense(assets: readonly AssetRecord[], id: string): AssetRecord[] {
  return updateAsset(assets, id, (asset) => ({ ...asset, status: 'clear', decision: 'approved', license: 'License and attribution recorded' }));
}

/** "Exclude from release": the file stays in the project but leaves this build. */
export function excludeFromRelease(assets: readonly AssetRecord[], id: string): AssetRecord[] {
  return updateAsset(assets, id, (asset) => ({ ...asset, decision: 'excluded' }));
}

/** "Use this source" in the match workbench: the source record becomes the file's origin and license. */
export function attachSourceRecord(assets: readonly AssetRecord[], id: string, match: SourceMatch): AssetRecord[] {
  return updateAsset(assets, id, (asset) => ({
    ...asset,
    origin: match.provider,
    license: `${match.license} · source record attached`,
    status: 'clear',
    decision: 'approved',
  }));
}

/**
 * "Resolve sample exceptions": the sample's prepared answers. Two CC0 source records are
 * attached, and two files with no license are excluded from this release.
 */
export function applyPreparedResolutions(assets: readonly AssetRecord[]): AssetRecord[] {
  return assets.map((asset) => {
    if (asset.id === 'avocado-prop' || asset.id === 'harbor-fish') {
      return { ...asset, license: 'CC0 1.0 · upstream source record attached', decision: 'approved', status: 'clear' };
    }
    if (asset.id === 'ui-icon-set' || asset.id === 'ambient-loop') {
      return { ...asset, decision: 'excluded' };
    }
    return asset;
  });
}
