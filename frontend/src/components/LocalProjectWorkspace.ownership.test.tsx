// @vitest-environment jsdom
//
// Component test for the verify-ownership flow inside LocalEvidenceView (LocalProjectWorkspace.tsx).
// Follows the per-file jsdom + React Testing Library harness established by the increment-6
// decision-flow test (LocalProjectWorkspace.decisionFlow.test.tsx) — the environment is scoped
// per file, and LocalEvidenceView is exercised directly because its module graph is narrow.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalEvidenceView } from './LocalProjectWorkspace';
import {
  LocalBridgeError,
  type LocalAssetDetail,
  type LocalBridgeClient,
  type LocalOwnershipVerification,
  type LocalProjectSummary,
  type LocalScanAsset,
} from '../bridge/localBridge';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const boundProject: LocalProjectSummary = {
  projectId: 9,
  name: 'Test Project',
  experience: { universeId: 90110, placeId: 12345, experienceName: 'Obby Tower' },
};

const asset: LocalScanAsset = {
  id: 501,
  scanRunId: 'run-abc',
  ordinal: 1,
  relativePath: 'animations/hero-idle.rbxm',
  fileName: 'hero-idle.rbxm',
  fileType: 'rbxm',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  width: 0,
  height: 0,
  dHash: null,
  pHash: null,
  audioFingerprint: null,
  verification: 'CLEAR',
  findings: [],
};

const detail: LocalAssetDetail = {
  asset,
  findings: [],
  sourceEvidence: null,
  latestDecision: null,
};

function verification(overrides: Partial<LocalOwnershipVerification> = {}): LocalOwnershipVerification {
  return {
    id: 'own-1',
    scanAssetId: asset.id,
    robloxAssetId: 507766388,
    universeId: 90110,
    creatorType: 'USER',
    creatorId: 1,
    assetType: 'Animation',
    moderationState: 'Approved',
    ownerType: 'USER',
    ownerId: 1,
    memberRank: null,
    outcome: 'MATCH',
    verified: true,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A plain object implementing only what LocalEvidenceView actually calls, matching real signatures. */
function makeMockClient(overrides: Partial<Record<
  'listProjectAssets' | 'saveWorkspaceState' | 'getAsset' | 'getDecisionHistory'
  | 'recordDecision' | 'recordSourceEvidence' | 'listOwnershipVerifications' | 'verifyOwnership',
  ReturnType<typeof vi.fn>
>> = {}) {
  const client = {
    listProjectAssets: vi.fn().mockResolvedValue({ scanRunId: 'run-abc', items: [asset], limit: 100, offset: 0 }),
    saveWorkspaceState: vi.fn().mockResolvedValue({
      activeProjectId: boundProject.projectId, activeScanRunId: 'run-abc', selectedAssetId: asset.id,
      selectedFindingId: null, updatedAt: '2026-01-01T00:00:00Z',
    }),
    getAsset: vi.fn().mockResolvedValue(detail),
    getDecisionHistory: vi.fn().mockResolvedValue({ items: [] }),
    recordDecision: vi.fn(),
    recordSourceEvidence: vi.fn(),
    listOwnershipVerifications: vi.fn().mockResolvedValue({ items: [] }),
    verifyOwnership: vi.fn(),
    ...overrides,
  };
  return client as unknown as LocalBridgeClient;
}

describe('LocalEvidenceView ownership verification', () => {
  it('shows a VERIFIED verdict with the point-in-time facts when a match is on record', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({ items: [verification()] }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    // The verdict headline, the verified facts, and a point-in-time "checked" stamp are all shown.
    const headline = await screen.findByText(/creator matches the experience owner/i);
    const verdict = headline.closest('.local-ownership-verdict') as HTMLElement;
    expect(within(verdict).getByText(/approved/i)).toBeTruthy();
    expect(within(verdict).getByText(/checked today/i)).toBeTruthy();
    expect(screen.getAllByText(/verified/i).length).toBeGreaterThan(0);
  });

  it('frames a mismatch as a review lead needing a human decision, never as an accusation', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({
        items: [verification({ id: 'own-2', outcome: 'MISMATCH', ownerId: 999 })],
      }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    await screen.findByText(/review lead/i);
    const body = document.body.textContent!.toLowerCase();
    expect(body).not.toContain('infringement');
    expect(body).not.toContain('stolen');
  });

  it('verifies through the real client signature and refreshes the record on success', async () => {
    const verifyOwnership = vi.fn().mockResolvedValue(verification());
    const listOwnershipVerifications = vi.fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValue({ items: [verification()] });
    const client = makeMockClient({ verifyOwnership, listOwnershipVerifications });

    render(<LocalEvidenceView client={client} project={boundProject} />);

    const input = await screen.findByLabelText(/roblox animation asset id/i);
    await userEvent.type(input, '507766388');
    const verify = screen.getByRole('button', { name: /verify ownership/i });
    await userEvent.click(verify);

    // The real client method, with the real (scanAssetId, robloxAssetId) signature.
    await waitFor(() => expect(verifyOwnership).toHaveBeenCalledWith(asset.id, 507766388));
    await screen.findByText(/creator matches the experience owner/i);
  });

  it('surfaces a 409 as the no-key state pointing at the desktop Settings card', async () => {
    const verifyOwnership = vi.fn().mockRejectedValue(
      new LocalBridgeError('Add a Roblox Open Cloud API key in Settings before verifying ownership.', 409),
    );
    const client = makeMockClient({ verifyOwnership });

    render(<LocalEvidenceView client={client} project={boundProject} />);
    const input = await screen.findByLabelText(/roblox animation asset id/i);
    await userEvent.type(input, '507766388');
    await userEvent.click(screen.getByRole('button', { name: /verify ownership/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent!.toLowerCase()).toContain('settings');
  });

  it('surfaces a 429 distinctly as rate-limited, try again', async () => {
    const verifyOwnership = vi.fn().mockRejectedValue(
      new LocalBridgeError('Roblox Open Cloud is rate-limiting requests.', 429),
    );
    const client = makeMockClient({ verifyOwnership });

    render(<LocalEvidenceView client={client} project={boundProject} />);
    const input = await screen.findByLabelText(/roblox animation asset id/i);
    await userEvent.type(input, '507766388');
    await userEvent.click(screen.getByRole('button', { name: /verify ownership/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent!.toLowerCase()).toContain('rate-limited, try again');
  });

  it('disables the verify action with a clear reason when no experience is bound', async () => {
    const unboundProject: LocalProjectSummary = { projectId: 9, name: 'Test Project', experience: null };
    const client = makeMockClient();
    render(<LocalEvidenceView client={client} project={unboundProject} />);

    const verify = await screen.findByRole('button', { name: /verify ownership/i }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    // Even with a valid id typed, the missing experience keeps it disabled with an explanation.
    await userEvent.type(screen.getByLabelText(/roblox animation asset id/i), '507766388');
    expect(verify.disabled).toBe(true);
    expect(document.body.textContent!.toLowerCase()).toContain('experience');
  });
});
