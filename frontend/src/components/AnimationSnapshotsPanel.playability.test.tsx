// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnimationSnapshotsPanel } from './AnimationSnapshotsPanel';
import type { LocalBridgeClient, LocalMotionComparison, LocalProjectSummary, RigBinding } from '../bridge/localBridge';

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

describe('AnimationSnapshotsPanel rig binding evidence', () => {
  function binding(overrides: Partial<RigBinding>): RigBinding {
    return { rig: 'R6', channels: 16, boundChannels: 16, boundPercent: 100, warn: false, unboundJoints: [], ...overrides };
  }

  function bothSides(r6: RigBinding, r15: RigBinding) {
    return { source: { r6, r15 }, candidate: { r6, r15 } };
  }

  it('warns when most of the clip binds to nothing on a rig, beside a clean probe result', () => {
    // The exact case issue #122 is about: the live probe says the clip plays, and it does — on two
    // of sixteen channels. Both statements have to be on the row at once, or "Plays clean" reads as
    // "this animation works on R6".
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      playability: {
        source: { r6: { ok: true }, r15: { ok: true } },
        candidate: { r6: { ok: true }, r15: { ok: true } },
      },
      rigBinding: bothSides(
        binding({ rig: 'R6', boundChannels: 2, boundPercent: 12, warn: true, unboundJoints: ['LeftUpperArm', 'LeftHand'] }),
        binding({ rig: 'R15' }),
      ),
    })} />);
    expect(screen.getAllByText(/plays clean/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/only 12% of channels bind/i).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(/LeftUpperArm/).length).toBeGreaterThan(0);
  });

  it('states the binding fraction without a warning when the clip fits the rig', () => {
    // Scoped to this render's own container: there is no setupFiles entry and so no RTL auto-
    // cleanup in this project, and a `screen`-wide negative assertion would be answered by an
    // earlier test's leftover DOM instead of this one's.
    const { container } = render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      rigBinding: bothSides(binding({ rig: 'R6' }), binding({ rig: 'R15' })),
    })} />);
    expect(within(container).getAllByText(/16 of 16 channels bind/i).length).toBeGreaterThan(0);
    expect(within(container).queryByText(/only .* of channels bind/i)).toBeNull();
  });

  it('reports binding even when no live probe ran at all', () => {
    // The structural check needs no rig asset and no Studio, so a plugin whose RIG_ASSET_IDS are
    // still placeholders produces no playability report and this evidence anyway. If this ever
    // regressed to "only shown beside a probe", the check would be dark on every install today.
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      rigBinding: bothSides(
        binding({ rig: 'R6', boundChannels: 2, boundPercent: 28, warn: true, unboundJoints: ['Left Arm'] }),
        binding({ rig: 'R15', boundChannels: 2, boundPercent: 28, warn: true, unboundJoints: ['Left Arm'] }),
      ),
    })} />);
    expect(screen.getAllByText(/not checked/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/only 28% of channels bind/i).length).toBeGreaterThan(0);
  });

  it('says nothing about a comparison stored before the check existed', () => {
    const { container } = render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({})} />);
    expect(within(container).queryByText(/channels bind/i)).toBeNull();
  });
});
