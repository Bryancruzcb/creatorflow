// @vitest-environment jsdom
//
// Component test for the decision flow inside LocalEvidenceView (LocalProjectWorkspace.tsx).
// This is the only test file in the repo that renders a React component (jsdom + React Testing
// Library) — see the increment report for why the environment is scoped per-file rather than
// globally. LocalEvidenceView is exercised directly (not extracted) because its module graph is
// already narrow: LocalProjectWorkspace.tsx only imports lucide-react, ../bridge/evidenceBasis,
// ./EvidenceBasisMark, and ../manifest/manifest — none of which pull in three.js or
// MotionComparisonLab, so no testability extraction was needed here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalEvidenceView } from './LocalProjectWorkspace';
import type {
  LocalAssetDetail,
  LocalBridgeClient,
  LocalDecision,
  LocalProjectSummary,
  LocalScanAsset,
} from '../bridge/localBridge';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project: LocalProjectSummary = { projectId: 9, name: 'Test Project' };

const asset: LocalScanAsset = {
  id: 501,
  scanRunId: 'run-abc',
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

const priorDecision: LocalDecision = {
  id: 'dec-1',
  scanAssetId: asset.id,
  type: 'NEEDS_REVIEW',
  reason: 'Needs confirmation of source license',
  supersedesDecisionId: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const detailWithPriorDecision: LocalAssetDetail = {
  asset,
  findings: [],
  sourceEvidence: null,
  latestDecision: priorDecision,
};

/** A plain object implementing only what LocalEvidenceView actually calls, matching real signatures. */
function makeMockClient(overrides: Partial<Record<
  'listProjectAssets' | 'saveWorkspaceState' | 'getAsset' | 'getDecisionHistory' | 'recordDecision'
  | 'listOwnershipVerifications' | 'listReviewGroups',
  ReturnType<typeof vi.fn>
>> = {}) {
  const client = {
    // The ownership panel inside the evidence view reads the session's key status (a boolean only)
    // to decide whether it can honestly offer the verify action, and re-reads it on open because a
    // key is added in the desktop app, possibly while this page is up.
    session: { csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: true },
    refreshOpenCloudKeyStatus: vi.fn().mockResolvedValue(true),
    listProjectAssets: vi.fn().mockResolvedValue({ scanRunId: 'run-abc', items: [asset], limit: 100, offset: 0 }),
    saveWorkspaceState: vi.fn().mockResolvedValue({
      activeProjectId: project.projectId, activeScanRunId: 'run-abc', selectedAssetId: asset.id,
      selectedFindingId: null, updatedAt: '2026-01-01T00:00:00Z',
    }),
    getAsset: vi.fn().mockResolvedValue(detailWithPriorDecision),
    getDecisionHistory: vi.fn().mockResolvedValue({ items: [priorDecision] }),
    recordDecision: vi.fn(),
    // The evidence view loads ownership verifications alongside the asset detail (Phase A, Task 10).
    listOwnershipVerifications: vi.fn().mockResolvedValue({ items: [] }),
    // …and mounts the group-review panel, which reads what is standing at the gate on open.
    listReviewGroups: vi.fn().mockResolvedValue({
      scanRunId: 'run-abc', gateResult: 'BLOCKED', evaluatedAt: '2026-01-01T00:00:00Z', groups: [],
    }),
    ...overrides,
  };
  return client as unknown as LocalBridgeClient;
}

describe('LocalEvidenceView decision flow', () => {
  it('keeps the record-decision control disabled until a non-blank reason is entered (the required-reason gate)', async () => {
    const client = makeMockClient();
    render(<LocalEvidenceView client={client} project={project} />);

    const submit = await screen.findByRole('button', { name: /record decision/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const reason = screen.getByLabelText('Reason');
    await userEvent.type(reason, '   ');
    expect(submit.disabled).toBe(true);

    await userEvent.type(reason, 'Confirmed against studio archive license');
    expect(submit.disabled).toBe(false);

    await userEvent.clear(reason);
    expect(submit.disabled).toBe(true);
  });

  it('submits the reason to the real recordDecision signature and re-renders the refreshed append-only history', async () => {
    const newDecision: LocalDecision = {
      id: 'dec-2', scanAssetId: asset.id, type: 'NEEDS_REVIEW',
      reason: 'Confirmed against studio archive license', supersedesDecisionId: 'dec-1',
      createdAt: '2026-01-02T00:00:00Z',
    };
    const recordDecision = vi.fn().mockResolvedValue(newDecision);
    const getAsset = vi.fn()
      .mockResolvedValueOnce(detailWithPriorDecision)
      .mockResolvedValue({ ...detailWithPriorDecision, latestDecision: newDecision });
    const getDecisionHistory = vi.fn()
      .mockResolvedValueOnce({ items: [priorDecision] })
      .mockResolvedValue({ items: [newDecision, priorDecision] });
    const client = makeMockClient({ recordDecision, getAsset, getDecisionHistory });

    render(<LocalEvidenceView client={client} project={project} />);

    await screen.findByText('1 append-only record in history');

    const reason = screen.getByLabelText('Reason');
    await userEvent.type(reason, 'Confirmed against studio archive license');
    const submit = screen.getByRole('button', { name: /record decision/i });
    await userEvent.click(submit);

    // The real client method, with the real (assetId, type, reason, supersedesDecisionId) signature.
    await waitFor(() => expect(recordDecision).toHaveBeenCalledWith(
      asset.id, 'NEEDS_REVIEW', 'Confirmed against studio archive license', 'dec-1',
    ));

    // The append-only history re-renders from the refreshed (mocked) fetch — now 2 records.
    await screen.findByText('2 append-only records in history');

    const latest = screen.getByText('Latest decision').closest('section') as HTMLElement;
    expect(within(latest).getByText('Confirmed against studio archive license')).toBeTruthy();

    // The reason field clears after a successful submit.
    await waitFor(() => expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe(''));
  });

  /**
   * The honesty payoff of the batch feature, and the reason it ships in the same change: a person
   * reading one file's record has to be able to see that its decision was one of twelve made in one
   * act, rather than a review of this file. Without this the ledger would be the thing that hides it.
   */
  it('marks a batched decision as one of many, on the latest decision and in the history', async () => {
    const batched: LocalDecision = {
      id: 'dec-batched',
      scanAssetId: asset.id,
      type: 'NEEDS_REVIEW',
      reason: 'Flagged in the 2.4 re-scan; scheduling a review with Marco on Thursday.',
      supersedesDecisionId: null,
      createdAt: '2026-08-02T21:00:00Z',
      batchId: 'b1b2c3d4-5566-7788-99aa-bbccddeeff00',
      batchAssetCount: 12,
    };
    const client = makeMockClient({
      getAsset: vi.fn().mockResolvedValue({ ...detailWithPriorDecision, latestDecision: batched }),
      getDecisionHistory: vi.fn().mockResolvedValue({ items: [batched, priorDecision] }),
    });
    render(<LocalEvidenceView client={client} project={project} />);

    const latest = (await screen.findByText('Latest decision')).closest('section') as HTMLElement;
    expect(within(latest).getByText(/recorded as part of a 12-file batch · batch b1b2c3d4/i)).toBeTruthy();
    // The shared rationale is rendered as the person wrote it, undecorated.
    expect(within(latest).getByText(batched.reason)).toBeTruthy();

    // And the same disclosure travels with the entry in the append-only history.
    const history = screen.getByText('Decision history').closest('section') as HTMLElement;
    expect(within(history).getByText(/recorded as part of a 12-file batch/i)).toBeTruthy();
    // The per-file decision next to it carries no marker — the two must stay distinguishable.
    const entries = within(history).getAllByRole('listitem');
    expect(entries[1].textContent).not.toMatch(/part of a/i);
  });

  /**
   * The history renders oldest-first, so its first row is the one a reader is most likely to mistake
   * for the standing decision. It has to carry its own date, and an entry a later record replaced
   * has to say so — position is not a fact a ledger surface may rely on.
   */
  it('dates every history entry and marks the ones a later decision replaced', async () => {
    const superseding: LocalDecision = {
      id: 'dec-2', scanAssetId: asset.id, type: 'APPROVED',
      reason: 'Checked the archive licence and approved it.',
      supersedesDecisionId: priorDecision.id, createdAt: '2026-08-02T14:05:00Z',
    };
    const client = makeMockClient({
      getAsset: vi.fn().mockResolvedValue({ ...detailWithPriorDecision, latestDecision: superseding }),
      getDecisionHistory: vi.fn().mockResolvedValue({ items: [priorDecision, superseding] }),
    });
    render(<LocalEvidenceView client={client} project={project} />);

    const history = (await screen.findByText('Decision history')).closest('section') as HTMLElement;
    const entries = within(history).getAllByRole('listitem');

    // Oldest first, and the panel says so rather than leaving the order to be inferred.
    expect(within(history).getByText(/oldest first/i)).toBeTruthy();
    expect(entries[0].textContent).toContain('2026-01-01 00:00');
    expect(entries[0].textContent).toMatch(/superseded by a later decision/i);
    expect(entries[0].getAttribute('data-superseded')).toBe('true');

    // The standing one is dated too, and carries no superseded mark.
    expect(entries[1].textContent).toContain('2026-08-02 14:05');
    expect(entries[1].textContent).not.toMatch(/superseded/i);
    expect(entries[1].getAttribute('data-superseded')).toBeNull();
  });
});
