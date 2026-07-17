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
  'listProjectAssets' | 'saveWorkspaceState' | 'getAsset' | 'getDecisionHistory' | 'recordDecision',
  ReturnType<typeof vi.fn>
>> = {}) {
  const client = {
    listProjectAssets: vi.fn().mockResolvedValue({ scanRunId: 'run-abc', items: [asset], limit: 100, offset: 0 }),
    saveWorkspaceState: vi.fn().mockResolvedValue({
      activeProjectId: project.projectId, activeScanRunId: 'run-abc', selectedAssetId: asset.id,
      selectedFindingId: null, updatedAt: '2026-01-01T00:00:00Z',
    }),
    getAsset: vi.fn().mockResolvedValue(detailWithPriorDecision),
    getDecisionHistory: vi.fn().mockResolvedValue({ items: [priorDecision] }),
    recordDecision: vi.fn(),
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
});
