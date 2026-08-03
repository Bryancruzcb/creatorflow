// @vitest-environment jsdom
//
// Component test for the gate-check panel inside LocalReleasesView (LocalProjectWorkspace.tsx).
// The jsdom environment is scoped per file here, not globally — the same convention
// LocalProjectWorkspace.decisionFlow.test.tsx established, and for the same reason: this module's
// graph is narrow (lucide-react, ../bridge/evidenceBasis, ./EvidenceBasisMark, ../manifest/manifest)
// and pulls in neither three.js nor MotionComparisonLab, so rendering it is cheap.
//
// What these assert is mostly what must NOT appear. The structural risk in a jumpable checklist is
// that it becomes a place to clear violations from — so the tests check that no decision control is
// rendered in a row, that nothing reads as resolved or passed while violations stand, and that a
// stale check refuses to navigate rather than guessing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { LocalEvidenceView, LocalReleasesView, type LocalGateAffordance, type LocalGateResolution } from './LocalProjectWorkspace';
import type {
  LocalAssetDetail,
  LocalBridgeClient,
  LocalGatePreview,
  LocalGateViolation,
  LocalProjectSummary,
  LocalScanAsset,
  LocalScanRun,
} from '../bridge/localBridge';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project: LocalProjectSummary = { projectId: 9, name: 'Test Project' };

const run: LocalScanRun = {
  id: 'run-abc',
  projectId: project.projectId,
  release: 'Working',
  state: 'COMPLETED',
  discoveredCount: 3,
  processedCount: 3,
  bytesProcessed: 4096,
  supportedCount: 3,
  ignoredCount: 0,
  excludedCount: 0,
  unreadableCount: 0,
  missingDependencyCount: 0,
  failedCount: 0,
  warnings: [],
  error: null,
  createdAt: '2026-08-02T20:00:00Z',
  startedAt: '2026-08-02T20:00:01Z',
  completedAt: '2026-08-02T20:00:09Z',
};

function violation(overrides: Partial<LocalGateViolation> = {}): LocalGateViolation {
  return {
    code: 'UNRESOLVED_SOURCE',
    path: 'art/hero.png',
    verification: 'CLEAR',
    decision: 'PENDING',
    message: 'Source and license evidence must be resolved or the asset excluded',
    scanAssetId: 501,
    ...overrides,
  };
}

function preview(violations: LocalGateViolation[], overrides: Partial<LocalGatePreview> = {}): LocalGatePreview {
  return {
    scanRunId: run.id,
    release: 'Working',
    evaluatedAt: '2026-08-02T21:14:03Z',
    passed: violations.length === 0,
    summary: {
      assets: 3,
      violations: violations.length,
      blockedAssets: 0,
      unresolvedAssets: violations.filter((item) => item.code === 'UNRESOLVED_SOURCE').length,
      flaggedWithoutApproval: violations.filter((item) => item.code === 'FLAGGED_WITHOUT_APPROVAL').length,
      ownershipMismatchWithoutDecision: 0,
    },
    violations,
    ...overrides,
  };
}

/** A plain object implementing only what LocalReleasesView actually calls, matching real signatures. */
function makeMockClient(overrides: Partial<Record<'listProjectReleases' | 'previewGate' | 'createRelease',
  ReturnType<typeof vi.fn>>> = {}) {
  const client = {
    listProjectReleases: vi.fn().mockResolvedValue({ items: [] }),
    previewGate: vi.fn(),
    createRelease: vi.fn(),
    releaseManifestUrl: (releaseId: string) => `/api/v1/releases/${releaseId}/manifest`,
    ...overrides,
  };
  return client as unknown as LocalBridgeClient;
}

/**
 * Renders the view with the shell state it normally receives, and re-renders on change — the
 * checklist lives in ProductWorkspaceContent so it survives the trip to Evidence and back, so a
 * test that held it inside the view would be testing something the product does not do.
 */
function renderReleases(client: LocalBridgeClient, options: {
  scanRun?: LocalScanRun | null;
  onOpenAsset?: (assetId: number, affordance: LocalGateAffordance) => void;
} = {}) {
  const onOpenAsset = options.onOpenAsset ?? vi.fn();
  const scanRun = options.scanRun === undefined ? run : options.scanRun;
  function Harness() {
    const [resolution, setResolution] = useState<LocalGateResolution | null>(null);
    return (
      <LocalReleasesView
        client={client}
        project={project}
        run={scanRun}
        gateResolution={resolution}
        onGateResolutionChange={setResolution}
        onOpenAsset={onOpenAsset}
      />
    );
  }
  return { onOpenAsset, ...render(<Harness />) };
}

describe('LocalGateCheckPanel inside LocalReleasesView', () => {
  it('says nothing about the gate until a check has actually run', async () => {
    const client = makeMockClient();
    renderReleases(client);

    await screen.findByRole('button', { name: /run gate check/i });
    // An unchecked project must not read as a clear one.
    expect(screen.getByText(/not checked yet/i)).toBeTruthy();
    expect(client.previewGate).not.toHaveBeenCalled();
  });

  it('renders the gate’s own violations, grouped, with the gate’s message verbatim and the true count', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([
      violation({ code: 'BLOCKED_DECISION', path: 'art/logo.png', decision: 'BLOCKED', scanAssetId: 400, message: 'A BLOCKED decision always prevents release' }),
      violation({ code: 'UNRESOLVED_SOURCE', path: 'art/hero.png', scanAssetId: 501 }),
      violation({ code: 'FLAGGED_WITHOUT_APPROVAL', path: 'art/hero.png', verification: 'SIMILAR', scanAssetId: 501, message: 'SIMILAR and DUPLICATE assets require APPROVED or EXCLUDED' }),
    ]));
    const client = makeMockClient({ previewGate });
    renderReleases(client);

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    await waitFor(() => expect(previewGate).toHaveBeenCalledWith(project.projectId, run.id));

    // Groups in the gate's own enum order, so the checklist can be traced back to ReleaseGate.
    const headings = await screen.findAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toContain('See what is blocking, without minting a release.');
    expect(screen.getByText('Blocked on purpose')).toBeTruthy();
    expect(screen.getByText('Source and license not recorded')).toBeTruthy();
    expect(screen.getByText('Flagged, with no approval or exclusion')).toBeTruthy();

    // Verbatim gate messages, never reworded by the workspace.
    expect(screen.getByText('A BLOCKED decision always prevents release')).toBeTruthy();
    expect(screen.getByText('SIMILAR and DUPLICATE assets require APPROVED or EXCLUDED')).toBeTruthy();

    // The count comes from the server summary, and one file standing twice is said out loud rather
    // than merged away.
    expect(screen.getByText('3 standing')).toBeTruthy();
    expect(screen.getAllByText(/2 open items on this file/)).toHaveLength(2);
  });

  it('jumps to the right asset and the right affordance, and never offers a decision in a row', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([
      violation({ code: 'UNRESOLVED_SOURCE', path: 'art/hero.png', scanAssetId: 501 }),
      violation({ code: 'OWNERSHIP_MISMATCH_WITHOUT_DECISION', path: 'art/rig.rbxm', scanAssetId: 777, message: 'The Roblox animation ID entered for this file has a creator who is not the owner of the target experience' }),
    ]));
    const onOpenAsset = vi.fn();
    renderReleases(makeMockClient({ previewGate }), { onOpenAsset });

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    const jumps = await screen.findAllByRole('button', { name: /open evidence/i });
    expect(jumps).toHaveLength(2);

    await userEvent.click(jumps[0]);
    expect(onOpenAsset).toHaveBeenCalledWith(501, 'source');
    await userEvent.click(jumps[1]);
    // The ownership panel, not the decision form: the facts come before the call.
    expect(onOpenAsset).toHaveBeenCalledWith(777, 'ownership');

    /**
     * The structural guardrail. Resolving has to happen in the evidence view with the findings,
     * hash, source record, ownership verdict and decision history rendered around the form — a
     * decision control inside a checklist row would make this a machine for clearing violations
     * without looking at any of that.
     */
    const panel = screen.getByRole('region', { name: /see what is blocking/i });
    expect(within(panel).queryByRole('combobox')).toBeNull();
    expect(within(panel).queryByRole('button', { name: /approve/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /exclude/i })).toBeNull();

    // And no pass tone while anything stands. The counter says what stands, never that anything
    // was resolved — the only "resolved" on screen is inside the gate's own message, rendered
    // verbatim, which is the gate's word and not a claim the workspace made.
    expect(within(panel).getByText('2 standing').textContent).not.toMatch(/resolved/i);
    expect(within(panel).queryByText(/nothing was standing at the gate/i)).toBeNull();
    expect(within(panel).getByText('BLOCKED')).toBeTruthy();
  });

  it('shows a violation it cannot map to an asset, with the jump withheld and the reason stated', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([
      violation({ path: 'art/vanished.png', scanAssetId: null }),
    ]));
    renderReleases(makeMockClient({ previewGate }));

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    await screen.findByText('art/vanished.png');
    // Never a guessed id: a wrong jump would put a decision on the wrong file.
    expect(screen.queryByRole('button', { name: /open evidence/i })).toBeNull();
    expect(screen.getByText(/not in this scan’s asset list/i)).toBeTruthy();
    // And it is still counted — dropping it would under-report a block.
    expect(screen.getByText('1 standing')).toBeTruthy();
  });

  it('renders a code it does not recognise instead of dropping it', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([
      violation({ code: 'SOME_FUTURE_RULE', path: 'art/new.png', message: 'A rule this build has never heard of' }),
    ]));
    renderReleases(makeMockClient({ previewGate }));

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    expect(await screen.findByText('Other gate rules')).toBeTruthy();
    expect(screen.getByText('A rule this build has never heard of')).toBeTruthy();
    expect(screen.getByText('1 standing')).toBeTruthy();
  });

  it('disables every jump when the check is against a superseded scan, and says why', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([violation()], { scanRunId: 'run-older' }));
    renderReleases(makeMockClient({ previewGate }));

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    const jump = await screen.findByRole('button', { name: /open evidence/i }) as HTMLButtonElement;
    // Old runs' asset rows are never deleted, so a stale jump would open a real, stale file with
    // nothing to warn a person — the guard has to run before the jump, not after.
    expect(jump.disabled).toBe(true);
    expect(screen.getByText(/this check is against an older scan/i)).toBeTruthy();
    expect(screen.getByText(/decisions recorded against the previous run stay with that run/i)).toBeTruthy();
  });

  it('keeps the earlier result, with its own timestamp, when a re-check fails', async () => {
    const previewGate = vi.fn()
      .mockResolvedValueOnce(preview([violation()]))
      .mockRejectedValue(new Error('Local bridge request failed (500)'));
    renderReleases(makeMockClient({ previewGate }));

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    await screen.findByText('1 standing');

    await userEvent.click(screen.getByRole('button', { name: /re-run gate check/i }));
    await screen.findByText(/could not re-check/i);
    // A failed check is not a clean check: the standing item is still there and nothing passed.
    expect(screen.getByText('1 standing')).toBeTruthy();
    expect(screen.queryByText(/nothing was standing at the gate/i)).toBeNull();
  });

  it('reports a pass only from the server, and says what a pass does not mean', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([]));
    renderReleases(makeMockClient({ previewGate }));

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    expect(await screen.findByText(/nothing was standing at the gate/i)).toBeTruthy();
    expect(screen.getByText(/not a copyright or originality verdict/i)).toBeTruthy();
    // A passing check is not a persisted release, and the panel says so rather than implying one.
    expect(screen.getByRole('button', { name: /build release record/i })).toBeTruthy();
  });

  it('leaves "Build release record" available while blocked', async () => {
    const previewGate = vi.fn().mockResolvedValue(preview([violation()]));
    renderReleases(makeMockClient({ previewGate }));

    await userEvent.click(await screen.findByRole('button', { name: /run gate check/i }));
    await screen.findByText('1 standing');
    // A blocked release is a real, exportable artifact and several honest workflows want one; this
    // feature must not quietly start forbidding it.
    const build = screen.getByRole('button', { name: /build release record/i }) as HTMLButtonElement;
    expect(build.disabled).toBe(false);
  });

  it('refuses to check when there is no completed scan to check against', async () => {
    renderReleases(makeMockClient(), { scanRun: null });

    const check = await screen.findByRole('button', { name: /run gate check/i }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    // No result at all, rather than an empty one that could read as "nothing wrong".
    expect(screen.getByText(/can only be checked against a completed scan/i)).toBeTruthy();
    expect(screen.queryByText(/standing/)).toBeNull();
  });
});

const scanAsset: LocalScanAsset = {
  id: 501,
  scanRunId: run.id,
  ordinal: 1,
  relativePath: 'art/hero.png',
  fileName: 'hero.png',
  fileType: 'png',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  width: 64,
  height: 64,
  dHash: null,
  pHash: null,
  audioFingerprint: null,
  verification: 'CLEAR',
  findings: [],
};

const assetDetail: LocalAssetDetail = {
  asset: scanAsset,
  findings: [],
  sourceEvidence: null,
  latestDecision: null,
};

function makeEvidenceClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const client = {
    session: { csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: true },
    refreshOpenCloudKeyStatus: vi.fn().mockResolvedValue(true),
    listProjectAssets: vi.fn().mockResolvedValue({ scanRunId: run.id, items: [scanAsset], limit: 100, offset: 0 }),
    saveWorkspaceState: vi.fn().mockResolvedValue({
      activeProjectId: project.projectId, activeScanRunId: run.id, selectedAssetId: scanAsset.id,
      selectedFindingId: null, updatedAt: '2026-08-02T21:00:00Z',
    }),
    getAsset: vi.fn().mockResolvedValue(assetDetail),
    getDecisionHistory: vi.fn().mockResolvedValue({ items: [] }),
    listOwnershipVerifications: vi.fn().mockResolvedValue({ items: [] }),
    // The evidence view mounts the group-review panel, which reads this on open. Nothing standing
    // in groups here: these cases are about the walkthrough, not about batching.
    listReviewGroups: vi.fn().mockResolvedValue({
      scanRunId: run.id, gateResult: 'BLOCKED', evaluatedAt: '2026-08-02T21:00:00Z', groups: [],
    }),
    recordDecision: vi.fn().mockResolvedValue({
      id: 'dec-1', scanAssetId: scanAsset.id, type: 'NEEDS_REVIEW', reason: 'Chasing the licence',
      supersedesDecisionId: null, createdAt: '2026-08-02T21:20:00Z',
    }),
    ...overrides,
  };
  return client as unknown as LocalBridgeClient;
}

describe('LocalEvidenceView, arrived at from a gate check', () => {
  it('lands focus on the form that actually changes the violation, not merely on the file', async () => {
    render(
      <LocalEvidenceView
        client={makeEvidenceClient()}
        project={project}
        initialSelectedAssetId={scanAsset.id}
        focusAffordance="source"
      />,
    );

    // Three forms are stacked in this inspector; "we opened the asset" is not the same as "we
    // opened the thing that resolves it".
    await waitFor(() => expect((document.activeElement as HTMLElement)?.closest('.local-source-form')).toBeTruthy());
  });

  it('says where in the walkthrough a person is, without implying the visit clears anything', async () => {
    const onNext = vi.fn();
    const onBackToCheck = vi.fn();
    render(
      <LocalEvidenceView
        client={makeEvidenceClient()}
        project={project}
        initialSelectedAssetId={scanAsset.id}
        resolutionContext={{ assetId: scanAsset.id, index: 2, total: 7, path: 'art/hero.png', onNext, onBackToCheck }}
      />,
    );

    const strip = await screen.findByText('Gate check · item 3 of 7');
    expect(strip.textContent).not.toMatch(/resolved/i);
    expect(screen.getByText(/does not clear the gate/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Next item' }));
    expect(onNext).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to gate check' }));
    expect(onBackToCheck).toHaveBeenCalled();
  });

  it('reports a decision write back to the checklist as what was written, not as a resolution', async () => {
    const onResolutionTouch = vi.fn();
    render(
      <LocalEvidenceView
        client={makeEvidenceClient()}
        project={project}
        initialSelectedAssetId={scanAsset.id}
        onResolutionTouch={onResolutionTouch}
      />,
    );

    await userEvent.type(await screen.findByLabelText('Reason'), 'Chasing the licence');
    await userEvent.click(screen.getByRole('button', { name: /record decision/i }));

    // The picker's own default is NEEDS_REVIEW and the flow never suggests a value, so what gets
    // reported back is a Needs review write — which is touched, and still standing.
    await waitFor(() => expect(onResolutionTouch)
      .toHaveBeenCalledWith(scanAsset.id, 'decision recorded — Needs Review'));
    expect(onResolutionTouch.mock.calls[0][1]).not.toMatch(/resolved/i);
  });
});
