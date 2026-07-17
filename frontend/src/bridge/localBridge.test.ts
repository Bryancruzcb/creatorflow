import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalBridgeClient, LocalBridgeError, type LocalScanRun } from './localBridge';

const ORIGIN = 'http://localhost:5173';
const CSRF_TOKEN = 'csrf-token-abc123';

let fetchMock: ReturnType<typeof vi.fn>;

/** A minimal fetch Response stand-in — only the members `request()`/`detect()` actually touch. */
function fakeResponse(status: number, body: unknown, contentType: string | null = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

/** Stubs the session fetch and returns a real, constructed LocalBridgeClient via the real detect() path. */
async function createClient(): Promise<LocalBridgeClient> {
  fetchMock.mockResolvedValueOnce(fakeResponse(200, { csrfToken: CSRF_TOKEN, origin: ORIGIN }));
  const client = await LocalBridgeClient.detect();
  if (!client) throw new Error('test setup: detect() unexpectedly returned null');
  fetchMock.mockClear();
  return client;
}

const RUN: LocalScanRun = {
  id: 'run-1',
  projectId: 7,
  release: 'Working',
  state: 'RUNNING',
  discoveredCount: 10,
  processedCount: 4,
  bytesProcessed: 4096,
  supportedCount: 3,
  ignoredCount: 1,
  excludedCount: 0,
  unreadableCount: 0,
  missingDependencyCount: 0,
  failedCount: 0,
  warnings: [],
  error: null,
  createdAt: '2026-01-01T00:00:00Z',
  startedAt: '2026-01-01T00:00:01Z',
  completedAt: null,
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // `window` isn't defined in vitest's node environment; localBridge.ts reads
  // window.location.origin (session validation) and window.setTimeout/clearTimeout (polling).
  // Forward the timer calls to globalThis dynamically (not bound early) so they still resolve
  // to vitest's faked timers in tests that call vi.useFakeTimers() after this stub is installed.
  vi.stubGlobal('window', {
    location: { origin: ORIGIN },
    setTimeout: (...args: Parameters<typeof setTimeout>) => globalThis.setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...args),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LocalBridgeClient.detect', () => {
  it('returns a session-backed client when the session endpoint resolves ok with a matching-origin JSON body', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { csrfToken: CSRF_TOKEN, origin: ORIGIN }));

    const client = await LocalBridgeClient.detect();

    expect(client).not.toBeNull();
    expect(client!.session).toEqual({ csrfToken: CSRF_TOKEN, origin: ORIGIN });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/session', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('returns null when the fetch itself rejects (offline / no local bridge running)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect(await LocalBridgeClient.detect()).toBeNull();
  });

  it('returns null on a non-ok status', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(503, { csrfToken: CSRF_TOKEN, origin: ORIGIN }));

    expect(await LocalBridgeClient.detect()).toBeNull();
  });

  it('returns null when the response body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, '<html>not the bridge</html>', 'text/html'));

    expect(await LocalBridgeClient.detect()).toBeNull();
  });

  it('returns null when the JSON body is not a valid session (missing csrfToken, or origin mismatch)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, { csrfToken: '', origin: ORIGIN }));
    expect(await LocalBridgeClient.detect()).toBeNull();

    fetchMock.mockResolvedValueOnce(fakeResponse(200, { csrfToken: CSRF_TOKEN, origin: 'http://evil.example' }));
    expect(await LocalBridgeClient.detect()).toBeNull();
  });
});

describe('LocalBridgeClient request wrapper (exercised via public methods)', () => {
  it('sends a GET with credentials included and no CSRF header, and round-trips the JSON body', async () => {
    const client = await createClient();
    const payload = { items: [{ projectId: 1, name: 'Obby', adoptedAt: '2026-01-01T00:00:00Z', activeScanRunId: null }] };
    fetchMock.mockResolvedValueOnce(fakeResponse(200, payload));

    const result = await client.listProjects();

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/projects');
    expect(options).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(options.headers).toEqual({ Accept: 'application/json' });
    expect(options.body).toBeUndefined();
  });

  it('injects the CSRF header and Content-Type on a POST, and serializes the request body', async () => {
    const client = await createClient();
    const decision = { id: 'dec-1', scanAssetId: 42, type: 'APPROVED', reason: 'Looks clean', supersedesDecisionId: null, createdAt: '2026-01-01T00:00:00Z' };
    fetchMock.mockResolvedValueOnce(fakeResponse(200, decision));

    const result = await client.recordDecision(42, 'APPROVED', 'Looks clean');

    expect(result).toEqual(decision);
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/assets/42/decisions');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers).toEqual({
      Accept: 'application/json',
      'X-CreatorFlow-CSRF': CSRF_TOKEN,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(options.body)).toEqual({ type: 'APPROVED', reason: 'Looks clean' });
  });

  it('omits supersedesDecisionId from the body when not superseding a prior decision', async () => {
    const client = await createClient();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, {}));

    await client.recordDecision(42, 'BLOCKED', 'Unlicensed asset', 'prior-decision-id');

    const options = fetchMock.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ type: 'BLOCKED', reason: 'Unlicensed asset', supersedesDecisionId: 'prior-decision-id' });
  });

  it('throws a LocalBridgeError carrying the server error envelope and status on a non-ok JSON response', async () => {
    const client = await createClient();
    fetchMock.mockResolvedValueOnce(fakeResponse(404, { error: 'Unknown scan asset 999' }));

    await expect(client.getAsset(999)).rejects.toMatchObject(
      new LocalBridgeError('Unknown scan asset 999', 404),
    );
  });

  it('falls back to a generic message when a non-ok response has no JSON error envelope', async () => {
    const client = await createClient();
    fetchMock.mockResolvedValueOnce(fakeResponse(500, 'internal error', null));

    await expect(client.getAsset(1)).rejects.toMatchObject(
      new LocalBridgeError('Local bridge request failed (500)', 500),
    );
  });

  it('throws when an ok response is not JSON', async () => {
    const client = await createClient();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, 'plain text', 'text/plain'));

    await expect(client.getAsset(1)).rejects.toMatchObject(
      new LocalBridgeError('Local bridge returned an unexpected response', 200),
    );
  });

  it('returns null for a 204 No Content response without attempting to parse a body', async () => {
    const client = await createClient();
    fetchMock.mockResolvedValueOnce(fakeResponse(204, null, null));

    await expect(client.getAsset(1)).resolves.toBeNull();
  });

  it('round-trips a create-style POST (bindExperience) into its typed record shape', async () => {
    const client = await createClient();
    const record = {
      projectId: 3, name: 'Tower Defense', experience: { universeId: 111, placeId: 222, experienceName: 'Tower Defense' },
      adoptedAt: '2026-01-01T00:00:00Z', activeScanRunId: null,
    };
    fetchMock.mockResolvedValueOnce(fakeResponse(200, record));

    const result = await client.bindExperience(3, { universeId: 111, placeId: 222, experienceName: 'Tower Defense' });

    expect(result).toEqual(record);
    const [path, options] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/v1/projects/3/experience');
    expect(JSON.parse(options.body)).toEqual({ universeId: 111, placeId: 222, experienceName: 'Tower Defense' });
  });
});

describe('LocalBridgeClient.subscribeToScanEvents', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    listeners = new Map<string, (event: Event) => void>();
    onerror: (() => void) | null = null;
    close = vi.fn();
    constructor(readonly url: string, readonly init: unknown) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(name: string, handler: (event: Event) => void) {
      this.listeners.set(name, handler);
    }
  }

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('opens a same-origin credentialed stream and registers a listener for every scan event type', async () => {
    const client = await createClient();
    const unsubscribe = client.subscribeToScanEvents('run-1', vi.fn());

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/v1/scan-runs/run-1/events');
    expect(source.init).toEqual({ withCredentials: true });
    expect([...source.listeners.keys()]).toEqual([
      'started', 'discovered', 'file_started', 'file_completed', 'file_skipped', 'warning', 'error', 'cancelled', 'completed',
    ]);

    unsubscribe();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it('parses a well-formed SSE frame and forwards it to onEvent', async () => {
    const client = await createClient();
    const onEvent = vi.fn();
    client.subscribeToScanEvents('run-1', onEvent);
    const source = FakeEventSource.instances[0]!;

    const payload = {
      sequence: 5, runId: 'run-1', timestamp: '2026-01-01T00:00:05Z', type: 'DISCOVERED',
      processedFiles: 2, discoveredFiles: 5, bytesProcessed: 1024, currentRelativePath: 'art/hero.png',
      warning: null, error: null,
    };
    source.listeners.get('discovered')!(new MessageEvent('discovered', { data: JSON.stringify(payload) }));

    expect(onEvent).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('swallows a malformed SSE frame instead of throwing (a bad progress frame must not invalidate the run)', async () => {
    const client = await createClient();
    const onEvent = vi.fn();
    client.subscribeToScanEvents('run-1', onEvent);
    const source = FakeEventSource.instances[0]!;

    expect(() => source.listeners.get('warning')!(new MessageEvent('warning', { data: 'not-json{' }))).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('invokes onDisconnect when the stream errors', async () => {
    const client = await createClient();
    const onDisconnect = vi.fn();
    client.subscribeToScanEvents('run-1', vi.fn(), onDisconnect);
    const source = FakeEventSource.instances[0]!;

    source.onerror?.();

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe('LocalBridgeClient.followScan (SSE + polling fallback)', () => {
  class NoopEventSource {
    addEventListener() {}
    close = vi.fn();
    onerror: (() => void) | null = null;
    constructor(readonly url: string, readonly init: unknown) {}
  }

  beforeEach(() => {
    vi.stubGlobal('EventSource', NoopEventSource);
  });

  it('polls once immediately and stops scheduling further polls once the run is already terminal', async () => {
    const client = await createClient();
    const completed: LocalScanRun = { ...RUN, state: 'COMPLETED' };
    fetchMock.mockResolvedValueOnce(fakeResponse(200, completed));

    const onRun = vi.fn();
    const stop = await client.followScan('run-1', { onRun, onEvent: vi.fn(), onError: vi.fn() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledExactlyOnceWith(completed);
    expect(typeof stop).toBe('function');
  });

  it('reschedules at the normal ~900ms interval while running, and stops once a later poll reports a terminal state', async () => {
    vi.useFakeTimers();
    const client = await createClient();
    const running: LocalScanRun = { ...RUN, state: 'RUNNING' };
    const completed: LocalScanRun = { ...RUN, state: 'COMPLETED' };
    fetchMock.mockResolvedValueOnce(fakeResponse(200, running));
    fetchMock.mockResolvedValueOnce(fakeResponse(200, completed));

    const onRun = vi.fn();
    await client.followScan('run-1', { onRun, onEvent: vi.fn(), onError: vi.fn() });
    expect(onRun).toHaveBeenLastCalledWith(running);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(900);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRun).toHaveBeenLastCalledWith(completed);

    // Terminal: no further poll should be scheduled even after a long wait.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('switches to the faster ~600ms poll interval after the SSE stream disconnects', async () => {
    vi.useFakeTimers();
    let sourceInstance: NoopEventSource | null = null;
    class DisconnectingEventSource extends NoopEventSource {
      constructor(url: string, init: unknown) {
        super(url, init);
        sourceInstance = this;
      }
    }
    vi.stubGlobal('EventSource', DisconnectingEventSource);

    const client = await createClient();
    const running: LocalScanRun = { ...RUN, state: 'RUNNING' };
    fetchMock.mockResolvedValueOnce(fakeResponse(200, running));
    fetchMock.mockResolvedValueOnce(fakeResponse(200, running));
    fetchMock.mockResolvedValueOnce(fakeResponse(200, running));

    const stop = await client.followScan('run-1', { onRun: vi.fn(), onEvent: vi.fn(), onError: vi.fn() });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Simulate the SSE connection dropping. Per the source comment, the flag is re-read on every
    // reschedule, so it only takes effect starting with the NEXT poll's reschedule — not the one
    // already pending (scheduled at the normal 900ms before the drop).
    sourceInstance!.onerror?.();

    await vi.advanceTimersByTimeAsync(900);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // This reschedule was armed with fastPoll now true. Advancing by exactly 600ms (well under the
    // normal 900ms) proves the shorter interval was actually used, not just eventually reached.
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    stop();
  });

  it('reports a poll failure via onError without stopping, when getScanRun rejects', async () => {
    const client = await createClient();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    const onError = vi.fn();
    const stop = await client.followScan('run-1', { onRun: vi.fn(), onEvent: vi.fn(), onError });

    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
    stop();
  });
});
