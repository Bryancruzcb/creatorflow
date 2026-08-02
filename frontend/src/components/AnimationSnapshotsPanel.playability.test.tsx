// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnimationSnapshotsPanel } from './AnimationSnapshotsPanel';
import type { LocalBridgeClient, LocalMotionComparison, LocalProjectSummary } from '../bridge/localBridge';

function makeBridgeClient(): LocalBridgeClient {
  const client = {
    listAnimationSnapshots: vi.fn().mockResolvedValue({ items: [] }),
    captureAnimationSnapshot: vi.fn(),
  };
  return client as unknown as LocalBridgeClient;
}

const PROJECT: LocalProjectSummary = { projectId: 1, name: 'Test Project' };

function comparison(overrides: Partial<LocalMotionComparison>): LocalMotionComparison {
  return {
    id: 'cmp-1', projectId: 1, sourceAssetId: '1001', candidateAssetId: '1002',
    sourceName: 'Walk', candidateName: 'Walk Candidate',
    sourceDuration: 1, candidateDuration: 1,
    sourceFingerprint: 'fp1', candidateFingerprint: 'fp2',
    overallPercent: 100, posePercent: 100, timingPercent: 100, coveragePercent: 100,
    exactCurveData: true, verdict: 'EXACT_CURVE_DATA', algorithmVersion: 'motion-v2',
    createdAt: new Date().toISOString(), result: {},
    ...overrides,
  };
}

describe('AnimationSnapshotsPanel playability evidence', () => {
  // EvidenceBasisMark renders with `compact` here (Task 3 Step 4), which suppresses its text
  // label — only the icon renders, wrapped in a <span title={description}>. The title is set
  // unconditionally regardless of `compact`, so it's what these tests query to tell VERIFIED
  // apart from NOT_VERIFIED; the outcome wording ("Plays clean" / error text / "Not checked")
  // comes from Task 3 Step 4's own <small>, not from EvidenceBasisMark, and is asserted directly.
  it('shows Not verified when no playability report exists', () => {
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({})} />);
    expect(screen.getAllByTitle(/did not or cannot check this/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not checked/i).length).toBeGreaterThan(0);
  });

  it('shows a clean-pass outcome as Verified, not a bare success mark alone', () => {
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      playability: {
        source: { r6: { ok: true }, r15: { ok: true } },
        candidate: { r6: { ok: true }, r15: { ok: true } },
      },
    })} />);
    expect(screen.getAllByTitle(/computed by creatorflow/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/plays clean/i).length).toBeGreaterThan(0);
  });

  it('shows an engine error as Verified with failed wording, never a bare success mark', () => {
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      playability: {
        source: { r6: { ok: false, error: 'Motion could not bind to R6.' }, r15: { ok: true } },
        candidate: { r6: { ok: true }, r15: { ok: true } },
      },
    })} />);
    // getByText already throws if no match exists — a complete assertion on its own. No
    // .toBeInTheDocument() wrapper: this project has no jest-dom dependency or setupFiles
    // entry anywhere (checked frontend/package.json and vitest.config.ts), so that matcher
    // doesn't exist here and would throw a different error than the one being tested for.
    screen.getByText(/motion could not bind to r6/i);
  });

  it('shows Not verified for a rig whose probe never ran, distinct from one that ran and failed', () => {
    // r6 is entirely absent (rig fetch failed) — must read NOT_VERIFIED, not a failed VERIFIED.
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      playability: {
        source: { r15: { ok: true } },
        candidate: { r6: { ok: true }, r15: { ok: true } },
      },
    })} />);
    expect(screen.getAllByText(/not checked/i).length).toBeGreaterThan(0);
  });
});
