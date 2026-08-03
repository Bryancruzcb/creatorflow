// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { TeamProvenancePanel } from './TeamProvenancePanel';
import type { LocalBridgeClient, LocalProvenanceLookup, TeamStoreStatus } from '../bridge/localBridge';

/**
 * **The single most important test in Phase E.**
 *
 * An unreachable team store must never render as "no one else has this." Those are different
 * facts — one is a lookup that ran and found nothing, the other is a lookup that never happened —
 * and collapsing them is how a tool starts telling people their work is unique when it has no
 * idea. Every structural defence in this phase (a status on every response, a 200 even for a
 * failed lookup, no local cache to fall back on) exists to make this test passable, so it is
 * asserted directly rather than left to whoever edits the copy next.
 *
 * The check is deliberately a negative one over the whole rendered subtree, not a match on one
 * expected string: a future refactor that adds an unrelated "nobody has registered this" line in
 * some other branch of the unknown state would slip past a positive assertion and fails here.
 */

const FINGERPRINT = 'a'.repeat(64);
const VERSION = 'creatorflow.motion-fingerprint/v1';

function clientAnswering(lookup: LocalProvenanceLookup): LocalBridgeClient {
  return { lookupTeamProvenance: vi.fn().mockResolvedValue(lookup) } as unknown as LocalBridgeClient;
}

/** Every phrasing that would assert emptiness. None may appear unless a lookup actually ran. */
const EMPTINESS_CLAIMS = [
  /no one/i,
  /no-one/i,
  /nobody/i,
  /not registered/i,
  /\boriginal\b/i,
  /\bunique\b/i,
  /first to/i,
];

const UNKNOWN_STATUSES: TeamStoreStatus[] = ['UNREACHABLE', 'UNAUTHORIZED', 'REJECTED'];

// This project does not enable Testing Library's global auto-cleanup, so each file unmounts its
// own renders. Without it every query below would see the previous case's DOM as well — which
// would silently weaken a negative assertion into one that passes for the wrong reason.
afterEach(cleanup);

describe('an unreachable team store never renders as an empty result', () => {
  it.each(UNKNOWN_STATUSES)('renders %s as unknown, never as an absence of claims', async (status) => {
    const { container } = render(
      <TeamProvenancePanel
        bridgeClient={clientAnswering({ status, fingerprint: FINGERPRINT, algorithmVersion: VERSION, claims: [], message: null })}
        fingerprint={FINGERPRINT}
        algorithmVersion={VERSION}
        clipName="courier_run"
      />,
    );

    await within(container).findByText(/team provenance unknown/i);

    const rendered = container.textContent ?? '';
    for (const phrase of EMPTINESS_CLAIMS) {
      expect(
        rendered,
        `an unreachable store rendered "${phrase}". Nothing was looked up, so nothing is known `
        + 'either way — this is the false-reassurance failure the whole phase is shaped to prevent.',
      ).not.toMatch(phrase);
    }
    // And the basis is honest about it: nothing here was verified.
    expect(within(container).getByTitle(/did not or cannot check this/i)).toBeTruthy();
  });

  it('renders a bridge failure as unknown too, not as a caught-and-emptied list', async () => {
    // The bridge answers 200 with a status even for an unreachable store, so a rejection here
    // means the bridge itself failed. That is still "we could not ask".
    const client = {
      lookupTeamProvenance: vi.fn().mockRejectedValue(new Error('bridge down')),
    } as unknown as LocalBridgeClient;

    const { container } = render(
      <TeamProvenancePanel bridgeClient={client} fingerprint={FINGERPRINT} algorithmVersion={VERSION} clipName="courier_run" />,
    );

    await within(container).findByText(/team provenance unknown/i);
    for (const phrase of EMPTINESS_CLAIMS) {
      expect(container.textContent ?? '').not.toMatch(phrase);
    }
  });

  it('says the store is not connected without implying anything about the fingerprint', async () => {
    const { container } = render(
      <TeamProvenancePanel
        bridgeClient={clientAnswering({ status: 'NOT_CONFIGURED', fingerprint: FINGERPRINT, algorithmVersion: VERSION, claims: [], message: null })}
        fingerprint={FINGERPRINT}
        algorithmVersion={VERSION}
        clipName="courier_run"
      />,
    );

    await within(container).findByText(/team store not connected/i);
    expect(container.textContent).toMatch(/works fully without it/i);
    for (const phrase of EMPTINESS_CLAIMS) {
      expect(container.textContent ?? '').not.toMatch(phrase);
    }
  });

  /**
   * The counterpart. The one sentence banned above IS allowed here — and only here — because a
   * lookup genuinely ran. Without this, the test above could be satisfied by never saying it at
   * all, which would lose the product.
   */
  it('does say no one has it, but only when the store actually answered', async () => {
    render(
      <TeamProvenancePanel
        bridgeClient={clientAnswering({ status: 'OK', fingerprint: FINGERPRINT, algorithmVersion: VERSION, claims: [], message: null })}
        fingerprint={FINGERPRINT}
        algorithmVersion={VERSION}
        clipName="courier_run"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no one on your team has registered this exact curve fingerprint/i)).toBeTruthy();
    });
    // The mark says a lookup was verified; the wording carries the outcome (the Phase B split).
    expect(screen.getByTitle(/computed by creatorflow/i)).toBeTruthy();
    // "no record found" is not "original", and the copy has to keep saying so.
    expect(screen.getByText(/not the same as original/i)).toBeTruthy();
  });
});
