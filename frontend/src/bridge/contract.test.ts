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

const ORIGIN = 'http://127.0.0.1:1';

function jsonResponse(body: unknown) {
  // Built per call: a Response body can only be read once, and detect() plus the method under test
  // are two separate reads.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A client wired to a fetch that replays one fixture.
 *
 * Going through `LocalBridgeClient` rather than reading the JSON directly is the whole point: it
 * exercises the real request path, the real error handling and the real response parsing, so a
 * change in how the client unwraps a payload is caught as well as a change in the payload.
 */
async function clientReturning(body: unknown) {
  let first = true;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (first) {
      first = false;
      return jsonResponse({ csrfToken: 'test-csrf', origin: ORIGIN, openCloudKeyConfigured: false });
    }
    return jsonResponse(body);
  }));
  // detect() validates the session against the page origin, and vitest's node environment has no
  // window. Going through detect() rather than the constructor is not a formality: the constructor
  // is private, and reaching past it would be testing a construction path the product never uses.
  vi.stubGlobal('window', { location: { origin: ORIGIN } });
  const client = await LocalBridgeClient.detect();
  if (!client) throw new Error('test setup: detect() returned null');
  return client;
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
    const client = await clientReturning(fixture('projects'));
    const projects = await client.listProjects();
    expect(projects.items.length).toBeGreaterThan(0);
    const first = projects.items[0];
    expect(typeof first.projectId).toBe('number');
    expect(typeof first.name).toBe('string');
    // Nullable on purpose: a project with no scan yet. The UI branches on this.
    expect(['string', 'object']).toContain(typeof first.activeScanRunId);
  });

  it('parses an assets page, including the run id the UI keys off', async () => {
    const client = await clientReturning(fixture('assets-page'));
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
    const client = await clientReturning(fixture('asset-detail'));
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
    const client = await clientReturning(fixture('scan-run'));
    const run = await client.getScanRun('669ab1d1-3462-493d-8efb-420392cc5015');
    expect(typeof run.id).toBe('string');
    expect(typeof run.state).toBe('string');
    for (const key of ['discoveredCount', 'processedCount', 'supportedCount', 'failedCount'] as const) {
      expect(typeof run[key], `${key} is not a number`).toBe('number');
    }
    expect(Array.isArray(run.warnings)).toBe(true);
  });

  it('parses decision history as a list, and keeps the batch marker on the rows that have one', async () => {
    const client = await clientReturning(fixture('decision-history'));
    const history = await client.getDecisionHistory(1);
    expect(Array.isArray(history.items)).toBe(true);
    const decision = history.items[0];
    /**
     * The fixture is recorded from a real batch, so these two keys are the disclosure that a
     * judgement was one of several made in one act. Losing either would make a batched decision
     * indistinguishable from a considered per-file one — the exact conflation the batch id exists
     * to prevent — and it would fail silently, since the marker simply would not render.
     */
    expect(typeof decision.batchId).toBe('string');
    expect(typeof decision.batchAssetCount).toBe('number');
  });

  it('parses review groups, including what each group allows and the two drift tokens', async () => {
    const client = await clientReturning(fixture('review-groups'));
    const groups = await client.listReviewGroups('00000000-0000-0000-0000-000000000000');
    expect(typeof groups.scanRunId).toBe('string');
    expect(['PASS', 'BLOCKED']).toContain(groups.gateResult);
    const group = groups.groups[0];
    expect(typeof group.code).toBe('string');
    expect(typeof group.message).toBe('string');
    /**
     * The safety surface, served rather than inferred: the same table gates what the panel renders
     * and what the bridge accepts. If this arrived as something other than an array of action names
     * the panel would render no actions at all, which is the fail-safe direction.
     */
    expect(Array.isArray(group.batchableActions)).toBe(true);
    expect(group.batchableActions).not.toContain('APPROVED');
    expect(group.batchableActions).not.toContain('BLOCKED');

    const asset = group.assets[0];
    expect(typeof asset.scanAssetId).toBe('number');
    expect(typeof asset.relativePath).toBe('string');
    expect(typeof asset.sha256).toBe('string');
    // Echoed back on submit as the drift tokens, so both must survive as their nullable selves —
    // null is "nothing recorded yet", and sending the wrong shape would silently clobber a write.
    expect(['string', 'object']).toContain(typeof asset.latestDecisionId);
    expect(['number', 'object']).toContain(typeof asset.latestSourceEvidenceId);
  });

  it('parses ownership verifications as a list', async () => {
    const client = await clientReturning(fixture('ownership-verifications'));
    const verifications = await client.listOwnershipVerifications(1);
    expect(Array.isArray(verifications.items)).toBe(true);
  });

  it('parses the release list', async () => {
    const client = await clientReturning(fixture('releases'));
    const releases = await client.listProjectReleases(1);
    expect(Array.isArray(releases.items)).toBe(true);
  });

  it('parses a gate preview, including the id that makes a violation jumpable', async () => {
    const client = await clientReturning(fixture('gate-preview'));
    const preview = await client.previewGate(1);
    expect(typeof preview.scanRunId).toBe('string');
    expect(typeof preview.evaluatedAt).toBe('string');
    expect(typeof preview.passed).toBe('boolean');
    // The count the panel renders comes from here, never from how many rows it drew.
    expect(typeof preview.summary.violations).toBe('number');
    const violation = preview.violations[0];
    expect(typeof violation.code).toBe('string');
    // `path`, not `assetPath` — a manifest's embedded gate block uses the other name for the same
    // thing, and a rename in either direction would silently break the row-to-asset mapping.
    expect(typeof violation.path).toBe('string');
    expect(typeof violation.message).toBe('string');
    /**
     * The whole reason this route exists rather than the workspace parsing the downloadable
     * report: the gate is keyed by path, every decision affordance is keyed by this numeric id.
     * Nullable on purpose — an unresolvable path must arrive as an honest null, not a guess — so
     * both types are accepted here and the UI branches on it.
     */
    expect(['number', 'object']).toContain(typeof violation.scanAssetId);
  });

  it('parses workspace state, whose fields are all nullable', async () => {
    const state = fixture('workspace-state') as Record<string, unknown>;
    // Every one of these is null on a fresh install; the UI must not assume otherwise.
    for (const key of ['activeProjectId', 'activeScanRunId', 'selectedAssetId', 'selectedFindingId']) {
      expect(state, `workspace-state lost the ${key} key`).toHaveProperty(key);
    }
  });
});
