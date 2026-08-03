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
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  LocalBridgeClient,
  LocalBridgeError,
  type LocalAssetDetail,
  type LocalDecision,
  type LocalDecisionType,
  type LocalGatePreview,
  type LocalGateViolation,
  type LocalIntendedExperience,
  type LocalOwnershipVerification,
  type OwnershipIdentityType,
  type LocalProjectRecord,
  type LocalProjectSummary,
  type LocalRelease,
  type LocalScanAsset,
  type LocalScanEvent,
  type LocalScanRun,
} from '../bridge/localBridge';
import { decisionBasis, ownershipBasis, ownershipLinkBasis, sourceBasis, verificationBasis, type EvidenceBasis } from '../bridge/evidenceBasis';
import { BatchReviewPanel } from './BatchReviewPanel';
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

/**
 * Which of the three forms stacked in the evidence inspector actually changes a given violation.
 *
 * `OWNERSHIP_MISMATCH_WITHOUT_DECISION` lands on the ownership panel rather than on the decision
 * form even though the decision form is the literal resolver: a person has to read what the
 * mismatch actually says before recording a call about it, and the decision form sits directly
 * below it. Facts first, then the decision.
 */
export type LocalGateAffordance = 'source' | 'decision' | 'ownership';

export interface LocalGateViolationGroup {
  code: string;
  title: string;
  /**
   * What actually clears this kind of violation. Written once per group from the gate's own rules,
   * never computed per row — the workspace does not re-implement a gate rule, and it never claims a
   * specific asset will clear.
   */
  clears: string;
  violations: LocalGateViolation[];
}

/**
 * Groups in `ReleaseGate.Code`'s own declaration order, so the checklist reads in the same order
 * the gate itself evaluates and a reader can trace one to the other.
 */
const gateGroups: Array<Omit<LocalGateViolationGroup, 'violations'>> = [
  {
    code: 'BLOCKED_DECISION',
    title: 'Blocked on purpose',
    clears: 'Someone blocked this file deliberately. Only a new decision on the asset changes it.',
  },
  {
    code: 'UNRESOLVED_SOURCE',
    title: 'Source and license not recorded',
    clears: 'Record both a source and a license. Approving does not clear this — the gate checks the '
      + 'source record independently of the decision.',
  },
  {
    code: 'FLAGGED_WITHOUT_APPROVAL',
    title: 'Flagged, with no approval or exclusion',
    clears: 'A person has to approve or exclude it. A similarity finding is a review lead, not a verdict.',
  },
  {
    code: 'OWNERSHIP_MISMATCH_WITHOUT_DECISION',
    title: 'Ownership mismatch with no resolving decision',
    clears: 'Confirm the team has the right to ship it, then approve or exclude. Needs review does not '
      + 'clear it — that records that the review has not happened.',
  },
];

const otherGateGroup: Omit<LocalGateViolationGroup, 'violations'> = {
  code: 'OTHER',
  title: 'Other gate rules',
  clears: 'This build of the workspace does not know these rules, so the gate’s own message is shown '
    + 'as it came back. They still block the release.',
};

/**
 * Splits a preview's violations into rendered groups, in the gate enum's order, with anything this
 * build does not recognise collected into a final "Other" group.
 *
 * Unknown codes are kept rather than dropped on purpose: dropping one would under-report a block,
 * and under-reporting a block is the direction that ships something. Rows are never merged either —
 * the gate counts violations, not files, and one file can legitimately stand in three groups at
 * once (unresolved source + flagged + ownership mismatch). Pure.
 */
export function groupGateViolations(violations: LocalGateViolation[]): LocalGateViolationGroup[] {
  const known = new Set(gateGroups.map((group) => group.code));
  return [
    ...gateGroups.map((group) => ({ ...group, violations: violations.filter((item) => item.code === group.code) })),
    { ...otherGateGroup, violations: violations.filter((item) => !known.has(item.code)) },
  ].filter((group) => group.violations.length > 0);
}

/**
 * The affordance a violation of this code is resolved through. An unknown code goes to the decision
 * form: it is the only affordance that applies to every asset, and a jump that lands somewhere
 * plausible is better than one that lands nowhere. Pure.
 */
export function affordanceForViolationCode(code: string): LocalGateAffordance {
  if (code === 'UNRESOLVED_SOURCE') return 'source';
  if (code === 'OWNERSHIP_MISMATCH_WITHOUT_DECISION') return 'ownership';
  return 'decision';
}

/**
 * The counter above the checklist.
 *
 * Deliberately not "3 of 7 resolved". The workspace cannot know that anything was resolved — only
 * the gate can, and only on its next run. What it observed is that a person wrote something on an
 * asset after this check was taken, which is *touched*: an asset moved to Needs review is touched
 * and still standing. The standing count never goes down between checks. Pure.
 */
export function gateProgressLabel(standing: number, touched: number): string {
  const base = `${standing} standing`;
  return touched > 0 ? `${base} · ${touched} touched since this check` : base;
}

/**
 * Whether a checklist is describing a scan that is no longer the active one.
 *
 * Only true when both run ids are known and differ — an unknown current run is an unknown, never a
 * staleness claim. It matters because scan assets are per-run and old runs' rows are never deleted:
 * a jump using an old run's asset id would open a real, stale file with nothing to warn a person,
 * and the bridge's own rejection of the accompanying workspace-state save is fire-and-forget, so it
 * would never be seen. The guard therefore runs before the jump, not after. Pure.
 */
export function isGatePreviewStale(preview: LocalGatePreview | null, currentScanRunId: string | null): boolean {
  if (!preview || !currentScanRunId) return false;
  return preview.scanRunId !== currentScanRunId;
}

/** One walkable step of a gate check: a violation that resolved to a real asset in this run. */
export interface LocalGateQueueItem {
  assetId: number;
  affordance: LocalGateAffordance;
  path: string;
  code: string;
}

/**
 * The violations a person can actually be taken to, in the order the checklist renders them.
 *
 * Violations whose path did not resolve to a scan asset are left out — there is nowhere honest to
 * jump — but they are still rendered and still counted; only the walkthrough skips them. Pure.
 */
export function gateResolutionQueue(preview: LocalGatePreview | null): LocalGateQueueItem[] {
  if (!preview) return [];
  return groupGateViolations(preview.violations).flatMap((group) => group.violations
    .filter((violation) => violation.scanAssetId !== null)
    .map((violation) => ({
      assetId: violation.scanAssetId as number,
      affordance: affordanceForViolationCode(violation.code),
      path: violation.path,
      code: violation.code,
    })));
}

/**
 * The disclosure a batched record carries wherever it is read: this judgement was one of N made in
 * one act, and here is the batch it came from.
 *
 * <p>Without it, thirty decisions written by one gesture and thirty written by thirty considered
 * reviews are identical rows in the ledger — which is the thing a batch feature must not do
 * quietly. It is a statement about *how the record was made*, never a verdict about the file, and it
 * never softens or re-words the person's own rationale, which is rendered separately and verbatim.
 *
 * <p>An unknown count stays unknown ("part of a batch") rather than becoming a guessed number: the
 * bridge reports null when it cannot read the batch row, and inventing "1" there would turn a batch
 * into a per-file decision in the reader's eyes. Pure.
 */
export function batchMarkerLabel(batchId: string, assetCount?: number | null): string {
  const scale = typeof assetCount === 'number' && assetCount > 0
    ? `Recorded as part of a ${assetCount}-file batch`
    : 'Recorded as part of a batch';
  return `${scale} · batch ${batchId.slice(0, 8)}`;
}

/**
 * The ids in an append-only decision history that a later record has already superseded.
 *
 * <p>The history renders oldest-first (`DecisionRepository.historyFor` orders `created_at, rowid`
 * ascending), so the first row on screen is the *oldest* one. Without a mark, a reader scanning a
 * ledger surface can take the top entry for the standing decision — which on a file whose call was
 * later reversed is exactly backwards. Superseding is recorded structurally, by a later row naming
 * the one it replaces, so this reads that rather than assuming position means anything. Pure.
 */
export function supersededDecisionIds(history: LocalDecision[]): Set<string> {
  return new Set(history
    .map((entry) => entry.supersedesDecisionId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0));
}

/**
 * A decision's timestamp as a fixed, locale-independent `YYYY-MM-DD HH:MM UTC`.
 *
 * <p>Deliberately not `toLocaleString`: these are ledger rows, they are compared with each other far
 * more often than they are read as prose, and a stamp that changes shape with the reader's locale is
 * worse for both. The zone is named rather than converted, because an unlabelled wall-clock time is
 * read as local and these are stored in UTC. Anything unparseable is reported as unknown rather than
 * rendered as "Invalid Date". Pure.
 */
export function formatDecisionTimestamp(createdAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(createdAt);
  return match ? `${match[1]} ${match[2]} UTC` : 'time not recorded';
}

export type ParsedRobloxAssetId =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Pure validation for the "Roblox animation asset ID" field a person types before verifying
 * ownership: a positive integer. Extracted so it is unit-testable without a DOM/render harness
 * (mirrors {@link parsePublishedPlaceVersionInput}).
 */
export function parseRobloxAssetIdInput(input: string): ParsedRobloxAssetId {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: 'Roblox animation asset ID must be a positive whole number.' };
  }
  return { ok: true, value };
}

export type OwnershipDisplayTone = 'match' | 'review-lead' | 'unverifiable';

export interface OwnershipDisplay {
  basis: EvidenceBasis;
  /**
   * The basis for the file-to-animation linkage — always `DECLARED` for a real verification, never
   * `VERIFIED`. Kept separate from {@link OwnershipDisplay.basis} (the ownership facts) on purpose.
   */
  linkBasis: EvidenceBasis;
  tone: OwnershipDisplayTone;
  headline: string;
  detail: string;
  /** Plain-language statement of what the person declared and what was actually checked. */
  linkage: string;
  /** True only for a MISMATCH — the one outcome that asks a person to make a call. */
  isReviewLead: boolean;
}

/**
 * The decision-aware tail of a MISMATCH review lead. The panel must never claim "no decision is on
 * record" when one is — that misreads a file a person already ruled on, and it is the sentence the
 * gate would contradict. Mirrors `ReleaseGate`'s rule that only APPROVED (or EXCLUDED, which leaves
 * the file out of releases entirely) resolves an ownership lead: NEEDS_REVIEW is a person recording
 * that review has *not* happened, so the lead keeps standing. Pure.
 */
function mismatchDecisionCopy(latestDecision: LocalDecision | null): string {
  switch (latestDecision?.type) {
    case 'APPROVED':
      return 'A person has already recorded an Approved decision for this file, which is what clears this lead '
        + 'for the release gate — that is their call about the team’s rights, not something CreatorFlow checked.';
    case 'NEEDS_REVIEW':
      return 'This file is marked Needs review, which records that the review has not happened yet, so the lead '
        + 'still stands. Approve or exclude it once a person has confirmed the team can ship it.';
    case 'BLOCKED':
      return 'This file already carries a Blocked decision, so it will not ship in a release.';
    case 'EXCLUDED':
      return 'This file is marked Excluded, so releases leave it out.';
    default:
      return 'No decision is on record. Record one below once you have checked.';
  }
}

/**
 * Turns one persisted ownership verification into honest display copy. Pure — no DOM. Load-bearing
 * honesty: a MATCH is positive evidence (VERIFIED = "we obtained the facts", never "you have the
 * right to use this"); a MISMATCH is a *review lead* for a human, worded without accusation (never
 * "infringement"/"stolen"); an UNVERIFIABLE stays NOT_VERIFIED — an honest "could not check", never
 * a false verified. The basis mirrors {@link ownershipBasis} so this UI and the export classifier
 * never diverge.
 *
 * Load-bearing honesty #2: every outcome is about the animation ID **a person typed in**. Nothing in
 * a scanned file identifies a Roblox asset, so `linkage`/`linkBasis` say out loud that the
 * file-to-animation claim is the user's (DECLARED), and every headline and detail speaks about that
 * ID rather than about the file. A verified fact about a declared ID is not a verified fact about
 * the file, and this copy must never let the two read as one.
 *
 * `latestDecision` is required rather than defaulted, because the wrong default is exactly the bug:
 * a MISMATCH lead that assumes "no decision is on record" would overwrite a call a person already
 * made. Pass the asset's latest append-only decision, or an explicit `null` when there is none.
 */
export function describeOwnershipOutcome(
  verification: LocalOwnershipVerification,
  latestDecision: LocalDecision | null,
): OwnershipDisplay {
  const basis = ownershipBasis(verification);
  const linkBasis = ownershipLinkBasis(verification);
  const linkage = `You entered animation ID ${verification.robloxAssetId} for this file. CreatorFlow checked `
    + 'who owns that animation on Roblox — it cannot check that this file is that animation, so the link '
    + 'between them stays your declaration.';
  switch (verification.outcome) {
    case 'MATCH':
      return {
        basis,
        linkBasis,
        linkage,
        tone: 'match',
        isReviewLead: false,
        headline: 'Creator matches the experience owner',
        detail: 'Roblox confirms the creator of the animation ID you entered is the owner of this project’s bound '
          + 'experience. That is who created that animation and who owns the experience — not proof that this file '
          + 'is that animation, and not your right to use it.',
      };
    case 'MISMATCH':
      return {
        basis,
        linkBasis,
        linkage,
        tone: 'review-lead',
        isReviewLead: true,
        headline: 'Review lead: creator is not the experience owner',
        detail: 'Roblox reports the creator of the animation ID you entered is not the owner of this project’s bound '
          + 'experience. This is a lead for a person to confirm the team has the right to ship it — not an '
          + `accusation. ${mismatchDecisionCopy(latestDecision)}`,
      };
    default:
      return {
        basis,
        linkBasis,
        linkage,
        tone: 'unverifiable',
        isReviewLead: false,
        headline: 'Could not verify ownership',
        detail: 'CreatorFlow could not obtain the ownership facts from Roblox for the animation ID you entered, so '
          + 'ownership stays not verified. The asset id may not exist or may not be readable with the configured key.',
      };
  }
}

/**
 * Point-in-time staleness phrasing for a verification's `checkedAt`. Pure and deterministic given
 * `now` (so it is unit-testable): "checked today" / "checked yesterday" / "checked N days ago". A
 * future/clock-skewed stamp is clamped to "today" rather than reporting a negative age.
 */
export function formatCheckedAt(checkedAt: string, now: Date = new Date()): string {
  const then = Date.parse(checkedAt);
  if (Number.isNaN(then)) return 'checked at an unknown time';
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days <= 0) return 'checked today';
  if (days === 1) return 'checked yesterday';
  return `checked ${days} days ago`;
}

export type OwnershipVerifyErrorKind = 'no-key' | 'rate-limited' | 'not-applicable' | 'error';

/**
 * How long to wait before retrying, in words, from a 429's server-reported `retryAfterSeconds`.
 * `null` — the bridge reported no Retry-After — stays the honestly vague "in a moment" rather than
 * an invented countdown, and so does a zero/negative/non-finite value the UI cannot use. A
 * fractional wait rounds *up*, so nobody is told to retry sooner than the server asked. Pure.
 */
export function formatRetryAfter(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) return 'in a moment';
  const seconds = Math.ceil(retryAfterSeconds);
  if (seconds < 60) return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Maps a failed verify-ownership request to the honest state the UI must show. 409 → the key is not
 * configured (point at the desktop Settings card); 429 → rate-limited, surfaced *distinctly* so a
 * transient throttle is not mistaken for a hard failure, and carrying the server-reported wait when
 * there is one (an unreported wait stays "in a moment" — never an invented countdown); 404 → the
 * asset lacks an animation id or a bound experience (carry the server's own message); anything else
 * → a generic error. Pure.
 */
export function ownershipVerifyError(error: unknown): { kind: OwnershipVerifyErrorKind; message: string } {
  const bridgeError = error instanceof LocalBridgeError ? error : null;
  const status = bridgeError?.status ?? null;
  if (status === 409) {
    return { kind: 'no-key', message: 'Add a Roblox Open Cloud API key in the desktop Settings card, then verify ownership again.' };
  }
  if (status === 429) {
    return {
      kind: 'rate-limited',
      message: `Roblox Open Cloud is rate-limited, try again ${formatRetryAfter(bridgeError?.retryAfterSeconds ?? null)}.`,
    };
  }
  if (status === 404) {
    return { kind: 'not-applicable', message: error instanceof Error && error.message ? error.message : 'This asset cannot be verified: it needs an animation id and a bound experience.' };
  }
  return { kind: 'error', message: error instanceof Error && error.message ? error.message : 'Could not verify ownership.' };
}

/**
 * The reason the verify action is unavailable, or `null` when it is ready. Ownership is checked
 * against the bound experience's owner, so an experience must be declared first; nothing can be
 * checked at all without an Open Cloud key; and a Roblox animation asset id must be entered. Pure.
 *
 * `openCloudKeyConfigured` is the desktop's own boolean answer (never the key, never a prefix), and
 * its third state is load-bearing: `null` means the bridge did not report a key status, so the UI
 * must not assert one — the action stays available and the post-click 409 answers honestly. Only an
 * explicit `false` disables, which is what the friend test asks for: a clear reason up front rather
 * than a failure discovered after the click.
 */
export function ownershipVerifyDisabledReason(
  robloxAssetIdInput: string,
  experienceBound: boolean,
  openCloudKeyConfigured: boolean | null,
): string | null {
  if (!experienceBound) {
    return 'Bind this project’s intended Roblox experience first — ownership is checked against its owner.';
  }
  if (openCloudKeyConfigured === false) {
    return 'Add a Roblox Open Cloud API key in the desktop Settings card first — without one CreatorFlow has nothing to ask Roblox with.';
  }
  if (!parseRobloxAssetIdInput(robloxAssetIdInput).ok) {
    return 'Enter the Roblox animation asset ID to verify its creator.';
  }
  return null;
}

/** Renders an identity fact honestly: "User 123" when obtained, "Not obtained" when the check could not get it. */
function formatOwnershipIdentity(type: OwnershipIdentityType | null, id: number | null): string {
  return type && id !== null ? `${titleCaseManifestValue(type)} ${id}` : 'Not obtained';
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

/**
 * The per-animation ownership-verification panel. Renders the honest verdict for the latest
 * verification (VERIFIED facts for a match/mismatch; a mismatch is framed as a review lead needing a
 * human decision, never an accusation) with its point-in-time `checkedAt`, and a form to run a new
 * check against Roblox Open Cloud. Failure modes are surfaced distinctly: no key → point at the
 * desktop Settings card; rate-limited → "rate-limited, try again" with the server-reported wait when
 * there is one; missing id/experience → the server's precondition message. The live call happens
 * only when a person clicks Verify.
 *
 * The no-key case is answered *before* the click when the bridge reports its key status (a boolean
 * only, never the key) — seeded from the connect-time session and re-read on open, because the key
 * is configured in the desktop app and can appear while this page is up. Only an explicit `false`
 * disables; an unknown status leaves the action available and lets the 409 answer. `latestDecision`
 * feeds the MISMATCH copy so a review lead never claims a decision is missing when one exists.
 */
export function LocalOwnershipPanel({ client, assetId, experienceBound, latest, latestDecision, onVerified }: {
  client: LocalBridgeClient;
  assetId: number;
  experienceBound: boolean;
  latest: LocalOwnershipVerification | null;
  latestDecision: LocalDecision | null;
  onVerified: (assetId: number) => Promise<void>;
}) {
  const [robloxAssetId, setRobloxAssetId] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the status this page was told when it connected, then re-read: a key is configured
  // in the *desktop* app, which can happen while this page is open. Trusting the connect-time value
  // alone would keep telling a person to add a key they just added.
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(client.session.openCloudKeyConfigured);

  useEffect(() => { setRobloxAssetId(''); setError(null); }, [assetId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void client.refreshOpenCloudKeyStatus(controller.signal).then((status) => { if (active) setKeyConfigured(status); });
    return () => { active = false; controller.abort(); };
  }, [client, assetId]);

  const disabledReason = ownershipVerifyDisabledReason(robloxAssetId, experienceBound, keyConfigured);
  const display = latest ? describeOwnershipOutcome(latest, latestDecision) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseRobloxAssetIdInput(robloxAssetId);
    if (!parsed.ok) { setError(parsed.error); return; }
    setVerifying(true);
    setError(null);
    try {
      await client.verifyOwnership(assetId, parsed.value);
      await onVerified(assetId);
      setRobloxAssetId('');
    } catch (reason) {
      setError(ownershipVerifyError(reason).message);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <section className="local-ownership-verification">
      <span>Ownership verification</span>
      {latest && display ? (
        <div className={`local-ownership-verdict tone-${display.tone}`}>
          <strong>{display.isReviewLead ? <AlertTriangle size={14} /> : null}{display.headline}</strong> <EvidenceBasisMark basis={display.basis} />
          <p>{display.detail}</p>
          <p className="local-ownership-linkage">{display.linkage}</p>
          <dl className="local-ownership-facts">
            {/* The checked id sits next to a DECLARED mark: a person supplied it, and every fact
                below is about it — not about the scanned file it was entered against. */}
            <div><dt>Animation ID you entered</dt><dd>{latest.robloxAssetId}{latest.assetType ? ` · ${latest.assetType}` : ''} <EvidenceBasisMark basis={display.linkBasis} /></dd></div>
            <div><dt>Creator of that animation</dt><dd>{formatOwnershipIdentity(latest.creatorType, latest.creatorId)}</dd></div>
            <div><dt>Experience owner</dt><dd>{formatOwnershipIdentity(latest.ownerType, latest.ownerId)}</dd></div>
            {latest.moderationState ? <div><dt>Moderation</dt><dd>{latest.moderationState}</dd></div> : null}
            {latest.memberRank !== null ? <div><dt>Group membership</dt><dd>Rank {latest.memberRank}</dd></div> : null}
          </dl>
          <small>{formatCheckedAt(latest.checkedAt)} · point-in-time observation, not a standing guarantee</small>
        </div>
      ) : (
        <p>No ownership verification yet. This checks who owns a Roblox animation you name below, against this project’s bound experience owner. It does not work out which Roblox animation a scanned file is — generic scanned files have no Roblox id and stay not verified.</p>
      )}
      <form className="local-decision-form local-ownership-form" onSubmit={submit}>
        <label><span>Roblox animation asset ID</span><input inputMode="numeric" value={robloxAssetId} onChange={(event) => setRobloxAssetId(event.target.value)} placeholder="e.g. 507766388" /></label>
        <small>You type this ID in — CreatorFlow cannot check that this file is that animation, so that link is recorded as declared by you. Only the ID’s ownership is checked against Roblox.</small>
        {disabledReason ? <small>{disabledReason}</small> : null}
        {error ? <small role="alert">{error}</small> : null}
        <button className="button button-secondary" type="submit" disabled={verifying || disabledReason !== null}>{verifying ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />} Verify ownership</button>
      </form>
    </section>
  );
}

/**
 * Where a person is inside a gate-check walkthrough, handed to the evidence view so it can say so
 * and offer the next step. Navigation only: it carries no decision, no suggested value, and no
 * verdict, so nothing read out of it can influence what gets recorded.
 */
export interface LocalGateResolutionContext {
  assetId: number;
  index: number;
  total: number;
  path: string;
  /** Null on the last item — the walkthrough ends rather than wrapping. */
  onNext: (() => void) | null;
  onBackToCheck: () => void;
}

export function LocalEvidenceView({ client, project, initialSelectedAssetId = null, onSelectAsset, focusAffordance = null, resolutionContext = null, onResolutionTouch }: { client: LocalBridgeClient; project: LocalProjectSummary; initialSelectedAssetId?: number | null; onSelectAsset?: (assetId: number | null) => void; focusAffordance?: LocalGateAffordance | null; resolutionContext?: LocalGateResolutionContext | null; onResolutionTouch?: (assetId: number, note: string) => void }) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LocalScanAsset[]>([]);
  const [scanRunId, setScanRunId] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedAssetId);
  const [detail, setDetail] = useState<LocalAssetDetail | null>(null);
  const [history, setHistory] = useState<LocalDecision[]>([]);
  const [verifications, setVerifications] = useState<LocalOwnershipVerification[]>([]);
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
  const inspectorRef = useRef<HTMLElement>(null);
  const limit = 100;
  const queuedAssetId = resolutionContext?.assetId ?? null;

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
    if (selectedId === null) { setDetail(null); setHistory([]); setVerifications([]); return; }
    let active = true;
    void client.saveWorkspaceState({ activeProjectId: project.projectId, activeScanRunId: scanRunId || null, selectedAssetId: selectedId }).catch(() => undefined);
    void Promise.all([client.getAsset(selectedId), client.getDecisionHistory(selectedId), client.listOwnershipVerifications(selectedId)]).then(([nextDetail, nextHistory, nextVerifications]) => {
      if (!active) return;
      setDetail(nextDetail);
      setHistory(nextHistory.items);
      setVerifications(nextVerifications.items);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not open the asset record'); });
    return () => { active = false; };
  }, [client, onSelectAsset, project.projectId, scanRunId, selectedId]);

  useEffect(() => {
    setSourceName(detail?.sourceEvidence?.source ?? '');
    setLicenseName(detail?.sourceEvidence?.license ?? '');
    setEvidenceUrl(detail?.sourceEvidence?.evidenceUrl ?? '');
  }, [detail?.asset.id, detail?.sourceEvidence]);

  // Follows the gate-check cursor when the shell moves it. Kept separate from
  // initialSelectedAssetId, which stays initial-only: ordinary browsing is untouched, and a person
  // who clicks another asset mid-walkthrough is not yanked back.
  useEffect(() => {
    if (queuedAssetId !== null) setSelectedId(queuedAssetId);
  }, [queuedAssetId]);

  /**
   * Lands on the affordance that actually changes the violation, not merely on the file.
   *
   * Three forms are stacked in this inspector, and "we opened the asset" is not the same as "we
   * opened the thing that resolves it". Reading the prop on mount is enough because
   * `AnimatePresence` keys the view frame on the active view, so arriving here from the checklist
   * always remounts this component — the same reason `initialSelectedAssetId` works as initial-only
   * state. Only the queued asset is focused, so manual browsing never gets its focus moved.
   */
  useEffect(() => {
    if (!focusAffordance || !detail) return;
    if (queuedAssetId !== null && detail.asset.id !== queuedAssetId) return;
    const selector = focusAffordance === 'source' ? '.local-source-form'
      : focusAffordance === 'ownership' ? '.local-ownership-form'
        : '.local-decision-record-form';
    const form = inspectorRef.current?.querySelector<HTMLElement>(selector);
    if (!form) return;
    // Optional-called: jsdom has no scrollIntoView, and a missing scroll must not cost the focus move.
    form.scrollIntoView?.({ block: 'nearest' });
    form.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  }, [detail?.asset.id, focusAffordance, queuedAssetId]);

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
      // Reports that a write happened, and what it was — never that anything was resolved. Only the
      // next gate run can say that, which is why the checklist renders this as "touched".
      onResolutionTouch?.(detail.asset.id, `decision recorded — ${titleCaseManifestValue(decisionType)}`);
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
      onResolutionTouch?.(detail.asset.id, 'source record saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save source evidence');
    } finally {
      setSourceSaving(false);
    }
  }

  /**
   * Reloads the ledger and the open record after something wrote outside this inspector — today,
   * the group-review panel above. It re-fetches rather than patching state: a batch writes one row
   * per file, and the only honest source for what those rows say is the bridge.
   */
  async function reloadLedger() {
    try {
      const result = await client.listProjectAssets(project.projectId, limit, offset);
      setPage(result.items);
      setScanRunId(result.scanRunId ?? '');
      if (selectedId === null) return;
      const [nextDetail, nextHistory] = await Promise.all([
        client.getAsset(selectedId), client.getDecisionHistory(selectedId),
      ]);
      setDetail(nextDetail);
      setHistory(nextHistory.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reopen persisted assets');
    }
  }

  async function reloadVerifications(assetId: number) {
    const refreshed = await client.listOwnershipVerifications(assetId);
    setVerifications(refreshed.items);
    // A check is a write to the ownership ledger, so it is a touch — and pointedly not a
    // resolution: only APPROVED or EXCLUDED clears an ownership mismatch, never the check itself.
    onResolutionTouch?.(assetId, 'ownership checked');
  }

  const latestVerification = verifications[0] ?? null;
  const superseded = useMemo(() => supersededDecisionIds(history), [history]);

  return (
    <section className="local-evidence-workspace" aria-labelledby="local-evidence-title">
      <header className="local-scan-heading"><div><span>Persisted local evidence</span><h2 id="local-evidence-title">Reopen what the scanner actually stored.</h2><p>These immutable records come from SQLite. Selecting an asset loads its findings, source evidence, and append-only decision history.</p></div><div className="local-bridge-badge"><HardDrive size={16} /><span><strong>{project.name}</strong><small>{scanRunId ? `Run ${scanRunId.slice(0, 12)}…` : 'No persisted run'}</small></span></div></header>
      <div className="local-evidence-toolbar"><label><Search size={14} /><input aria-label="Search persisted local assets" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search current page…" /></label><span>{visible.length} of {page.length} records on this page</span></div>
      {error ? <div className="local-scan-error" role="alert"><AlertTriangle size={15} /><span><strong>Local evidence unavailable</strong><small>{error}</small></span></div> : null}
      {/* Group review sits above the ledger, not inside the inspector: it is about a set of files,
          and the inspector is about one. It lives in its own file because this one's render is a
          single ~6000-character line, and a panel added into that is unreviewable. */}
      <BatchReviewPanel client={client} scanRunId={scanRunId || null} onLedgerChanged={() => { void reloadLedger(); }} />
      <div className="local-evidence-layout">
        <div className="local-asset-ledger">
          {loading ? <div className="local-monitor-empty"><LoaderCircle className="spin" size={20} /><strong>Reopening persisted records…</strong></div> : visible.length ? visible.map((asset) => <button key={asset.id} type="button" className={selectedId === asset.id ? 'selected' : ''} aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)}><span className="manifest-file-icon">{asset.fileType.slice(0, 4).toUpperCase() || 'FILE'}</span><span><strong>{asset.fileName}</strong><small>{asset.relativePath} · {formatBytes(asset.sizeBytes)}</small></span><em data-state={asset.verification.toLowerCase()}>{titleCaseManifestValue(asset.verification)}</em></button>) : <div className="local-monitor-empty"><FolderOpen size={20} /><strong>No persisted assets on this page</strong><p>{query ? 'Clear the search to restore this page.' : 'Run or complete a local scan first.'}</p></div>}
          <footer><button type="button" disabled={offset === 0} onClick={() => setOffset((current) => Math.max(0, current - limit))}><ChevronLeft size={14} /> Previous</button><span>Records {offset + 1}–{offset + page.length}</span><button type="button" disabled={page.length < limit} onClick={() => setOffset((current) => current + limit)}>Next <ChevronRight size={14} /></button></footer>
        </div>
        <aside className="local-asset-inspector" ref={inspectorRef}>
          {resolutionContext && selectedId === resolutionContext.assetId ? <div className="local-partial-result local-gate-context"><Workflow size={15} /><span><strong>Gate check · item {resolutionContext.index + 1} of {resolutionContext.total}</strong><small>{resolutionContext.path} — recording something here does not clear the gate. Re-run the check to see what still stands.</small></span>{resolutionContext.onNext ? <button type="button" onClick={resolutionContext.onNext}>Next item</button> : null}<button type="button" onClick={resolutionContext.onBackToCheck}>Back to gate check</button></div> : null}
          {detail ? <><header><span>Asset record</span><h3>{detail.asset.fileName}</h3><p>{detail.asset.relativePath}</p></header><dl><div><dt>Verification</dt><dd>{titleCaseManifestValue(detail.asset.verification)} <EvidenceBasisMark basis={verificationBasis()} /></dd></div><div><dt>Size</dt><dd>{formatBytes(detail.asset.sizeBytes)}</dd></div><div><dt>Dimensions</dt><dd>{detail.asset.width && detail.asset.height ? `${detail.asset.width} × ${detail.asset.height}` : 'Not reported'}</dd></div><div><dt>Findings</dt><dd>{detail.findings.length}</dd></div><div><dt>Ownership</dt><dd><EvidenceBasisMark basis={ownershipBasis(latestVerification)} /> <small>{latestVerification ? 'Facts obtained from Roblox for an animation ID a person entered for this file; the link between the two is declared, not verified — see below.' : 'Not checked yet — verify below by entering a Roblox animation ID.'}</small></dd></div></dl><section><span>SHA-256</span><code>{detail.asset.sha256}</code></section><section><span>Findings</span>{detail.findings.length ? <ul>{detail.findings.map((finding) => <li key={finding.id}><strong>{finding.code}</strong><small>{finding.message}{finding.matchDistance !== null ? ` · distance ${finding.matchDistance}` : ''}</small></li>)}</ul> : <p>No findings recorded.</p>}</section><form className="local-decision-form local-source-form" onSubmit={saveSourceEvidence}><strong>Source evidence</strong><label><span>Source</span><input value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Provider, archive, or owner…" /></label><label><span>License</span><input value={licenseName} onChange={(event) => setLicenseName(event.target.value)} placeholder="License or ownership basis…" /></label><label><span>Evidence URL</span><input type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://…" /></label><button className="button button-secondary" type="submit" disabled={sourceSaving}>{sourceSaving ? <LoaderCircle className="spin" size={14} /> : <Library size={14} />} Save source record</button><small>{detail.sourceEvidence?.resolved ? 'Resolved source and license pair' : 'Source remains unresolved until both fields are recorded'}</small> <EvidenceBasisMark basis={sourceBasis(detail.sourceEvidence)} />{detail.sourceEvidence?.batchId ? <small className="local-batch-marker">{batchMarkerLabel(detail.sourceEvidence.batchId, detail.sourceEvidence.batchAssetCount)} — the same source and license were declared over those files at once.</small> : null}</form><LocalOwnershipPanel client={client} assetId={detail.asset.id} experienceBound={Boolean(project.experience)} latest={latestVerification} latestDecision={detail.latestDecision ?? null} onVerified={reloadVerifications} /><section><span>Latest decision</span>{detail.latestDecision ? <div><strong>{titleCaseManifestValue(detail.latestDecision.type)}</strong> <EvidenceBasisMark basis={decisionBasis(detail.latestDecision) ?? 'DECLARED'} /><small>{detail.latestDecision.reason}</small>{detail.latestDecision.batchId ? <small className="local-batch-marker">{batchMarkerLabel(detail.latestDecision.batchId, detail.latestDecision.batchAssetCount)}</small> : null}</div> : <p>No human decision recorded.</p>}<small>{history.length} append-only record{history.length === 1 ? '' : 's'} in history</small></section>{history.length ? <section className="local-decision-history"><span>Decision history</span><small>Oldest first — the standing decision is the last one, and anything a later record replaced is marked.</small><ol>{history.map((entry) => <li key={entry.id} data-superseded={superseded.has(entry.id) ? 'true' : undefined}><strong>{titleCaseManifestValue(entry.type)}</strong><em className="local-decision-stamp">{formatDecisionTimestamp(entry.createdAt)}{superseded.has(entry.id) ? ' · superseded by a later decision' : ''}</em>{entry.batchId ? <em className="local-batch-marker">{batchMarkerLabel(entry.batchId, entry.batchAssetCount)}</em> : null}<small>{entry.reason}</small></li>)}</ol></section> : null}<form className="local-decision-form local-decision-record-form" onSubmit={saveDecision}><label><span>{detail.latestDecision ? 'Superseding decision' : 'Decision'}</span><select value={decisionType} onChange={(event) => setDecisionType(event.target.value as LocalDecisionType)}><option value="APPROVED">Approved</option><option value="NEEDS_REVIEW">Needs review</option><option value="BLOCKED">Blocked</option><option value="EXCLUDED">Excluded</option></select></label><label><span>Reason</span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the evidence behind this decision…" /></label><button className="button button-primary" type="submit" disabled={saving || !reason.trim()}>{saving ? <LoaderCircle className="spin" size={14} /> : <FileCheck2 size={14} />} Record decision</button></form></> : <div className="local-monitor-empty"><Circle size={20} /><strong>Select a persisted asset</strong><p>Its detailed evidence and decision history will open here.</p></div>}
        </aside>
      </div>
    </section>
  );
}

/**
 * One gate check, plus what has happened on this machine since it was taken.
 *
 * Lives in the workspace shell rather than in a view, because the whole point is that it survives
 * the trip to Evidence and back. It is not persisted: a reload loses it, and re-checking is one
 * click and one local query. See the design spec for why `workspace_state.queue_json` is the
 * natural home later and what has to be fixed before anything uses it.
 */
export interface LocalGateResolution {
  preview: LocalGatePreview;
  /** Asset id → what was written on it since the check. A record of a write, never of a resolution. */
  touched: Record<number, string>;
  /** Index into {@link gateResolutionQueue} — where the walkthrough currently is. */
  cursor: number;
}

/** At most this many rows are drawn per group. The COUNT is never truncated, only the rendering. */
const gateRowCap = 50;

/**
 * The grouped, jumpable checklist of what is standing at the release gate.
 *
 * Three things it deliberately does not do. It does not render a decision picker — resolving
 * requires being in the evidence view with the findings, hash, source record, ownership verdict and
 * decision history on screen around the form, so the jump is a shortcut through navigation, never
 * through review. It does not suggest a decision, because pre-selecting the value that clears a
 * similarity flag would be the tool proposing the answer a similarity signal is not allowed to
 * propose. And it never says "resolved": between two checks the workspace can only honestly report
 * that something was written, which it shows as *touched*, in the review tone, without decrementing
 * the standing count.
 */
export function LocalGateCheckPanel({ preview, touched, run, checking, checkError, onRunCheck, onOpenAsset }: {
  preview: LocalGatePreview | null;
  touched: Record<number, string>;
  run: LocalScanRun | null;
  checking: boolean;
  /** The last attempt's failure, or null. Never clears a previous result: a failed check is not a clean check. */
  checkError: string | null;
  onRunCheck: () => void;
  onOpenAsset: (assetId: number, affordance: LocalGateAffordance) => void;
}) {
  const stale = isGatePreviewStale(preview, run?.id ?? null);
  const groups = useMemo(() => groupGateViolations(preview?.violations ?? []), [preview?.violations]);
  const openPerPath = useMemo(() => {
    const counts = new Map<string, number>();
    (preview?.violations ?? []).forEach((violation) => counts.set(violation.path, (counts.get(violation.path) ?? 0) + 1));
    return counts;
  }, [preview?.violations]);
  // Only assets that are actually in this check are counted as touched — a write on some unrelated
  // file is not progress against this checklist.
  const standingAssetIds = useMemo(
    () => new Set((preview?.violations ?? []).map((violation) => violation.scanAssetId).filter((id): id is number => id !== null)),
    [preview?.violations],
  );
  const touchedCount = Object.keys(touched).map(Number).filter((id) => standingAssetIds.has(id)).length;
  const canCheck = run?.state === 'COMPLETED';

  return (
    <section className="local-gate-check" aria-labelledby="local-gate-check-title">
      <header>
        <div>
          <span>Gate check</span>
          <h3 id="local-gate-check-title">See what is blocking, without minting a release.</h3>
          {preview
            ? <p>Checked {new Date(preview.evaluatedAt).toLocaleString()} against run {preview.scanRunId.slice(0, 10)}… — this is a check, not a release. Nothing was written.</p>
            : <p>Not checked yet — run the gate check to see what would block this release. It runs the same gate a release runs and creates nothing.</p>}
        </div>
        {preview ? <span className="local-run-state" data-state={preview.passed ? 'completed' : 'failed'}>{preview.passed ? <Check size={13} /> : <AlertTriangle size={13} />}{preview.passed ? 'Check passed' : 'BLOCKED'}</span> : null}
      </header>

      {canCheck ? null : <p className="local-gate-unavailable">The gate can only be checked against a completed scan. Complete or reopen one first.</p>}
      {checkError ? <div className="local-scan-error" role="alert"><AlertTriangle size={15} /><span><strong>{preview ? 'Could not re-check' : 'Could not run the gate check'}</strong><small>{checkError}{preview ? ' — the result below is the earlier one, with its original timestamp.' : ''}</small></span></div> : null}
      {stale && preview ? <div className="local-gate-stale" role="status"><AlertTriangle size={15} /><span><strong>This check is against an older scan.</strong><small>Run {preview.scanRunId.slice(0, 10)}… is no longer the active one. Asset records are per-run, so nothing in this list points at a file in the current scan — and decisions recorded against the previous run stay with that run, so the new run’s files need their own. Re-check to start over against the current scan.</small></span></div> : null}

      {preview && preview.passed && preview.violations.length === 0 ? (
        <div className="local-gate-passed">
          <Check size={15} />
          <span>
            <strong>Nothing was standing at the gate when this ran.</strong>
            <small>A passing check reflects process and evidence completeness — decisions recorded, sources present, flags approved. It is not a copyright or originality verdict, and it is not a release: building the release record below is what persists one.</small>
          </span>
        </div>
      ) : null}

      {/* Both banners test passed AND the row count: a future desktop that returned passed:true
          beside violations would otherwise render the green block above a list of them, and
          suppress the standing count. The same forward-compat care the "Other" group takes for
          unknown codes — and this one has to fail toward the pessimistic side. */}
      {preview && (!preview.passed || preview.violations.length > 0) ? <p className="local-gate-standing">{gateProgressLabel(preview.summary.violations, touchedCount)}</p> : null}

      {groups.map((group) => {
        const shown = group.violations.slice(0, gateRowCap);
        return (
          <section className="local-gate-group" key={group.code}>
            <header><strong>{group.title}</strong><em>{group.violations.length}</em><p>{group.clears}</p></header>
            <ul>
              {shown.map((violation) => {
                const assetId = violation.scanAssetId;
                const note = assetId === null ? undefined : touched[assetId];
                const onFile = openPerPath.get(violation.path) ?? 1;
                return (
                  <li className="local-gate-violation" key={`${violation.code}-${violation.path}`}>
                    <code>{violation.path}</code>
                    <small>{titleCaseManifestValue(violation.verification)} · {titleCaseManifestValue(violation.decision)}</small>
                    <p>{violation.message}</p>
                    {onFile > 1 ? <small>{onFile} open items on this file — one save may not clear them all.</small> : null}
                    {note ? <em className="local-gate-touched">Touched since this check: {note}. The gate has not run again, so this item still stands.</em> : null}
                    {assetId === null
                      ? <small className="local-gate-nojump">No jump: this path is not in this scan’s asset list, so there is no record to open.</small>
                      : <button type="button" disabled={stale} onClick={() => onOpenAsset(assetId, affordanceForViolationCode(violation.code))}>Open evidence →</button>}
                  </li>
                );
              })}
            </ul>
            {group.violations.length > shown.length ? <small className="local-gate-more">…and {group.violations.length - shown.length} more of this kind. The count above is the real one; a built release’s gate report carries every row.</small> : null}
          </section>
        );
      })}

      <footer>
        <button className="button button-secondary" type="button" onClick={onRunCheck} disabled={!canCheck || checking}>{checking ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />} {preview ? 'Re-run gate check' : 'Run gate check'}</button>
        <small>Checking creates no release record and writes nothing. Building a release stays available below, blocked or not — a blocked release is still a real, downloadable artifact.</small>
      </footer>
    </section>
  );
}

export function LocalReleasesView({ client, project, run, gateResolution, onGateResolutionChange, onOpenAsset }: { client: LocalBridgeClient; project: LocalProjectSummary; run: LocalScanRun | null; gateResolution: LocalGateResolution | null; onGateResolutionChange: (next: LocalGateResolution | null) => void; onOpenAsset: (assetId: number, affordance: LocalGateAffordance) => void }) {
  const [releases, setReleases] = useState<LocalRelease[]>([]);
  const [releaseName, setReleaseName] = useState(run?.release ?? 'Working');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [publishedVersionInputs, setPublishedVersionInputs] = useState<Record<string, string>>({});
  const [publishingReleaseId, setPublishingReleaseId] = useState<string | null>(null);
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

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

  /**
   * Runs the gate against a scan and shows what it found. Creates nothing — that is the whole
   * difference from the form below, and the reason re-checking is free of the side effects that
   * make re-building one poison the next real release's diff baseline.
   *
   * A failure leaves any previous result exactly where it was, timestamp included: a failed check
   * is not a clean check, and it must never be able to flip the panel to passed.
   */
  async function runGateCheck(scanRunId?: string) {
    setChecking(true);
    setCheckError(null);
    try {
      const preview = await client.previewGate(project.projectId, scanRunId);
      // A new preview is a new truth object, so the touched overlay and the cursor reset with it —
      // they only ever described the check they were collected against.
      onGateResolutionChange({ preview, touched: {}, cursor: 0 });
    } catch (reason) {
      setCheckError(reason instanceof Error ? reason.message : 'Could not run the gate check');
    } finally {
      setChecking(false);
    }
  }

  async function createRelease(event: FormEvent) {
    event.preventDefault();
    if (!run) return;
    setCreating(true);
    setError('');
    try {
      const created = await client.createRelease(project.projectId, { scanRunId: run.id, release: releaseName.trim() || run.release });
      setReleases((current) => [created, ...current.filter((release) => release.id !== created.id)]);
      // Re-check straight after a build, so the checklist on screen and the release just written
      // cannot be read side by side saying different things.
      void runGateCheck(run.id);
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

  return <section className="local-releases-workspace" aria-labelledby="local-releases-title"><header className="local-scan-heading"><div><span>Persisted releases</span><h2 id="local-releases-title">Export the evidence that actually passed—or failed—the gate.</h2><p>Each release is rebuilt from the immutable scan, latest source evidence, and latest append-only decisions. Manifest and policy-report downloads come from the desktop bridge.</p></div><div className="local-bridge-badge"><FileJson size={16} /><span><strong>{project.name}</strong><small>{releases.length} persisted release{releases.length === 1 ? '' : 's'}</small></span></div></header><LocalGateCheckPanel preview={gateResolution?.preview ?? null} touched={gateResolution?.touched ?? {}} run={run} checking={checking} checkError={checkError} onRunCheck={() => { void runGateCheck(run?.id); }} onOpenAsset={onOpenAsset} /><form className="local-release-create" onSubmit={createRelease}><label><span>Release name</span><input value={releaseName} onChange={(event) => setReleaseName(event.target.value)} maxLength={120} /></label><div><span>Source run</span><strong>{run ? `${run.release} · ${stateLabel(run.state)}` : 'No active persisted run'}</strong></div><button className="button button-primary" type="submit" disabled={!canCreate || creating}>{creating ? <LoaderCircle className="spin" size={14} /> : <FileCheck2 size={14} />} Build release record</button></form>{error ? <div className="local-scan-error" role="alert"><AlertTriangle size={15} /><span><strong>Release operation failed</strong><small>{error}</small></span></div> : null}<div className="local-release-list">{loading ? <div className="local-monitor-empty"><LoaderCircle className="spin" size={20} /><strong>Loading releases…</strong></div> : releases.length ? releases.map((release) => <article key={release.id}><header><span className="local-run-state" data-state={release.policyResult === 'PASS' ? 'completed' : 'failed'}>{release.policyResult === 'PASS' ? <Check size={13} /> : <AlertTriangle size={13} />}{release.policyResult}</span><div><strong>{release.release ?? release.releaseName ?? 'Release'}</strong><small>{new Date(release.createdAt).toLocaleString()} · run {release.scanRunId.slice(0, 10)}…</small></div>{release.policyResult === 'BLOCKED' ? <button className="local-release-recheck" type="button" disabled={checking} onClick={() => { void runGateCheck(release.scanRunId); }}>Re-check this run</button> : null}</header><dl><div><dt>Added</dt><dd>{release.comparison.added}</dd></div><div><dt>Changed</dt><dd>{release.comparison.changed}</dd></div><div><dt>Removed</dt><dd>{release.comparison.removed}</dd></div><div><dt>Unresolved</dt><dd>{release.comparison.unresolved}</dd></div><div><dt>Approved</dt><dd>{release.comparison.approved}</dd></div><div><dt>Blocked</dt><dd>{release.comparison.blocked}</dd></div></dl>{release.experience ? <p className="local-release-experience">Declared experience (not verified): {experienceSummary(release.experience)}</p> : null}{release.comparison.previousReleaseId ? <p className="local-release-rollback">Rollback target: {resolveRollbackTargetLabel(release.comparison.previousReleaseId, releases)} — <a href={client.releaseManifestUrl(release.comparison.previousReleaseId)} download>manifest</a>. Roll back to this release in Roblox Studio if this one must be reverted — CreatorFlow does not perform the rollback.</p> : null}{release.publishedPlaceVersion != null ? <p className="local-release-published">Published as place version {release.publishedPlaceVersion} <EvidenceBasisMark basis="DECLARED" compact /> <small>(self-reported — not verified against Roblox)</small></p> : <form className="local-decision-form local-release-publish-form" onSubmit={(event) => recordPublishedVersion(release, event)}><label><span>Record the Roblox place version you published</span><input inputMode="numeric" value={publishedVersionInputs[release.id] ?? ''} onChange={(event) => setPublishedVersionInputs((current) => ({ ...current, [release.id]: event.target.value }))} placeholder="e.g. 42" /></label>{publishErrors[release.id] ? <small role="alert">{publishErrors[release.id]}</small> : null}<button className="button button-secondary" type="submit" disabled={publishingReleaseId === release.id}>{publishingReleaseId === release.id ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Record published version</button></form>}<div className="local-release-downloads"><a href={release.manifestUrl} download><FileJson size={13} /> Manifest JSON</a><a href={release.reportUrl} download><ShieldCheck size={13} /> Gate report</a></div>{release.comparison.addedPaths.length || release.comparison.changedPaths.length || release.comparison.removedPaths.length ? <details><summary>Path-level comparison</summary><div>{release.comparison.addedPaths.map((path) => <span key={`a-${path}`}>Added · {path}</span>)}{release.comparison.changedPaths.map((path) => <span key={`c-${path}`}>Changed · {path}</span>)}{release.comparison.removedPaths.map((path) => <span key={`r-${path}`}>Removed · {path}</span>)}</div></details> : null}</article>) : <div className="local-monitor-empty"><FileJson size={20} /><strong>No releases exported yet</strong><p>{canCreate ? 'Build the first immutable release record from the completed scan.' : 'Complete or reopen a completed local scan before creating a release.'}</p></div>}</div></section>;
}

export function LocalSourcesBoundary({ onOpenEvidence }: { onOpenEvidence: () => void }) {
  return <section className="local-workspace-boundary"><Library size={22} /><div><span>Persisted source evidence</span><h2>Source records live with each immutable asset.</h2><p>Open Evidence to inspect or append the real source/license record saved for a selected asset. Project-wide source aggregation is the remaining source-library API boundary.</p></div><button className="button button-primary" type="button" onClick={onOpenEvidence}>Open persisted evidence</button></section>;
}
