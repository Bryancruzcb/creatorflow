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
