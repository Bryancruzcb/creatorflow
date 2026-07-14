import type { AnimationSnapshotKind, AnimationSnapshotStatus } from '../bridge/localBridge';

/** Human label for a snapshot's role. */
export function snapshotKindLabel(kind: AnimationSnapshotKind): string {
  return kind === 'LAST_KNOWN_GOOD' ? 'Last known good' : 'Last published';
}

/** Human label for how a snapshot compares to the asset's previous one of the same kind. */
export function snapshotStatusLabel(status: AnimationSnapshotStatus): string {
  switch (status) {
    case 'FIRST_SNAPSHOT':
      return 'First snapshot';
    case 'UNCHANGED':
      return 'Unchanged since last snapshot';
    case 'CHANGED':
      return 'Changed since last snapshot';
  }
}

/** Shortens a 64-hex fingerprint to a scannable prefix for display. */
export function formatSnapshotFingerprint(fingerprint: string): string {
  const hex = fingerprint.trim();
  return hex.length <= 12 ? hex : `${hex.slice(0, 12)}…`;
}

const KIND_ORDER: Record<AnimationSnapshotKind, number> = { LAST_KNOWN_GOOD: 0, LAST_PUBLISHED: 1 };

/** Orders snapshots for a stable panel: by animation name, then asset id, then kind. */
export function sortSnapshotsForDisplay<T extends { name: string; assetId: string; kind: AnimationSnapshotKind }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name)
    || a.assetId.localeCompare(b.assetId)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export type SnapshotTone = 'neutral' | 'positive' | 'warning';

/**
 * Review tone for a snapshot status. CHANGED is the one that warrants attention — the
 * animation drifted from its reference — so it maps to a warning; an unchanged re-capture
 * is reassuring, and a first capture is neutral.
 */
export function snapshotStatusTone(status: AnimationSnapshotStatus): SnapshotTone {
  switch (status) {
    case 'CHANGED':
      return 'warning';
    case 'UNCHANGED':
      return 'positive';
    case 'FIRST_SNAPSHOT':
      return 'neutral';
  }
}
