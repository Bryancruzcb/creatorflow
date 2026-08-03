import { AlertTriangle, Check, FolderOpen, LoaderCircle, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LocalBridgeError,
  type BatchableAction,
  type LocalBridgeClient,
  type LocalDecisionBatch,
  type LocalReviewGroup,
  type LocalReviewGroupAsset,
  type LocalReviewGroups,
} from '../bridge/localBridge';
import { titleCaseManifestValue } from '../manifest/manifest';

/**
 * The most files one batch may carry. A review-quality cap, not a byte limit — the request cap is
 * far away from it — and the UI says so in those words rather than reporting a number. Mirrors
 * `BatchDecisionService.MAX_BATCH_ASSETS`, which enforces it on the write.
 */
export const MAX_BATCH_ASSETS = 200;

/** Below this it is a per-file decision, and the inspector's own form is where it belongs. */
export const MIN_BATCH_ASSETS = 2;

/**
 * The gate's rules in plain words, for the chips.
 *
 * These are labels for a *kind*, never a verdict about a file, and they say what is standing rather
 * than what should be done about it. An unrecognised code falls through to the code itself: a rule
 * this build has never heard of still blocks a release, and hiding it would under-report.
 */
export function reviewGroupLabel(code: string): string {
  switch (code) {
    case 'UNRESOLVED_SOURCE': return 'Unresolved source';
    case 'FLAGGED_WITHOUT_APPROVAL': return 'Flagged, needs a call';
    case 'OWNERSHIP_MISMATCH_WITHOUT_DECISION': return 'Ownership lead';
    case 'BLOCKED_DECISION': return 'Blocked';
    default: return code;
  }
}

/** What each batchable action is called where a person picks it. */
export function batchActionLabel(action: BatchableAction): string {
  switch (action) {
    case 'SOURCE_EVIDENCE': return 'Record a shared source';
    case 'EXCLUDED': return 'Exclude from release';
    case 'NEEDS_REVIEW': return 'Mark needs review';
  }
}

/**
 * Exactly what the confirm step promises will be written, in rows rather than in adjectives.
 *
 * The count is load-bearing: a batch writes N records, not one, and every one of them lands in its
 * own file's history carrying this rationale.
 *
 * Excluding gets the sentence that took a review to get right. An earlier version said "this does
 * not clear the similarity finding", which is true of the finding *record* and false of the thing a
 * reader cares about: `ReleaseGate.evaluate` skips an excluded asset before it ever reaches the
 * flagged or ownership checks, so an exclusion settles the asset at the gate, not one violation of
 * it. That is exactly why a batch exclusion is refused for any file standing under another rule —
 * so the copy explains the mechanism rather than making a promise the gate does not keep.
 */
export function batchConfirmationCopy(action: BatchableAction, assetCount: number): string[] {
  const lines = action === 'SOURCE_EVIDENCE'
    ? [`Writes 1 batch record and ${assetCount} source records. Every file keeps its own row in its own`
      + ' history, all carrying this source, this license and this rationale.',
    'This is your declaration, recorded as declared. CreatorFlow does not check it and nothing here'
      + ' becomes verified.']
    : [`Writes 1 batch record and ${assetCount} decision rows. Every file keeps its own row in its own`
      + ' history, all carrying this rationale.'];
  if (action === 'EXCLUDED') {
    lines.push('Excluded files are left out of every release built from this scan.');
    lines.push('At the gate an exclusion skips every other check on that file, so this batch only'
      + ' offers it for files standing under this rule alone — anything also flagged, or carrying an'
      + ' ownership lead, has to be excluded on its own page. The findings themselves stay on the'
      + ' record either way.');
  }
  if (action === 'NEEDS_REVIEW') {
    lines.push('Needs review records that the review has not happened yet, so it clears nothing at the'
      + ' gate. The release stays blocked — the queue is just no longer anonymous.');
  }
  return lines;
}

/** The folder each path sits in, for the narrowing filter. Computed, never a claim about the file. */
export function parentFolder(relativePath: string): string {
  const cut = relativePath.lastIndexOf('/');
  return cut === -1 ? '' : relativePath.slice(0, cut + 1);
}

export interface BatchNarrowing {
  folder: string;
  fileType: string;
  sharedHashOnly: boolean;
}

/**
 * Narrows the candidate set from computed facts only — the folder a file is in, its type, and
 * whether its SHA-256 is identical to another file in the same group.
 *
 * Filters narrow; they never select. Nothing in this function returns a selection, which is the
 * whole point: the claim that a set belongs together is the person's, and it has to be made by
 * ticking boxes and writing a sentence.
 */
export function narrowGroupAssets(assets: LocalReviewGroupAsset[], narrowing: BatchNarrowing): LocalReviewGroupAsset[] {
  const shared = new Set<string>();
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.sha256)) shared.add(asset.sha256);
    seen.add(asset.sha256);
  }
  return assets.filter((asset) => {
    if (narrowing.folder && parentFolder(asset.relativePath) !== narrowing.folder) return false;
    if (narrowing.fileType && asset.fileType !== narrowing.fileType) return false;
    if (narrowing.sharedHashOnly && !shared.has(asset.sha256)) return false;
    return true;
  });
}

/**
 * Group review: resolve a same-violation-kind set of files with one shared, written justification.
 *
 * <p>Three things this panel deliberately does not do, each of them the reason it can exist at all:
 *
 * <ul>
 *   <li><strong>It renders no Approve or Block control.</strong> Not disabled — absent, with one
 *     line saying where those decisions belong. A greyed-out Approve is an invitation to ask how to
 *     turn it on, and the bridge refuses it anyway.</li>
 *   <li><strong>Nothing is ever pre-checked.</strong> Pre-checking is how a group review becomes a
 *     rubber stamp. The filters narrow candidates from computed facts; they never select.</li>
 *   <li><strong>It never claims anything was resolved.</strong> Only the gate can say that, and only
 *     on its next run — so after a batch the groups are re-fetched from the gate rather than patched
 *     here.</li>
 * </ul>
 */
export function BatchReviewPanel({ client, scanRunId, onLedgerChanged }: {
  client: LocalBridgeClient;
  scanRunId: string | null;
  onLedgerChanged?: () => void;
}) {
  const [groups, setGroups] = useState<LocalReviewGroups | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [action, setAction] = useState<BatchableAction | null>(null);
  const [rationale, setRationale] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [licenseName, setLicenseName] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [narrowing, setNarrowing] = useState<BatchNarrowing>({ folder: '', fileType: '', sharedHashOnly: false });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<LocalDecisionBatch | null>(null);
  const [drifted, setDrifted] = useState<number[]>([]);

  const load = useCallback(async (runId: string) => {
    setLoading(true);
    try {
      const next = await client.listReviewGroups(runId);
      setGroups(next);
      setUnavailable(null);
    } catch (reason) {
      // 409 is the honest "there is nothing to review here" — a run that is not a completed
      // immutable snapshot. It is not an error state, it is a state with no controls.
      if (reason instanceof LocalBridgeError && reason.status === 409) {
        setGroups(null);
        setUnavailable(reason.message);
      } else {
        setError(reason instanceof Error ? reason.message : 'Could not read what is standing at the gate');
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    setGroups(null);
    setUnavailable(null);
    setError(null);
    setOpenCode(null);
    setReceipt(null);
    if (!scanRunId) return;
    void load(scanRunId);
  }, [load, scanRunId]);

  const open = useMemo(
    () => groups?.groups.find((group) => group.code === openCode) ?? null,
    [groups, openCode],
  );

  const shown = useMemo(
    () => (open ? narrowGroupAssets(open.assets, narrowing) : []),
    [open, narrowing],
  );

  /**
   * The files a submit would actually write to — read off what is on screen, not off `open.assets`.
   *
   * Selection is cleared whenever the narrowing changes, so these are always rows the person can
   * currently see; sourcing them from `shown` as well means the two can never drift apart if that
   * ever stops being true. This same list is what the confirm step renders, so "confirm what you are
   * about to write" means the paths, not just a count.
   */
  const selectedRows = useMemo(
    () => shown.filter((asset) => selected.includes(asset.scanAssetId)),
    [shown, selected],
  );

  function resetComposition() {
    setSelected([]);
    setAction(null);
    setRationale('');
    setSourceName('');
    setLicenseName('');
    setEvidenceUrl('');
    setNarrowing({ folder: '', fileType: '', sharedHashOnly: false });
    setConfirming(false);
    setDrifted([]);
  }

  function toggleGroup(code: string) {
    // One group open at a time, and selection cannot cross groups because it is cleared with the
    // group — there is no shared selection state above this.
    setOpenCode((current) => (current === code ? null : code));
    setReceipt(null);
    setError(null);
    resetComposition();
  }

  function toggleAsset(scanAssetId: number) {
    setConfirming(false);
    setSelected((current) => (current.includes(scanAssetId)
      ? current.filter((id) => id !== scanAssetId)
      : [...current, scanAssetId]));
  }

  /**
   * Narrowing clears the selection, on purpose and visibly.
   *
   * Otherwise a person can tick 40 files in one folder, switch the filter to another, tick 30 more,
   * and submit 70 while 30 are on screen. Keeping the hidden 40 would be defensible for a filter and
   * indefensible here: what is being written is a claim about a set, and a set you cannot see is not
   * a set you can claim.
   */
  function narrow(next: BatchNarrowing) {
    setNarrowing(next);
    setConfirming(false);
    setSelected([]);
  }

  /**
   * Choosing "Exclude from release" drops any file that is also standing under another rule.
   *
   * At the gate an exclusion skips every check on that asset, so excluding a file to settle its
   * missing source record would silence its similarity flag too. The bridge refuses such a batch
   * outright; dropping the rows here means a person is never staring at a selection the server will
   * reject, and the count below says how many went and why.
   */
  function chooseAction(next: BatchableAction) {
    setConfirming(false);
    setAction(next);
    if (next !== 'EXCLUDED' || !open) return;
    const excludable = new Set(open.assets
      .filter((asset) => asset.alsoStandingCodes.length === 0)
      .map((asset) => asset.scanAssetId));
    setSelected((current) => current.filter((id) => excludable.has(id)));
  }

  const overCap = selectedRows.length > MAX_BATCH_ASSETS;
  const sourceReady = action !== 'SOURCE_EVIDENCE' || (sourceName.trim() !== '' && licenseName.trim() !== '');
  const ready = action !== null && selectedRows.length >= MIN_BATCH_ASSETS && !overCap
    && rationale.trim() !== '' && sourceReady;

  async function submit() {
    if (!open || !action || !groups || !scanRunId) return;
    const rows = selectedRows;
    setSubmitting(true);
    setError(null);
    setDrifted([]);
    try {
      const written = action === 'SOURCE_EVIDENCE'
        ? await client.recordBatchSourceEvidence(scanRunId, {
          code: open.code,
          source: sourceName.trim(),
          license: licenseName.trim(),
          evidenceUrl: evidenceUrl.trim() || null,
          rationale: rationale.trim(),
          assets: rows.map((asset) => ({
            scanAssetId: asset.scanAssetId,
            latestSourceEvidenceId: asset.latestSourceEvidenceId,
          })),
        })
        : await client.recordBatchDecision(scanRunId, {
          code: open.code,
          type: action,
          rationale: rationale.trim(),
          assets: rows.map((asset) => ({
            scanAssetId: asset.scanAssetId,
            supersedesDecisionId: asset.latestDecisionId,
          })),
        });
      setReceipt(written);
      resetComposition();
      // Re-read from the gate rather than patching the list here: whether anything cleared is the
      // gate's answer, not this component's.
      await load(scanRunId);
      onLedgerChanged?.();
    } catch (reason) {
      if (reason instanceof LocalBridgeError && reason.driftedAssetIds) {
        setDrifted(reason.driftedAssetIds);
        setConfirming(false);
        await load(scanRunId);
      }
      setError(reason instanceof Error ? reason.message : 'Could not record the batch');
    } finally {
      setSubmitting(false);
    }
  }

  if (!scanRunId) return null;

  return (
    <section className="local-batch-review" aria-labelledby="local-batch-review-title">
      <header>
        <div>
          <span>Group review</span>
          <h3 id="local-batch-review-title">Resolve a group of files with one written reason.</h3>
          <p>
            These groups are the release gate’s own findings, not a second opinion. Approving and
            blocking are missing on purpose — see below.
          </p>
        </div>
        {groups ? (
          <em className="local-batch-verdict" data-state={groups.gateResult === 'PASS' ? 'completed' : 'failed'}>
            {groups.gateResult === 'PASS' ? 'Gate passed' : 'Gate blocked'}
          </em>
        ) : null}
      </header>

      {loading && !groups ? (
        <p className="local-batch-note"><LoaderCircle className="spin" size={14} /> Reading what is standing at the gate…</p>
      ) : null}
      {unavailable ? <p className="local-batch-note">{unavailable}</p> : null}
      {error ? (
        <div className="local-scan-error" role="alert">
          <AlertTriangle size={15} />
          <span><strong>Nothing was recorded</strong><small>{error}</small></span>
        </div>
      ) : null}
      {drifted.length ? (
        <p className="local-batch-drift" role="status">
          {drifted.length === 1 ? 'One file' : `${drifted.length} files`} changed while this group was
          open (ids {drifted.join(', ')}). The group below has been reloaded — check those files before
          batching them again.
        </p>
      ) : null}
      {receipt ? (
        <p className="local-batch-receipt" role="status">
          <Check size={14} /> Recorded {receipt.assetCount} {receipt.kind === 'SOURCE_EVIDENCE' ? 'source records' : 'decisions'}
          {' '}as batch {receipt.batchId.slice(0, 8)} — each file keeps its own row in its own history.
        </p>
      ) : null}

      {groups && !unavailable ? (
        groups.groups.length ? (
          <>
            <div className="local-batch-chips">
              {groups.groups.map((group) => (
                <button
                  key={group.code}
                  type="button"
                  aria-expanded={openCode === group.code}
                  className={openCode === group.code ? 'selected' : ''}
                  onClick={() => toggleGroup(group.code)}
                >
                  {reviewGroupLabel(group.code)} · {group.assets.length}
                </button>
              ))}
            </div>
            {open ? (
              <BatchGroupComposer
                group={open}
                shown={shown}
                selected={selected}
                selectedRows={selectedRows}
                narrowing={narrowing}
                onNarrow={narrow}
                onToggleAsset={toggleAsset}
                onSelectShown={() => {
                  setConfirming(false);
                  // Only what this action can actually be recorded against, so "select all shown"
                  // never quietly hands the server a batch it is about to refuse.
                  setSelected(shown
                    .filter((asset) => action !== 'EXCLUDED' || asset.alsoStandingCodes.length === 0)
                    .map((asset) => asset.scanAssetId));
                }}
                onClearSelection={() => { setConfirming(false); setSelected([]); }}
                action={action}
                onAction={chooseAction}
                rationale={rationale}
                onRationale={(next) => { setConfirming(false); setRationale(next); }}
                sourceName={sourceName}
                onSourceName={setSourceName}
                licenseName={licenseName}
                onLicenseName={setLicenseName}
                evidenceUrl={evidenceUrl}
                onEvidenceUrl={setEvidenceUrl}
                overCap={overCap}
                ready={ready}
                confirming={confirming}
                submitting={submitting}
                onConfirm={() => setConfirming(true)}
                onCancelConfirm={() => setConfirming(false)}
                onSubmit={() => { void submit(); }}
              />
            ) : null}
          </>
        ) : (
          <p className="local-batch-note">No outstanding group work on this scan.</p>
        )
      ) : null}
    </section>
  );
}

function BatchGroupComposer({
  group, shown, selected, selectedRows, narrowing, onNarrow, onToggleAsset, onSelectShown,
  onClearSelection,
  action, onAction, rationale, onRationale, sourceName, onSourceName, licenseName, onLicenseName,
  evidenceUrl, onEvidenceUrl, overCap, ready, confirming, submitting, onConfirm, onCancelConfirm, onSubmit,
}: {
  group: LocalReviewGroup;
  shown: LocalReviewGroupAsset[];
  selected: number[];
  selectedRows: LocalReviewGroupAsset[];
  narrowing: BatchNarrowing;
  onNarrow: (next: BatchNarrowing) => void;
  onToggleAsset: (scanAssetId: number) => void;
  onSelectShown: () => void;
  onClearSelection: () => void;
  action: BatchableAction | null;
  onAction: (next: BatchableAction) => void;
  rationale: string;
  onRationale: (next: string) => void;
  sourceName: string;
  onSourceName: (next: string) => void;
  licenseName: string;
  onLicenseName: (next: string) => void;
  evidenceUrl: string;
  onEvidenceUrl: (next: string) => void;
  overCap: boolean;
  ready: boolean;
  confirming: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onSubmit: () => void;
}) {
  const folders = useMemo(
    () => [...new Set(group.assets.map((asset) => parentFolder(asset.relativePath)))].filter(Boolean).sort(),
    [group.assets],
  );
  const fileTypes = useMemo(
    () => [...new Set(group.assets.map((asset) => asset.fileType))].sort(),
    [group.assets],
  );
  const blockedFromExclusion = useMemo(
    () => shown.filter((asset) => asset.alsoStandingCodes.length > 0),
    [shown],
  );

  return (
    <div className="local-batch-group">
      <p className="local-batch-gate-message">{group.message}</p>

      {group.batchableActions.length === 0 ? (
        <p className="local-batch-note">
          Nothing here can be batched. These files already carry a deliberate decision from a person,
          and superseding a pile of them in one action is exactly what this panel exists not to do —
          open a file to change its decision.
        </p>
      ) : null}

      <div className="local-batch-narrowing">
        <label>
          <span>Folder</span>
          <select value={narrowing.folder} onChange={(event) => onNarrow({ ...narrowing, folder: event.target.value })}>
            <option value="">Any folder</option>
            {folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        </label>
        <label>
          <span>File type</span>
          <select value={narrowing.fileType} onChange={(event) => onNarrow({ ...narrowing, fileType: event.target.value })}>
            <option value="">Any type</option>
            {fileTypes.map((fileType) => <option key={fileType} value={fileType}>{fileType}</option>)}
          </select>
        </label>
        <label className="local-batch-checkbox">
          <input
            type="checkbox"
            checked={narrowing.sharedHashOnly}
            onChange={(event) => onNarrow({ ...narrowing, sharedHashOnly: event.target.checked })}
          />
          <span>Only files whose SHA-256 matches another here</span>
        </label>
        <small>
          These narrow what is listed. They never tick anything — which files belong together is your
          claim to make — and changing one clears the selection, so what you submit is always what is
          on screen.
        </small>
      </div>

      <div className="local-batch-selection">
        <button type="button" onClick={onSelectShown} disabled={shown.length === 0 || group.batchableActions.length === 0}>
          Select all {shown.length} shown
        </button>
        <button type="button" onClick={onClearSelection} disabled={selected.length === 0}>Clear selection</button>
        <small>{selectedRows.length} selected · you can batch up to {MAX_BATCH_ASSETS} files at a time — keep the set something you can actually look at.</small>
        {action === 'EXCLUDED' && blockedFromExclusion.length ? (
          <small className="local-batch-asset-message">
            {blockedFromExclusion.length === 1 ? 'One file here also stands' : `${blockedFromExclusion.length} files here also stand`}
            {' '}under another rule, so they cannot be excluded in a batch — excluding skips every
            other check the gate makes on a file. Exclude those individually, or mark them needs
            review here.
          </small>
        ) : null}
      </div>

      <ul className="local-batch-assets">
        {shown.length === 0 ? (
          <li className="local-monitor-empty"><FolderOpen size={18} /><strong>Nothing matches that narrowing</strong></li>
        ) : shown.map((asset) => {
          const notExcludable = action === 'EXCLUDED' && asset.alsoStandingCodes.length > 0;
          return (
            <li key={asset.scanAssetId}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(asset.scanAssetId)}
                  disabled={group.batchableActions.length === 0 || notExcludable}
                  onChange={() => onToggleAsset(asset.scanAssetId)}
                />
                <span>
                  <strong>{asset.fileName}</strong>
                  <small>{asset.relativePath}</small>
                </span>
              </label>
              <em data-state={asset.verification.toLowerCase()}>{titleCaseManifestValue(asset.verification)}</em>
              <em className="local-batch-decision">{titleCaseManifestValue(asset.decision)}</em>
              {asset.message !== group.message ? <small className="local-batch-asset-message">{asset.message}</small> : null}
              {/* Stated on the row rather than only in aggregate: this file is standing somewhere
                  else too, which is why a batch exclusion is withheld for it specifically. */}
              {asset.alsoStandingCodes.length ? (
                <small className="local-batch-asset-message">
                  Also stands under {asset.alsoStandingCodes.map(reviewGroupLabel).join(', ')}
                  {notExcludable ? ' — exclude this one individually, where the findings are.' : '.'}
                </small>
              ) : null}
            </li>
          );
        })}
      </ul>

      {group.batchableActions.length ? (
        <form className="local-decision-form local-batch-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset>
            <legend>What is being recorded</legend>
            {group.batchableActions.map((candidate) => (
              <label key={candidate} className="local-batch-radio">
                <input
                  type="radio"
                  name="local-batch-action"
                  value={candidate}
                  checked={action === candidate}
                  onChange={() => onAction(candidate)}
                />
                <span>{batchActionLabel(candidate)}</span>
              </label>
            ))}
            <small>
              Approving or blocking a file is a per-file call — open the file and record it there.
            </small>
          </fieldset>

          {action === 'SOURCE_EVIDENCE' ? (
            <>
              <label><span>Source</span><input value={sourceName} onChange={(event) => onSourceName(event.target.value)} placeholder="Provider, archive, or owner…" /></label>
              <label><span>License</span><input value={licenseName} onChange={(event) => onLicenseName(event.target.value)} placeholder="License or ownership basis…" /></label>
              <label><span>Evidence URL</span><input type="url" value={evidenceUrl} onChange={(event) => onEvidenceUrl(event.target.value)} placeholder="https://…" /></label>
            </>
          ) : null}

          <label>
            <span>Why do these files belong together?</span>
            <textarea
              required
              rows={3}
              value={rationale}
              onChange={(event) => onRationale(event.target.value)}
              placeholder="The one sentence that makes this a claim rather than a gesture…"
            />
          </label>

          {overCap ? (
            <small role="alert">
              That is more than {MAX_BATCH_ASSETS} files. Narrow by folder or type and do it in passes —
              the cap is there so the set stays something a person can actually look at.
            </small>
          ) : null}

          {confirming && action ? (
            <div className="local-batch-confirm">
              {batchConfirmationCopy(action, selectedRows.length).map((line) => <p key={line}>{line}</p>)}
              {/* The paths, not just the count. "Confirm what you are about to write" has to mean a
                  person can see which files it lands on; the 200-cap keeps this renderable, and it
                  scrolls past that. */}
              <ol className="local-batch-confirm-files">
                {selectedRows.map((asset) => <li key={asset.scanAssetId}>{asset.relativePath}</li>)}
              </ol>
              <div>
                <button className="button button-primary" type="button" disabled={submitting} onClick={onSubmit}>
                  {submitting ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Record this batch
                </button>
                <button type="button" onClick={onCancelConfirm} disabled={submitting}>Back</button>
              </div>
            </div>
          ) : (
            <button className="button button-secondary" type="button" disabled={!ready} onClick={onConfirm}>
              <Workflow size={14} /> Review what this writes
            </button>
          )}
        </form>
      ) : null}
    </div>
  );
}
