// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnimationSnapshotsPanel, shareDisabledReason } from './AnimationSnapshotsPanel';
import type {
  LocalAnimationSnapshot,
  LocalBridgeClient,
  LocalProjectSummary,
  LocalTeamStore,
} from '../bridge/localBridge';

/**
 * Sharing is explicit, per-snapshot, and disclosed.
 *
 * The dialog is the consent surface, so what it enumerates is asserted here — including the fact
 * that the full fingerprint is shown rather than the truncated form the row displays. A person
 * consenting to publish a string should be able to see the string.
 */

const FINGERPRINT = '9f3ac21b7e408d5c6a1f0b93e28d47aa5c9e1f30b7a248d16c05e9f4a1b2c3d4';
const PROJECT: LocalProjectSummary = { projectId: 1, name: 'Harbor' };

const SNAPSHOT: LocalAnimationSnapshot = {
  id: 'snap-1', projectId: 1, assetId: '1042', kind: 'LAST_KNOWN_GOOD', sourceComparisonId: null,
  name: 'courier_run', duration: 1.25, fingerprint: FINGERPRINT,
  algorithmVersion: 'creatorflow.motion-fingerprint/v1', supersedesSnapshotId: null,
  status: 'UNCHANGED', createdAt: '2026-07-30T09:00:00.000Z',
};

const CONNECTED_STORE: LocalTeamStore = {
  configured: true, baseUrl: 'http://team.example:8080', teamId: 7, teamName: 'Harbor Studio',
  memberCount: 3, keyStorageMode: 'DPAPI_WINDOWS', status: 'OK', message: null,
};

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listAnimationSnapshots: vi.fn().mockResolvedValue({ items: [SNAPSHOT] }),
    captureAnimationSnapshot: vi.fn(),
    getTeamStore: vi.fn().mockResolvedValue(CONNECTED_STORE),
    shareProvenanceClaim: vi.fn().mockResolvedValue({
      status: 'OK', claim: {}, alreadyShared: false, declarationsDiffer: false,
    }),
    ...overrides,
  } as unknown as LocalBridgeClient;
}

// No global auto-cleanup in this project, and it matters more than usual here: the row button and
// the dialog's confirm button share a label, so a leaked previous render makes every query
// ambiguous.
afterEach(cleanup);

/** The row's button, as opposed to the dialog's confirm button of the same name. */
function rowShareButton(): HTMLButtonElement {
  const button = document.querySelector('.animation-snapshots-share');
  if (!button) throw new Error('no share button on the snapshot row');
  return button as HTMLButtonElement;
}

describe('sharing a snapshot to the team store', () => {
  it('enumerates exactly what leaves the machine, and what does not', async () => {
    const user = userEvent.setup();
    render(<AnimationSnapshotsPanel bridgeClient={makeClient()} project={PROJECT} latestComparison={null} />);

    await screen.findByText('courier_run');
    await user.click(rowShareButton());

    const dialog = await screen.findByRole('dialog', { name: /share to team/i });
    // The four values the desktop reads from its own snapshot row — the only ones a browser
    // cannot influence — shown as the exact values that will travel.
    expect(dialog.textContent).toContain(FINGERPRINT);
    expect(dialog.textContent).toContain('creatorflow.motion-fingerprint/v1');
    expect(dialog.textContent).toContain('courier_run');
    expect(dialog.textContent).toContain('1.25s');
    // And the equally explicit list of what stays put.
    expect(dialog.textContent).toMatch(/not shared/i);
    expect(dialog.textContent).toMatch(/curves themselves/i);
    expect(dialog.textContent).toMatch(/scan path/i);
    // Retract is described honestly: it cannot recall what someone already read.
    expect(dialog.textContent).toMatch(/removes it from future lookups/i);
    expect(dialog.textContent).not.toMatch(/unshare/i);
  });

  it('shares only after the confirmation, and sends a snapshot id rather than a fingerprint', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<AnimationSnapshotsPanel bridgeClient={client} project={PROJECT} latestComparison={null} />);

    await screen.findByText('courier_run');
    await user.click(rowShareButton());
    // Opening the dialog is not consent. Nothing is uploaded until the confirmation is pressed.
    expect(client.shareProvenanceClaim).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: /share to team/i });
    await user.click(within(dialog).getByRole('button', { name: /^share to team$/i }));
    await waitFor(() => expect(client.shareProvenanceClaim).toHaveBeenCalled());

    const sent = vi.mocked(client.shareProvenanceClaim).mock.calls[0][0];
    expect(sent.snapshotId).toBe('snap-1');
    // The frontend cannot publish a fingerprint the desktop did not compute, and the request
    // shape is where that starts.
    expect(sent).not.toHaveProperty('fingerprint');
    expect(sent).not.toHaveProperty('algorithmVersion');
  });

  it('says a re-share with changed text was NOT recorded, rather than reporting a bare success', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      shareProvenanceClaim: vi.fn().mockResolvedValue({
        status: 'OK', claim: {}, alreadyShared: true, declarationsDiffer: true,
      }),
    });
    render(<AnimationSnapshotsPanel bridgeClient={client} project={PROJECT} latestComparison={null} />);

    await screen.findByText('courier_run');
    await user.click(rowShareButton());
    const dialog = await screen.findByRole('dialog', { name: /share to team/i });
    await user.click(within(dialog).getByRole('button', { name: /^share to team$/i }));

    expect(await screen.findByText(/already shared — retract to change/i)).toBeTruthy();
    expect(screen.getByText(/was not recorded over the existing claim/i)).toBeTruthy();
  });

  it('disables the button with an honest reason when no store is connected', async () => {
    const client = makeClient({ getTeamStore: vi.fn().mockResolvedValue({ ...CONNECTED_STORE, configured: false }) });
    render(<AnimationSnapshotsPanel bridgeClient={client} project={PROJECT} latestComparison={null} />);

    await screen.findByText('courier_run');
    // `toBeDisabled` is a jest-dom matcher and this project deliberately does not use jest-dom,
    // so the property is read directly.
    await waitFor(() => expect(rowShareButton().disabled).toBe(true));
    expect(rowShareButton().getAttribute('title')).toMatch(/no team provenance store is connected/i);
  });

  it('degrades to a disabled button when the bridge does not report a team store at all', async () => {
    // A bridge build without the route, or a caller that never stubbed it. The panel must not
    // throw on render, and must not offer a share it cannot honour.
    const client = makeClient({ getTeamStore: undefined });
    render(<AnimationSnapshotsPanel bridgeClient={client} project={PROJECT} latestComparison={null} />);

    await screen.findByText('courier_run');
    await waitFor(() => expect(rowShareButton().disabled).toBe(true));
  });
});

describe('shareDisabledReason', () => {
  it('gives a reason for every unshareable state and none when the store is up', () => {
    expect(shareDisabledReason(null)).toMatch(/no team provenance store is connected/i);
    expect(shareDisabledReason({ ...CONNECTED_STORE, configured: false }))
      .toMatch(/no team provenance store is connected/i);
    expect(shareDisabledReason({ ...CONNECTED_STORE, status: 'UNREACHABLE' }))
      .toMatch(/could not be reached/i);
    expect(shareDisabledReason(CONNECTED_STORE)).toBeNull();
  });
});
