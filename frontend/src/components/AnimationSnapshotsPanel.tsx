import { AlertTriangle, Bookmark, Camera, History, RotateCcw } from 'lucide-react';
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

function SnapshotRow({ snapshot }: { snapshot: LocalAnimationSnapshot }) {
  return (
    <li className="animation-snapshots-row" data-kind={snapshot.kind}>
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
  );
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

  if (!bridgeClient || !project) {
    return (
      <div className="animation-snapshots">
        <SnapshotExplainer />
        <div className="animation-snapshots-sample">
          <div className="animation-snapshots-sample-head">
            <span className="animation-snapshots-sample-tag"><Camera size={13} /> Sample preview</span>
            <small>Example rows — connect the desktop app to pin your own.</small>
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
          {snapshots.map((snapshot) => <SnapshotRow key={snapshot.id} snapshot={snapshot} />)}
        </ul>
      )}
    </div>
  );
}
