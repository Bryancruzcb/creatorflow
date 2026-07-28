import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalBridgeClient } from './localBridge';

/**
 * The client, against bytes the real server actually produced.
 *
 * `localBridge.test.ts` and its siblings stub `fetch` with hand-written responses, so they assert
 * this client against someone's idea of what the Java server returns. That catches client bugs and
 * is structurally blind to server drift: rename a field in `LocalBridgeServer.java` and every one
 * of those tests still passes while the desktop app breaks.
 *
 * The fixtures in `contract-fixtures/` are written by
 * `desktop/src/test/java/creatorflow/bridge/LocalBridgeServerTest#writesContractFixturesForTheTypeScriptClient`,
 * which starts a real `LocalBridgeServer`, authenticates against it, and records what came back.
 * Regenerate with:
 *
 *   mvn -pl desktop -am test -Dtest=LocalBridgeServerTest
 *
 * The point is the coupling: a field renamed on the Java side changes the committed fixture, and
 * the next run of THIS suite fails. Neither half can drift without the other noticing, without
 * either CI job having to run the other's toolchain.
 *
 * These assert the shapes the UI actually reads. They are deliberately not exhaustive field-by-field
 * snapshots — a snapshot of every key would fail on additions, which are harmless, and would train
 * whoever hits it to re-record without looking.
 */

const FIXTURES = resolve(__dirname, 'contract-fixtures');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8'));
}

/**
 * A client wired to a fetch that replays one fixture.
 *
 * Going through `LocalBridgeClient` rather than reading the JSON directly is the whole point: it
 * exercises the real request path, the real error handling and the real response parsing, so a
 * change in how the client unwraps a payload is caught as well as a change in the payload.
 */
function clientReturning(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return new LocalBridgeClient(
    { csrfToken: 'test-csrf', origin: 'http://127.0.0.1:1', openCloudKeyConfigured: false },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bridge contract', () => {
  it('parses a session the server produced', () => {
    const session = fixture('session') as Record<string, unknown>;
    // These three are what the client stores and what the ownership panel reads to decide whether
    // it can honestly offer a verify action.
    expect(typeof session.csrfToken).toBe('string');
    expect(typeof session.origin).toBe('string');
    expect(typeof session.openCloudKeyConfigured).toBe('boolean');
  });

  it('parses the project list', async () => {
    const client = clientReturning(fixture('projects'));
    const projects = await client.listProjects();
    expect(projects.items.length).toBeGreaterThan(0);
    const first = projects.items[0];
    expect(typeof first.projectId).toBe('number');
    expect(typeof first.name).toBe('string');
    // Nullable on purpose: a project with no scan yet. The UI branches on this.
    expect(['string', 'object']).toContain(typeof first.activeScanRunId);
  });

  it('parses an assets page, including the run id the UI keys off', async () => {
    const client = clientReturning(fixture('assets-page'));
    const page = await client.listProjectAssets(1, 100, 0);
    expect(typeof page.scanRunId).toBe('string');
    expect(Array.isArray(page.items)).toBe(true);
    const asset = page.items[0];
    expect(typeof asset.id).toBe('number');
    expect(typeof asset.relativePath).toBe('string');
    expect(typeof asset.sha256).toBe('string');
    // The tri-state the whole product turns on. A rename here is a silent verdict change.
    expect(['CLEAR', 'REVIEW', 'BLOCKED']).toContain(asset.verification);
  });

  it('parses an asset detail, and keeps sourceEvidence distinguishable from a decision', async () => {
    const client = clientReturning(fixture('asset-detail'));
    const detail = await client.getAsset(1);
    expect(typeof detail.asset.id).toBe('number');
    expect(Array.isArray(detail.findings)).toBe(true);
    /**
     * sourceEvidence is what a person DECLARED; latestDecision is what a person DECIDED. The UI
     * marks them differently on purpose — collapsing the two is the confident-false-claim failure
     * this product exists to avoid — so both keys must survive, including as null.
     */
    expect(detail).toHaveProperty('sourceEvidence');
    expect(detail).toHaveProperty('latestDecision');
  });

  it('parses a scan run with the counters the progress UI reads', async () => {
    const client = clientReturning(fixture('scan-run'));
    const run = await client.getScanRun('669ab1d1-3462-493d-8efb-420392cc5015');
    expect(typeof run.id).toBe('string');
    expect(typeof run.state).toBe('string');
    for (const key of ['discoveredCount', 'processedCount', 'supportedCount', 'failedCount'] as const) {
      expect(typeof run[key], `${key} is not a number`).toBe('number');
    }
    expect(Array.isArray(run.warnings)).toBe(true);
  });

  it('parses decision history as a list', async () => {
    const client = clientReturning(fixture('decision-history'));
    const history = await client.getDecisionHistory(1);
    expect(Array.isArray(history.items)).toBe(true);
  });

  it('parses ownership verifications as a list', async () => {
    const client = clientReturning(fixture('ownership-verifications'));
    const verifications = await client.listOwnershipVerifications(1);
    expect(Array.isArray(verifications.items)).toBe(true);
  });

  it('parses the release list', async () => {
    const client = clientReturning(fixture('releases'));
    const releases = await client.listProjectReleases(1);
    expect(Array.isArray(releases.items)).toBe(true);
  });

  it('parses workspace state, whose fields are all nullable', async () => {
    const state = fixture('workspace-state') as Record<string, unknown>;
    // Every one of these is null on a fresh install; the UI must not assume otherwise.
    for (const key of ['activeProjectId', 'activeScanRunId', 'selectedAssetId', 'selectedFindingId']) {
      expect(state, `workspace-state lost the ${key} key`).toHaveProperty(key);
    }
  });
});
