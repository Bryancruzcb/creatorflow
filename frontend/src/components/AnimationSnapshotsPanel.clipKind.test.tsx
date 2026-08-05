// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { AnimationSnapshotsPanel } from './AnimationSnapshotsPanel';
import type {
  LocalAnimationSnapshot,
  LocalBridgeClient,
  LocalMotionComparison,
  LocalProjectSummary,
} from '../bridge/localBridge';

function makeBridgeClient(snapshots: LocalAnimationSnapshot[] = []): LocalBridgeClient {
  const client = {
    listAnimationSnapshots: vi.fn().mockResolvedValue({ items: snapshots }),
    captureAnimationSnapshot: vi.fn(),
  };
  return client as unknown as LocalBridgeClient;
}

function snapshot(overrides: Partial<LocalAnimationSnapshot>): LocalAnimationSnapshot {
  return {
    id: 'snap-1', projectId: 1, assetId: '1001', kind: 'LAST_KNOWN_GOOD',
    sourceComparisonId: 'cmp-1', name: 'Walk', duration: 1,
    fingerprint: 'a'.repeat(64), algorithmVersion: 'creatorflow.motion-fingerprint/v1',
    supersedesSnapshotId: null, status: 'UNCHANGED', createdAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  };
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

/**
 * The one side card for a given asset ID, so a provenance assertion can name the side it
 * means. Document-wide text queries cannot tell the two sides apart, and a qualifier
 * rendered on the wrong side -- or on both -- is exactly the regression worth catching:
 * it would claim an exactly-read clip is an approximation.
 */
function sideFor(assetId: string): HTMLElement {
  const side = screen.getByText(new RegExp(`ID ${assetId}\\b`)).closest('.animation-snapshots-side');
  if (!side) throw new Error(`No side card rendered for asset ${assetId}`);
  return side as HTMLElement;
}

function pinButtonsIn(scope: HTMLElement): HTMLButtonElement[] {
  return within(scope).getAllByRole('button', { name: /last known good|last published/i }) as HTMLButtonElement[];
}

// vitest.config.ts does not enable `globals`, so Testing Library never registers its
// automatic afterEach cleanup and every render would otherwise pile up in the same
// document. The absence assertions below query the whole body, so a leftover render
// from a previous case would make them fail (or pass) for the wrong reason. Same
// explicit cleanup the LocalProjectWorkspace component tests use.
afterEach(() => {
  cleanup();
});

describe('AnimationSnapshotsPanel clip provenance', () => {
  // This case is a regression guard, not a RED/GREEN test: absent clip kind means
  // "behave exactly like before this feature existed," so both assertions are true
  // whether or not the provenance rendering has been added yet. It won't fail in the
  // RED step -- that's expected, unlike the CURVE_SAMPLED qualifier assertion below,
  // which does fail until the rendering lands.
  it('shows no provenance label and enables pinning when clip kind is absent', () => {
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({})} />);
    expect(screen.queryByText(/sampled from a curve/i)).toBeNull();
    const pinButtons = screen.getAllByRole('button', { name: /last known good|last published/i });
    expect(pinButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('qualifies only the CURVE_SAMPLED side, not the KEYFRAME one, while pinning stays enabled', () => {
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      sourceKind: 'CURVE_SAMPLED',
      candidateKind: 'KEYFRAME',
    })} />);
    // Asserted per side, not document-wide: the qualifier belongs to the sampled side alone.
    // getByText throws on a second match, so this also pins "once on that side"; the
    // document-wide count and the candidate's absence together rule out a source/candidate
    // mix-up and a qualifier leaking onto both sides.
    expect(within(sideFor('1001')).getByText(/sampled from a curve/i)).toBeTruthy();
    expect(within(sideFor('1002')).queryByText(/sampled from a curve/i)).toBeNull();
    expect(screen.getAllByText(/sampled from a curve/i)).toHaveLength(1);
    // Regression guard on the shipped-open configuration: the desktop bridge ships
    // CURVE_SAMPLED_SNAPSHOTS_ALLOWED = true (Task 0 measured sampling as deterministic),
    // so a sampled side is labeled honestly but still fully pinnable -- checked on the
    // sampled side itself. If the server guard is ever flipped shut, this flips with it.
    expect(pinButtonsIn(sideFor('1001')).every((button) => !button.disabled)).toBe(true);
  });

  it('leaves a KEYFRAME side fully pinnable', () => {
    render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
      sourceKind: 'KEYFRAME',
      candidateKind: 'KEYFRAME',
    })} />);
    expect(screen.queryByText(/sampled from a curve/i)).toBeNull();
    // "Fully pinnable" is the other half of the claim in this test's name: a directly-read
    // clip carries no qualifier AND nothing about its provenance disables pinning it.
    const pinButtons = screen.getAllByRole('button', { name: /last known good|last published/i });
    expect(pinButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });
});

/**
 * Issue #131: the pin was the only place that ever said "sampled". Once a side was pinned, the
 * resulting row in Current references looked exactly like one taken off an exact keyframe read —
 * and a later CHANGED verdict on it looked exactly as trustworthy. That matters because the one
 * residual risk the code documents (LocalBridgeServer's CURVE_SAMPLED_SNAPSHOTS_ALLOWED javadoc:
 * a Studio curve-evaluator change surfacing as CHANGED on untouched assets) lands on these rows
 * specifically. The row now carries the provenance the capture recorded.
 */
describe('AnimationSnapshotsPanel pinned-row provenance', () => {
  /** The Current references row for a snapshot, by the clip name it shows. */
  async function rowFor(name: string): Promise<HTMLElement> {
    const row = (await screen.findByText(name)).closest('.animation-snapshots-row');
    if (!row) throw new Error(`No snapshot row rendered for ${name}`);
    return row as HTMLElement;
  }

  it('says so on a row pinned from a sampled side', async () => {
    render(<AnimationSnapshotsPanel
      bridgeClient={makeBridgeClient([snapshot({ name: 'Walk', clipKind: 'CURVE_SAMPLED' })])}
      project={PROJECT}
      latestComparison={null}
    />);
    expect(within(await rowFor('Walk')).getByText(/sampled from a curve/i)).toBeTruthy();
  });

  it('leaves an exactly-read row unqualified', async () => {
    render(<AnimationSnapshotsPanel
      bridgeClient={makeBridgeClient([snapshot({ name: 'Walk', clipKind: 'KEYFRAME' })])}
      project={PROJECT}
      latestComparison={null}
    />);
    expect(within(await rowFor('Walk')).queryByText(/sampled from a curve/i)).toBeNull();
  });

  /**
   * The compatibility case, and the one worth being explicit about: every snapshot pinned before
   * this column existed reads back with no clip kind. Unknown provenance renders as no label at
   * all -- never as the exact-read treatment, which would be a claim the row cannot support.
   */
  it('renders a pre-existing row with no clip kind as unlabelled, not as exact', async () => {
    render(<AnimationSnapshotsPanel
      bridgeClient={makeBridgeClient([snapshot({ name: 'Walk' })])}
      project={PROJECT}
      latestComparison={null}
    />);
    const row = await rowFor('Walk');
    expect(within(row).queryByText(/sampled from a curve/i)).toBeNull();
    expect(row.textContent).not.toMatch(/exact/i);
  });

  it('qualifies only the sampled row when both kinds are listed', async () => {
    render(<AnimationSnapshotsPanel
      bridgeClient={makeBridgeClient([
        snapshot({ id: 'snap-1', name: 'Walk', assetId: '1001', clipKind: 'CURVE_SAMPLED' }),
        snapshot({ id: 'snap-2', name: 'Zip', assetId: '1002', clipKind: 'KEYFRAME' }),
      ])}
      project={PROJECT}
      latestComparison={null}
    />);
    expect(within(await rowFor('Walk')).getByText(/sampled from a curve/i)).toBeTruthy();
    expect(within(await rowFor('Zip')).queryByText(/sampled from a curve/i)).toBeNull();
    expect(screen.getAllByText(/sampled from a curve/i)).toHaveLength(1);
  });
});
