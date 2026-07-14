import { AlertTriangle, Bookmark, History, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  type AnimationSnapshotKind,
  type LocalAnimationSnapshot,
  type LocalBridgeClient,
  type LocalMotionComparison,
  type LocalProjectSummary,
} from '../bridge/localBridge';
import {
  formatSnapshotFingerprint,
  snapshotKindLabel,
  snapshotStatusLabel,
  snapshotStatusTone,
  sortSnapshotsForDisplay,
} from '../motion/snapshots';
import './AnimationSnapshotsPanel.css';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const KINDS: AnimationSnapshotKind[] = ['LAST_KNOWN_GOOD', 'LAST_PUBLISHED'];

/**
 * The live references for a project's animations: the newest last-known-good and last-published
 * snapshot per asset, and a way to pin a fresh one from the latest Studio comparison. Snapshots
 * are immutable, so re-pinning an unchanged animation is recorded as UNCHANGED and a drifted one
 * as CHANGED — the panel surfaces that so a reviewer can see at a glance whether a clip moved
 * since it was vouched for or shipped.
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
    const key = `${side}:${kind}`;
    setBusy(key);
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

  if (!bridgeClient || !project) {
    return (
      <div className="animation-snapshots animation-snapshots-disconnected">
        <AlertTriangle size={16} />
        <span>
          <strong>Desktop bridge not connected.</strong>
          <small>Launch the CreatorFlow desktop app and open a local project to pin last-known-good and last-published animation snapshots.</small>
        </span>
      </div>
    );
  }

  const canPin = Boolean(latestComparison);

  return (
    <div className="animation-snapshots">
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
            ]).map((clip) => (
              <div className="animation-snapshots-side" key={clip.side}>
                <div className="animation-snapshots-side-id">
                  <strong>{clip.name}</strong>
                  <small>{clip.label} · ID {clip.id}</small>
                </div>
                <div className="animation-snapshots-side-actions">
                  {KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => { void pin(clip.side, kind); }}
                    >
                      {busy === `${clip.side}:${kind}` ? 'Pinning…' : snapshotKindLabel(kind)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
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
            <li className="animation-snapshots-row" key={snapshot.id} data-kind={snapshot.kind}>
              <div className="animation-snapshots-row-main">
                <strong>{snapshot.name}</strong>
                <small>ID {snapshot.assetId} · {snapshotKindLabel(snapshot.kind)}</small>
              </div>
              <span className={`animation-snapshots-status tone-${snapshotStatusTone(snapshot.status)}`}>
                {snapshotStatusLabel(snapshot.status)}
              </span>
              <code title={snapshot.fingerprint}>{formatSnapshotFingerprint(snapshot.fingerprint)}</code>
              <time dateTime={snapshot.createdAt}>{new Date(snapshot.createdAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
