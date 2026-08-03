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
  type LocalBridgeSession,
  type LocalDecision,
  type LocalDecisionType,
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

function decision(type: LocalDecisionType): LocalDecision {
  return {
    id: `dec-${type}`,
    scanAssetId: asset.id,
    type,
    reason: 'A person reviewed this file and recorded why.',
    supersedesDecisionId: null,
    createdAt: '2026-07-24T00:00:00Z',
  };
}

function verification(overrides: Partial<LocalOwnershipVerification> = {}): LocalOwnershipVerification {
  return {
    id: 'own-1',
    scanAssetId: asset.id,
    robloxAssetId: 507766388,
    assetIdSource: 'DECLARED_BY_USER',
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

/**
 * A plain object implementing only what LocalEvidenceView actually calls, matching real signatures.
 * `session` is part of that surface: the ownership panel reads `session.openCloudKeyConfigured` to
 * decide whether the verify action can honestly be offered. It defaults to a configured key so the
 * existing cases exercise the enabled path; the no-key and unknown cases pass their own session.
 */
function makeMockClient(overrides: Partial<Record<
  'listProjectAssets' | 'saveWorkspaceState' | 'getAsset' | 'getDecisionHistory'
  | 'recordDecision' | 'recordSourceEvidence' | 'listOwnershipVerifications' | 'verifyOwnership'
  | 'refreshOpenCloudKeyStatus' | 'listReviewGroups',
  ReturnType<typeof vi.fn>
>> = {}, session: LocalBridgeSession = { csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: true }) {
  const client = {
    session,
    // Re-read on open: a key can be added in the desktop app while this page is up. Defaults to
    // echoing the captured session so a test that does not care sees a stable status.
    refreshOpenCloudKeyStatus: vi.fn().mockResolvedValue(session.openCloudKeyConfigured),
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
    // The evidence view mounts the group-review panel, which reads this on open.
    listReviewGroups: vi.fn().mockResolvedValue({
      scanRunId: 'run-abc', gateResult: 'BLOCKED', evaluatedAt: '2026-01-01T00:00:00Z', groups: [],
    }),
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

  it('says plainly that the animation id was entered by a person and only that id was checked', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({ items: [verification()] }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const headline = await screen.findByText(/creator matches the experience owner/i);
    const verdict = headline.closest('.local-ownership-verdict') as HTMLElement;

    // The checked id is shown next to a DECLARED mark, not presented as something CreatorFlow found.
    const idFact = within(verdict).getByText('Animation ID you entered', { selector: 'dt' })
      .closest('div') as HTMLElement;
    expect(within(idFact).getByText(/507766388/)).toBeTruthy();
    expect(within(idFact).getByText(/declared/i)).toBeTruthy();

    // And the panel spells the limit out in words: a person typed the id, and only that id's
    // ownership was checked — the file was never matched to the animation.
    const panel = verdict.closest('.local-ownership-verification') as HTMLElement;
    const copy = panel.textContent!.toLowerCase();
    expect(copy).toContain('you entered');
    expect(copy).toContain('cannot check that this file is that animation');
  });

  it('never claims the FILE’s ownership was verified, even on a MATCH', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({ items: [verification()] }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const headline = await screen.findByText(/creator matches the experience owner/i);
    const panel = headline.closest('.local-ownership-verification')!;
    const copy = panel.textContent!.toLowerCase();
    expect(copy).not.toContain('this file is owned');
    expect(copy).not.toContain('you own this file');
    expect(copy).not.toContain('ownership of this file is verified');
  });

  it('tells a person the id is theirs to supply before any check has run', async () => {
    const client = makeMockClient();
    render(<LocalEvidenceView client={client} project={boundProject} />);

    await screen.findByLabelText(/roblox animation asset id/i);
    const panel = document.querySelector('.local-ownership-verification') as HTMLElement;
    const copy = panel.textContent!.toLowerCase();
    expect(copy).toContain('you type');
    expect(copy).toContain('declared by you');
  });

  it('renders an UNVERIFIABLE verdict as an honest "could not check", never a verified one', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({
        items: [verification({
          id: 'own-3', outcome: 'UNVERIFIABLE', verified: false,
          creatorType: null, creatorId: null, ownerType: null, ownerId: null,
          assetType: null, moderationState: null,
        })],
      }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const headline = await screen.findByText(/could not verify ownership/i);
    const verdict = headline.closest('.local-ownership-verdict') as HTMLElement;

    // The verdict carries the NOT_VERIFIED basis badge — the one thing a false VERIFIED would break.
    expect(within(verdict).getByText('Not verified')).toBeTruthy();
    expect(within(verdict).queryByText('Verified')).toBeNull();
    const copy = verdict.textContent!.toLowerCase();
    expect(copy).toContain('could not obtain');
    expect(copy).toContain('stays not verified');
    // An unverifiable check is not a review lead and not an accusation.
    expect(copy).not.toContain('review lead');
    expect(copy).not.toContain('infringement');
  });

  it('renders the facts it could not obtain as "Not obtained" rather than blank or a guess', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({
        items: [verification({
          id: 'own-4', outcome: 'UNVERIFIABLE', verified: false,
          creatorType: null, creatorId: null, ownerType: null, ownerId: null, moderationState: null,
        })],
      }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const headline = await screen.findByText(/could not verify ownership/i);
    const verdict = headline.closest('.local-ownership-verdict') as HTMLElement;

    const creator = within(verdict).getByText('Creator of that animation', { selector: 'dt' }).closest('div') as HTMLElement;
    const owner = within(verdict).getByText('Experience owner', { selector: 'dt' }).closest('div') as HTMLElement;
    expect(within(creator).getByText('Not obtained')).toBeTruthy();
    expect(within(owner).getByText('Not obtained')).toBeTruthy();
    // Nothing that was never obtained is rendered as a real identity.
    expect(within(creator).queryByText(/user|group/i)).toBeNull();
    // A moderation fact that was not obtained is omitted rather than shown empty.
    expect(within(verdict).queryByText('Moderation', { selector: 'dt' })).toBeNull();
  });

  it('tells a rate-limited person how long to wait when the bridge reported a Retry-After', async () => {
    const verifyOwnership = vi.fn().mockRejectedValue(
      new LocalBridgeError('Roblox Open Cloud is rate-limiting requests.', 429, 30),
    );
    const client = makeMockClient({ verifyOwnership });

    render(<LocalEvidenceView client={client} project={boundProject} />);
    await userEvent.type(await screen.findByLabelText(/roblox animation asset id/i), '507766388');
    await userEvent.click(screen.getByRole('button', { name: /verify ownership/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent!.toLowerCase()).toContain('rate-limited, try again in 30 seconds');
  });

  it('disables the verify action with a clear reason when the desktop reports no Open Cloud key', async () => {
    const verifyOwnership = vi.fn();
    const client = makeMockClient({ verifyOwnership }, {
      csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: false,
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const verify = await screen.findByRole('button', { name: /verify ownership/i }) as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    // Even with a valid id typed, a missing key keeps it disabled — the reason names the key and
    // where to fix it, instead of only failing after the click.
    await userEvent.type(screen.getByLabelText(/roblox animation asset id/i), '507766388');
    expect(verify.disabled).toBe(true);
    const panel = document.querySelector('.local-ownership-verification') as HTMLElement;
    const copy = panel.textContent!.toLowerCase();
    expect(copy).toContain('open cloud api key');
    expect(copy).toContain('settings');
    await userEvent.click(verify);
    expect(verifyOwnership).not.toHaveBeenCalled();
  });

  it('re-enables the verify action once the desktop reports a key added after this page loaded', async () => {
    // The friend test does exactly this: adopt a project, then paste the key into the desktop
    // Settings card. A status captured at page load must not keep telling them to add a key.
    const client = makeMockClient({
      refreshOpenCloudKeyStatus: vi.fn().mockResolvedValue(true),
    }, { csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: false });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    await userEvent.type(await screen.findByLabelText(/roblox animation asset id/i), '507766388');
    const verify = screen.getByRole('button', { name: /verify ownership/i }) as HTMLButtonElement;
    await waitFor(() => expect(verify.disabled).toBe(false));
    expect(document.body.textContent!.toLowerCase()).not.toContain('open cloud api key');
  });

  it('disables the verify action when the desktop reports the key is gone, even though the page loaded with one', async () => {
    const client = makeMockClient({
      refreshOpenCloudKeyStatus: vi.fn().mockResolvedValue(false),
    }, { csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: true });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    await userEvent.type(await screen.findByLabelText(/roblox animation asset id/i), '507766388');
    const verify = screen.getByRole('button', { name: /verify ownership/i }) as HTMLButtonElement;
    await waitFor(() => expect(verify.disabled).toBe(true));
    expect(document.body.textContent!.toLowerCase()).toContain('open cloud api key');
  });

  it('keeps the verify action available when the bridge never reported the key status', async () => {
    // Unknown is not "no key": the UI must not assert a state it was never told, and the post-click
    // 409 remains the fallback that answers honestly.
    const client = makeMockClient({}, {
      csrfToken: 'csrf-token', origin: 'http://localhost:3000', openCloudKeyConfigured: null,
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    await userEvent.type(await screen.findByLabelText(/roblox animation asset id/i), '507766388');
    const verify = screen.getByRole('button', { name: /verify ownership/i }) as HTMLButtonElement;
    expect(verify.disabled).toBe(false);
    expect(document.body.textContent!.toLowerCase()).not.toContain('open cloud api key');
  });

  it('does not claim "no decision is on record" on a MISMATCH when a person already recorded one', async () => {
    const client = makeMockClient({
      getAsset: vi.fn().mockResolvedValue({ ...detail, latestDecision: decision('APPROVED') }),
      getDecisionHistory: vi.fn().mockResolvedValue({ items: [decision('APPROVED')] }),
      listOwnershipVerifications: vi.fn().mockResolvedValue({
        items: [verification({ id: 'own-5', outcome: 'MISMATCH', ownerId: 999 })],
      }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const headline = await screen.findByText(/review lead/i);
    const verdict = headline.closest('.local-ownership-verdict') as HTMLElement;
    const copy = verdict.textContent!.toLowerCase();
    expect(copy).not.toContain('no decision is on record');
    expect(copy).toContain('approved');
    // Still a lead for a person, never an accusation.
    expect(copy).not.toContain('infringement');
    expect(copy).not.toContain('stolen');
  });

  it('still asks for a decision on a MISMATCH when nobody has recorded one', async () => {
    const client = makeMockClient({
      listOwnershipVerifications: vi.fn().mockResolvedValue({
        items: [verification({ id: 'own-6', outcome: 'MISMATCH', ownerId: 999 })],
      }),
    });
    render(<LocalEvidenceView client={client} project={boundProject} />);

    const headline = await screen.findByText(/review lead/i);
    const verdict = headline.closest('.local-ownership-verdict') as HTMLElement;
    expect(verdict.textContent!.toLowerCase()).toContain('no decision is on record');
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
