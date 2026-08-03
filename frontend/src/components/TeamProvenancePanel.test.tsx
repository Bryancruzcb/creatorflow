// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ORDERING_DISCLAIMER, TeamProvenancePanel } from './TeamProvenancePanel';
import type { LocalBridgeClient, LocalProvenanceClaim, LocalProvenanceLookup } from '../bridge/localBridge';

/**
 * The panel's populated states: how rows are ordered, how a version this build cannot compare
 * against is rendered, and how VERIFIED facts are kept apart from DECLARED ones.
 *
 * The unreachable-vs-empty rule has its own file — it is the phase's defining property and gets
 * asserted on its own rather than as one case among many.
 */

const FINGERPRINT = 'a'.repeat(64);
const V1 = 'creatorflow.motion-fingerprint/v1';

function claim(overrides: Partial<LocalProvenanceClaim>): LocalProvenanceClaim {
  return {
    id: 1,
    memberUsername: 'mira',
    isYours: false,
    algorithmVersion: V1,
    clipName: 'courier_run',
    durationSeconds: 1.25,
    robloxAssetId: null,
    ownershipContext: null,
    declaredSource: null,
    declaredLicense: null,
    declaredNote: null,
    observedAt: '2026-07-30T09:00:00.000Z',
    recordedAt: '2026-07-30T09:00:04.000Z',
    ...overrides,
  };
}

function renderWith(claims: LocalProvenanceClaim[], algorithmVersion: string | null = V1) {
  const lookup: LocalProvenanceLookup = {
    status: 'OK', fingerprint: FINGERPRINT, algorithmVersion, claims, message: null,
  };
  const client = {
    lookupTeamProvenance: vi.fn().mockResolvedValue(lookup),
    retractProvenanceClaim: vi.fn(),
  } as unknown as LocalBridgeClient;
  return {
    client,
    ...render(
      <TeamProvenancePanel
        bridgeClient={client}
        fingerprint={FINGERPRINT}
        algorithmVersion={algorithmVersion}
        clipName="courier_run"
      />,
    ),
  };
}

// No global auto-cleanup in this project: each file unmounts its own renders, or every query
// would also see the previous case's DOM.
afterEach(cleanup);

describe('TeamProvenancePanel', () => {
  it('orders rows by username, never by who recorded first', async () => {
    const { container } = renderWith([
      claim({ id: 2, memberUsername: 'zoe', recordedAt: '2026-07-01T00:00:00.000Z' }),
      claim({ id: 3, memberUsername: 'amir', recordedAt: '2026-07-30T00:00:00.000Z' }),
    ]);

    await screen.findByText(/2 people/i);
    const names = [...container.querySelectorAll('.team-provenance-row-head strong')]
      .map((node) => node.textContent);
    expect(names).toEqual(['amir', 'zoe']);
  });

  /**
   * A time-ordered list of who recorded a fingerprint reads as a priority claim whether or not it
   * is meant to. This sentence is the standing correction, and it is pinned wherever a timestamp
   * is visible.
   */
  it('pins the ordering disclaimer wherever recorded times are shown', async () => {
    renderWith([claim({})]);
    expect(await screen.findByText(ORDERING_DISCLAIMER)).toBeTruthy();
    expect(ORDERING_DISCLAIMER).toMatch(/not a record of who authored/i);
  });

  it('marks a same-version row as an exact fingerprint match', async () => {
    renderWith([claim({})]);
    expect(await screen.findByText(/exact curve fingerprint match/i)).toBeTruthy();
    // Two VERIFIED marks: the panel header (a lookup ran) and the row (this fingerprint matched).
    expect(screen.getAllByTitle(/computed by creatorflow/i).length).toBeGreaterThanOrEqual(2);
  });

  /** State 4b: recorded, but this build cannot compare against it. Shown, never counted. */
  it('renders another fingerprint version as not comparable rather than as a match', async () => {
    renderWith([claim({ algorithmVersion: 'creatorflow.motion-fingerprint/v2' })]);
    expect(await screen.findByText(/different fingerprint version — not comparable/i)).toBeTruthy();
    expect(screen.queryByText(/exact curve fingerprint match/i)).toBeNull();
    expect(screen.getByTitle(/did not or cannot check this/i)).toBeTruthy();
  });

  /** State 5: not a format this build knows at all. Still shown — never silently dropped. */
  it('renders an unrecognized fingerprint format as unknown, and still shows the row', async () => {
    const { container } = renderWith([claim({ algorithmVersion: 'somebody-elses-hash/v1' })]);
    expect(await screen.findByText(/unknown fingerprint format/i)).toBeTruthy();
    expect(container.querySelectorAll('.team-provenance-row')).toHaveLength(1);
  });

  it('never claims a match when this build does not know its own fingerprint version', async () => {
    renderWith([claim({})], null);
    expect(await screen.findByText(/different fingerprint version — not comparable/i)).toBeTruthy();
  });

  it('attributes declared text to the person by name, apart from the verified facts', async () => {
    renderWith([claim({
      memberUsername: 'mira',
      declaredSource: 'Authored in-house',
      declaredLicense: 'All rights reserved',
      robloxAssetId: 90110,
    })]);

    expect(await screen.findByText('mira declared:')).toBeTruthy();
    expect(screen.getByText('Authored in-house')).toBeTruthy();
    // The declared block carries its own DECLARED mark, so nothing in it reads as CreatorFlow's.
    expect(screen.getByTitle(/entered by a person/i)).toBeTruthy();
  });

  it('offers retract only on your own rows', async () => {
    const { container } = renderWith([
      claim({ id: 1, memberUsername: 'amir', isYours: false }),
      claim({ id: 2, memberUsername: 'zoe', isYours: true }),
    ]);

    await screen.findByText(/2 people/i);
    const buttons = container.querySelectorAll('.team-provenance-retract');
    expect(buttons).toHaveLength(1);
    expect(container.querySelector('[data-yours="true"] .team-provenance-retract')).toBeTruthy();
  });

  it('renders one claim without pluralising it', async () => {
    renderWith([claim({})]);
    expect(await screen.findByText(/1 person/i)).toBeTruthy();
  });
});
