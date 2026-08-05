import { AlertTriangle, Bookmark, Camera, History, RotateCcw, Share2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type AnimationSnapshotKind,
  type LocalAnimationSnapshot,
  type LocalBridgeClient,
  type LocalMotionComparison,
  type LocalProjectSummary,
  type LocalTeamStore,
} from '../bridge/localBridge';
import {
  formatSnapshotFingerprint,
  snapshotClipKindNote,
  snapshotKindLabel,
  snapshotStatusLabel,
  snapshotStatusTone,
  sortSnapshotsForDisplay,
} from '../motion/snapshots';
import { EvidenceBasisMark } from './EvidenceBasisMark';
import './AnimationSnapshotsPanel.css';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const KINDS: AnimationSnapshotKind[] = ['LAST_KNOWN_GOOD', 'LAST_PUBLISHED'];

// Mirrors CURVE_SAMPLED_SNAPSHOTS_ALLOWED in LocalBridgeServer.java: Task 0 confirmed
// curve sampling is deterministic (live Studio, 2026-08-02), so pinning sampled sides
// is allowed. If the server constant is ever flipped to false, flip this too so the
// UI doesn't offer an action the server will reject.
const CURVE_SAMPLED_PINNING_BLOCKED = false;

// Labeled example rows so the panel demonstrates itself in the browser preview (no desktop
// bridge). Deliberately shown under a "Sample preview" banner — never mistakable for real data.
const SAMPLE_SNAPSHOTS: LocalAnimationSnapshot[] = [
  {
    id: 'sample-1', projectId: 0, assetId: '1042', kind: 'LAST_KNOWN_GOOD', sourceComparisonId: null,
    name: 'courier_run', duration: 1.2, fingerprint: '9f3ac21b7e408d5c6a1f0b93e28d47aa5c9e1f30b7a248d16c05e9f4a1b2c3d4',
    algorithmVersion: 'creatorflow.motion-fingerprint/v1', supersedesSnapshotId: null,
    status: 'UNCHANGED', createdAt: '2026-07-12T18:04:00.000Z',
  },
  {
    id: 'sample-2', projectId: 0, assetId: '1042', kind: 'LAST_PUBLISHED', sourceComparisonId: null,
    name: 'courier_run', duration: 1.3, fingerprint: '2b81ce09aa7743f1e0d6b5928c4471fa8d3021b9e7645c8a0f19d2b3c4e5f607',
    algorithmVersion: 'creatorflow.motion-fingerprint/v1', supersedesSnapshotId: null,
    status: 'CHANGED', createdAt: '2026-07-13T09:20:00.000Z',
  },
  {
    id: 'sample-3', projectId: 0, assetId: '1088', kind: 'LAST_KNOWN_GOOD', sourceComparisonId: null,
    name: 'harbor_walk', duration: 0.94, fingerprint: 'c704f1a29b83d05e6172a4b8093c5d71fe28a09b3c4d5e6f7a8b9c0d1e2f3a4b',
    algorithmVersion: 'creatorflow.motion-fingerprint/v1', supersedesSnapshotId: null,
    status: 'FIRST_SNAPSHOT', createdAt: '2026-07-13T11:47:00.000Z',
  },
];

function SnapshotExplainer() {
  return (
    <div className="animation-snapshots-explainer">
      <p>
        A snapshot freezes an animation's curve fingerprint at a moment, so later you can prove
        whether the clip changed. Re-pin it and CreatorFlow says whether it's <em>unchanged</em> or
        has <em>drifted</em>.
      </p>
      <dl>
        <div><dt>Last known good</dt><dd>a version you've reviewed and trust</dd></div>
        <div><dt>Last published</dt><dd>the version you handed off to Studio</dd></div>
      </dl>
    </div>
  );
}

function SnapshotRow({ snapshot, share }: {
  snapshot: LocalAnimationSnapshot;
  /** Absent on the sample preview, where there is nothing real to share. */
  share?: { onShare: (snapshot: LocalAnimationSnapshot) => void; disabledReason: string | null };
}) {
  // Carried on the row itself rather than looked up through sourceComparisonId, so a reference
  // says how it was read wherever it is shown — including after the comparison it came from has
  // scrolled out of the session.
  const clipKindNote = snapshotClipKindNote(snapshot.clipKind);
  return (
    <li className="animation-snapshots-row" data-kind={snapshot.kind}>
      <div className="animation-snapshots-row-main">
        <strong>{snapshot.name}</strong>
        <small>
          ID {snapshot.assetId} · {snapshotKindLabel(snapshot.kind)}
          {clipKindNote ? <> · <span className="animation-snapshots-row-sampled">{clipKindNote}</span></> : null}
        </small>
      </div>
      <span className={`animation-snapshots-status tone-${snapshotStatusTone(snapshot.status)}`}>
        {snapshotStatusLabel(snapshot.status)}
      </span>
      <code title={snapshot.fingerprint}>{formatSnapshotFingerprint(snapshot.fingerprint)}</code>
      <time dateTime={snapshot.createdAt}>{new Date(snapshot.createdAt).toLocaleString()}</time>
      {share ? (
        <button
          type="button"
          className="animation-snapshots-share"
          // Disabled with the actual reason in the tooltip rather than an unexplained grey
          // button. Nothing is ever uploaded automatically, so this is the only way out.
          title={share.disabledReason ?? 'Review exactly what would be shared, then confirm.'}
          disabled={share.disabledReason !== null}
          onClick={() => share.onShare(snapshot)}
        >
          <Share2 size={12} /> Share to team
        </button>
      ) : null}
    </li>
  );
}

/**
 * The confirmation dialog: an itemised list of everything that would leave this machine, and an
 * equally explicit list of what would not.
 *
 * This is the disclosure, and it is why sharing is a per-snapshot button rather than a setting.
 * The four VERIFIED values are shown as the exact values that will travel — the fingerprint in
 * full, not truncated — because "you are about to publish this string" is the fact a person is
 * actually consenting to. The declared fields are optional and start empty: nothing is
 * pre-filled, so nothing is shared by inattention.
 */
function ShareDialog({ snapshot, teamName, busy, error, onCancel, onConfirm }: {
  snapshot: LocalAnimationSnapshot;
  teamName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (declared: {
    robloxAssetId: number | null;
    ownershipContext: string | null;
    declaredSource: string | null;
    declaredLicense: string | null;
    declaredNote: string | null;
  }) => void;
}) {
  const [robloxAssetId, setRobloxAssetId] = useState('');
  const [ownershipContext, setOwnershipContext] = useState('');
  const [declaredSource, setDeclaredSource] = useState('');
  const [declaredLicense, setDeclaredLicense] = useState('');
  const [declaredNote, setDeclaredNote] = useState('');

  const trimmed = (value: string) => (value.trim().length === 0 ? null : value.trim());
  const parsedAssetId = Number.parseInt(robloxAssetId.trim(), 10);

  return (
    <div className="animation-snapshots-share-dialog" role="dialog" aria-label="Share to team">
      <h3>Share this fingerprint with {teamName}?</h3>

      <p className="animation-snapshots-share-lead">
        Sharing records that <strong>you</strong> have a curve with this fingerprint. It is an
        observation, not a claim of authorship, and it carries no score or verdict.
      </p>

      <dl className="animation-snapshots-share-manifest">
        <div><dt>Curve fingerprint</dt><dd><code>{snapshot.fingerprint}</code></dd></div>
        <div><dt>Fingerprint version</dt><dd>{snapshot.algorithmVersion}</dd></div>
        <div><dt>Clip name</dt><dd>{snapshot.name}</dd></div>
        <div><dt>Duration</dt><dd>{snapshot.duration.toFixed(2)}s</dd></div>
      </dl>

      <p className="animation-snapshots-share-excluded">
        <strong>Not shared:</strong> the curves themselves, any file, any scan path, any folder
        name on this machine, and anything about your other snapshots.
      </p>

      <fieldset className="animation-snapshots-share-declared">
        <legend>Optional — anything you type here is shared too, attributed to you</legend>
        <label>Roblox asset ID
          <input value={robloxAssetId} onChange={(e) => setRobloxAssetId(e.target.value)} inputMode="numeric" />
        </label>
        <label>Ownership context
          <input value={ownershipContext} onChange={(e) => setOwnershipContext(e.target.value)} placeholder="group:12345" />
        </label>
        <label>Source
          <input value={declaredSource} onChange={(e) => setDeclaredSource(e.target.value)} placeholder="Where it came from" />
        </label>
        <label>License
          <input value={declaredLicense} onChange={(e) => setDeclaredLicense(e.target.value)} />
        </label>
        <label>Note
          <input value={declaredNote} onChange={(e) => setDeclaredNote(e.target.value)} />
        </label>
      </fieldset>

      <p className="animation-snapshots-share-retract">
        You can retract this later, which removes it from future lookups. It cannot recall a copy a
        teammate already read.
      </p>

      {error ? <p className="animation-snapshots-error" role="status">{error}</p> : null}

      <div className="animation-snapshots-share-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          type="button"
          className="animation-snapshots-share-confirm"
          disabled={busy}
          onClick={() => onConfirm({
            robloxAssetId: Number.isFinite(parsedAssetId) && parsedAssetId > 0 ? parsedAssetId : null,
            ownershipContext: trimmed(ownershipContext),
            declaredSource: trimmed(declaredSource),
            declaredLicense: trimmed(declaredLicense),
            declaredNote: trimmed(declaredNote),
          })}
        >
          {busy ? 'Sharing…' : 'Share to team'}
        </button>
      </div>
    </div>
  );
}

/** Why the share button is off, in words, or `null` when it is available. */
export function shareDisabledReason(store: LocalTeamStore | null): string | null {
  if (!store || !store.configured) {
    return 'No team provenance store is connected. Set one up in the desktop Settings page.';
  }
  if (store.status !== 'OK') {
    return 'The team provenance store could not be reached, so nothing can be shared right now.';
  }
  return null;
}

/**
 * The live references for a project's animations: the newest last-known-good and last-published
 * snapshot per asset, and a way to pin a fresh one from the latest Studio comparison. Snapshots
 * are immutable, so re-pinning an unchanged animation is recorded as UNCHANGED and a drifted one
 * as CHANGED. Without a desktop bridge it shows a clearly-labeled sample preview.
 */
export function AnimationSnapshotsPanel({ bridgeClient, project, latestComparison }: {
  bridgeClient: LocalBridgeClient | null;
  project: LocalProjectSummary | null;
  latestComparison?: LocalMotionComparison | null;
}) {
  const [snapshots, setSnapshots] = useState<LocalAnimationSnapshot[]>([]);
  const [state, setState] = useState<LoadState>('idle');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamStore, setTeamStore] = useState<LocalTeamStore | null>(null);
  const [sharing, setSharing] = useState<LocalAnimationSnapshot | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<string | null>(null);

  useEffect(() => {
    if (!bridgeClient) {
      setTeamStore(null);
      return undefined;
    }
    let cancelled = false;
    // Wrapped in Promise.resolve so a bridge build without this route — or a test double that
    // does not stub it — degrades to "no store", i.e. the share button is off with a reason,
    // rather than throwing on render. Never assumed present.
    Promise.resolve()
      .then(() => bridgeClient.getTeamStore())
      .then((store) => { if (!cancelled) setTeamStore(store); })
      .catch(() => { if (!cancelled) setTeamStore(null); });
    return () => { cancelled = true; };
  }, [bridgeClient]);

  const refresh = useCallback(() => {
    if (!bridgeClient || !project) {
      setSnapshots([]);
      setState('idle');
      return;
    }
    setState('loading');
    bridgeClient.listAnimationSnapshots(project.projectId)
      .then((page) => { setSnapshots(sortSnapshotsForDisplay(page.items)); setState('ready'); })
      .catch(() => setState('error'));
  }, [bridgeClient, project]);

  useEffect(() => { refresh(); }, [refresh]);

  async function pin(side: 'source' | 'candidate', kind: AnimationSnapshotKind) {
    if (!bridgeClient || !project || !latestComparison) return;
    setBusy(`${side}:${kind}`);
    setError(null);
    try {
      await bridgeClient.captureAnimationSnapshot(project.projectId, {
        comparisonId: latestComparison.id, side, kind,
      });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not pin the snapshot.');
    } finally {
      setBusy(null);
    }
  }

  async function confirmShare(declared: {
    robloxAssetId: number | null;
    ownershipContext: string | null;
    declaredSource: string | null;
    declaredLicense: string | null;
    declaredNote: string | null;
  }) {
    if (!bridgeClient || !sharing) return;
    setSharingBusy(true);
    setShareError(null);
    try {
      const result = await bridgeClient.shareProvenanceClaim({ snapshotId: sharing.id, ...declared });
      setSharing(null);
      // "Already shared" and "already shared with different text" are different outcomes, and the
      // second one has to say that the new text was NOT recorded — an append-only row is never
      // quietly overwritten, and a bare success here would leave a person believing it was.
      setShareResult(!result.alreadyShared
        ? `Shared “${sharing.name}” with your team.`
        : result.declarationsDiffer
          ? 'Already shared — retract to change. What you typed was not recorded over the existing claim.'
          : 'Already shared. Nothing changed.');
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : 'Could not share that snapshot.');
    } finally {
      setSharingBusy(false);
    }
  }

  if (!bridgeClient || !project) {
    return (
      <div className="animation-snapshots">
        <SnapshotExplainer />
        <div className="animation-snapshots-sample">
          <div className="animation-snapshots-sample-head">
            <span className="animation-snapshots-sample-tag"><Camera size={13} /> Sample preview</span>
            <small>Illustrative records, not your team store — connect the desktop app to pin your own.</small>
          </div>
          <ul className="animation-snapshots-list">
            {SAMPLE_SNAPSHOTS.map((snapshot) => <SnapshotRow key={snapshot.id} snapshot={snapshot} />)}
          </ul>
          <p className="animation-snapshots-sample-read">
            Read it like this: <strong>courier_run</strong>'s published version has <em>drifted</em> from
            its last-known-good, while <strong>harbor_walk</strong> was just pinned for the first time.
          </p>
        </div>
        <div className="animation-snapshots-disconnected">
          <AlertTriangle size={16} />
          <span>
            <strong>Desktop bridge not connected.</strong>
            <small>Launch the CreatorFlow desktop app and open a local project to pin real last-known-good and last-published snapshots.</small>
          </span>
        </div>
      </div>
    );
  }

  const canPin = Boolean(latestComparison);

  return (
    <div className="animation-snapshots">
      <SnapshotExplainer />

      <div className="animation-snapshots-capture">
        <header>
          <span><Bookmark size={14} /> Pin a reference</span>
          <small>{canPin ? 'From the latest Studio comparison' : 'Waiting for a Studio comparison to pin from'}</small>
        </header>
        {canPin && latestComparison ? (
          <div className="animation-snapshots-sides">
            {([
              { side: 'source' as const, label: 'Reference', id: latestComparison.sourceAssetId, name: latestComparison.sourceName },
              { side: 'candidate' as const, label: 'Candidate', id: latestComparison.candidateAssetId, name: latestComparison.candidateName },
            ]).map((clip) => {
              const clipKind = clip.side === 'source' ? latestComparison?.sourceKind : latestComparison?.candidateKind;
              const sampledAndBlocked = CURVE_SAMPLED_PINNING_BLOCKED && clipKind === 'CURVE_SAMPLED';
              return (
                <div className="animation-snapshots-side" key={clip.side}>
                  <div className="animation-snapshots-side-id">
                    <strong>{clip.name}</strong>
                    <small>{clip.label} · ID {clip.id}</small>
                  </div>
                  {clipKind === 'CURVE_SAMPLED' ? (
                    <p className="animation-snapshots-sampled-note">Sampled from a curve — not an exact read.</p>
                  ) : null}
                  {(() => {
                    const report = latestComparison?.playability?.[clip.side];
                    const binding = latestComparison?.rigBinding?.[clip.side];
                    return (
                      <div className="animation-snapshots-side-playability">
                        {(['r6', 'r15'] as const).map((rig) => {
                          const rigResult = report?.[rig];
                          const rigBinding = binding?.[rig];
                          return (
                            <div key={rig} className="animation-snapshots-playability-rig">
                              <div className="animation-snapshots-playability-row">
                                <span className="animation-snapshots-playability-label">{rig.toUpperCase()}</span>
                                <EvidenceBasisMark basis={rigResult ? 'VERIFIED' : 'NOT_VERIFIED'} compact />
                                <small>
                                  {!rigResult
                                    ? 'Not checked'
                                    : rigResult.ok
                                      ? 'Plays clean'
                                      : rigResult.error ?? 'Playback error'}
                                </small>
                              </div>
                              {/*
                                * Deliberately a second line under the probe's own, never folded into
                                * it: "it loaded" and "most of it binds to this rig" are separate
                                * facts from separate sources, and a clip can pass the first while
                                * failing the second — the whole reason this check exists. Nothing
                                * renders when the check has nothing to say (an older comparison, or
                                * a clip with no channels at all).
                                */}
                              {rigBinding && rigBinding.channels > 0 ? (
                                <small
                                  className={rigBinding.warn
                                    ? 'animation-snapshots-bind is-warning'
                                    : 'animation-snapshots-bind'}
                                  title={rigBinding.unboundJoints.length > 0
                                    ? `No joint on this rig for: ${rigBinding.unboundJoints.join(', ')}`
                                    : undefined}
                                >
                                  {rigBinding.warn
                                    ? `Only ${rigBinding.boundPercent}% of channels bind to this rig (${rigBinding.boundChannels} of ${rigBinding.channels})`
                                    : `${rigBinding.boundChannels} of ${rigBinding.channels} channels bind to this rig`}
                                </small>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  <div className="animation-snapshots-side-actions">
                    {KINDS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        disabled={busy !== null || sampledAndBlocked}
                        title={sampledAndBlocked ? "Sampled data isn't stable enough to detect drift reliably yet." : undefined}
                        onClick={() => { void pin(clip.side, kind); }}
                      >
                        {busy === `${clip.side}:${kind}` ? 'Pinning…' : snapshotKindLabel(kind)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="animation-snapshots-empty">Run a comparison from the Studio bridge above, then pin its reference or candidate as a snapshot.</p>
        )}
        {error ? <p className="animation-snapshots-error" role="status">{error}</p> : null}
      </div>

      <div className="animation-snapshots-list-head">
        <span><History size={14} /> Current references</span>
        <button type="button" className="animation-snapshots-refresh" onClick={refresh} aria-label="Refresh snapshots">
          <RotateCcw size={13} /> Refresh
        </button>
      </div>

      {state === 'error' ? (
        <p className="animation-snapshots-empty">Could not load snapshots from the desktop bridge.</p>
      ) : snapshots.length === 0 ? (
        <p className="animation-snapshots-empty">No snapshots yet. Pin a reference above to start tracking whether an animation drifts.</p>
      ) : (
        <ul className="animation-snapshots-list">
          {snapshots.map((snapshot) => (
            <SnapshotRow
              key={snapshot.id}
              snapshot={snapshot}
              share={{
                onShare: (target) => { setShareResult(null); setShareError(null); setSharing(target); },
                disabledReason: shareDisabledReason(teamStore),
              }}
            />
          ))}
        </ul>
      )}

      {shareResult ? <p className="animation-snapshots-share-result" role="status">{shareResult}</p> : null}

      {sharing ? (
        <ShareDialog
          snapshot={sharing}
          teamName={teamStore?.teamName ?? 'your team'}
          busy={sharingBusy}
          error={shareError}
          onCancel={() => { setSharing(null); setShareError(null); }}
          onConfirm={(declared) => { void confirmShare(declared); }}
        />
      ) : null}
    </div>
  );
}
