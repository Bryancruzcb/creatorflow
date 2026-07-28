import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalBridgeClient, LocalBridgeError } from './localBridge';

/**
 * The client against a real HTTP server, over a real socket, with a real `EventSource`.
 *
 * The sibling suites all replace `fetch` and `EventSource` with hand-written stubs, and
 * `localBridge.test.ts` already covers the CSRF placement, the error matrix and the poll intervals
 * that way. This suite is an *integration* check instead: the whole path — handshake, request,
 * subscribe, receive — running end to end against a real socket and the real SSE implementation,
 * where the stubs each verify one hop in isolation.
 *
 * It does not reproduce that matrix. Where it overlaps — CSRF placement, one 429 — it takes a
 * single representative case and checks it against what the *server received*, not against the
 * arguments the client handed a mock. Every status code and every poll interval stays where it is
 * already covered.
 *
 * ## How much this actually adds, measured rather than asserted
 *
 * Three canaries were run against the client to find out, and the results are recorded here because
 * two of them are unflattering:
 *
 *  - Exact-matching the content type (`=== 'application/json'` instead of `.includes(…)`, which the
 *    real server's `; charset=utf-8` suffix breaks) fails here — and also fails a stub test. Live,
 *    but not unique.
 *  - Tightening the frame guard to `message.constructor !== MessageEvent` does **not** fail here.
 *    Undici's EventSource dispatches the global `MessageEvent`, so the cross-realm mismatch that
 *    would make this suite uniquely valuable does not occur on this substrate. The earlier version
 *    of this comment claimed it did; it was wrong.
 *  - Deleting the client's try/catch around `JSON.parse` does **not** fail here either. A real
 *    EventSource survives a throwing listener, so the frame after a malformed one still arrives.
 *    The swallow is guarded by `localBridge.test.ts`, not by this file.
 *
 * So: no canary was found that this suite catches and the stubs miss. Its value is guarding the
 * *substrate* rather than our logic — header formats, SSE framing, and the assumption that a real
 * EventSource routes a named `event: discovered` frame to a listener registered under that name at
 * all. That assumption is load-bearing for the entire scan UI and, until now, was tested nowhere.
 * That is a smaller claim than "the stubs are blind", and it is the one the evidence supports.
 *
 * ## What this does NOT cover, and why
 *
 * The session cookie. The client sends `credentials: 'same-origin'` on every request, and that is
 * the single most important thing on this wire — but Node's fetch has no cookie jar, so
 * `credentials` is inert here and asserting on it would be theatre. Verifying it needs a real
 * browser. It is called out rather than quietly skipped.
 *
 * ## What the fake is worth
 *
 * This is the client against a server that behaves the way I believe the real one does — a belief,
 * not a measurement. `contract.test.ts` is what keeps it honest: its fixtures are bytes the real
 * Java server produced. This suite covers the behaviours those static fixtures cannot express.
 *
 * Requires `--experimental-eventsource`, supplied by `poolOptions.forks.execArgv` in
 * `vitest.config.ts`. Node has `fetch` but not `EventSource` without it, and a polyfill would only
 * test the polyfill — the whole point here is the implementation a browser would give us.
 */

/** One request as the server saw it, off the socket. */
interface Received {
  method: string;
  path: string;
  csrf: string | undefined;
  accept: string | undefined;
  contentType: string | undefined;
  body: string;
}

/** A frame to push down the SSE stream: a named event, or a deliberately unparseable one. */
type Frame = { event: string; data: unknown } | { event: string; malformed: true };

interface Fake {
  server: Server;
  origin: string;
  received: Received[];
  streams: ServerResponse[];
  /** Pushed to whichever SSE stream is currently open. */
  push(frame: Frame): void;
}

const CSRF = 'wire-test-csrf-token';

/** The scan-run body shape, trimmed to the counters `getScanRun` consumers read. */
const SCAN_RUN = {
  id: 'run-1',
  projectId: 1,
  release: '1.0.0',
  state: 'RUNNING',
  discoveredCount: 2,
  processedCount: 1,
  bytesProcessed: 10,
  supportedCount: 2,
  ignoredCount: 0,
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

async function startFake(): Promise<Fake> {
  const received: Received[] = [];
  const streams: ServerResponse[] = [];
  let origin = '';

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://placeholder').pathname;
    readBody(req).then((body) => {
      received.push({
        method: req.method ?? 'GET',
        path,
        csrf: header(req, 'x-creatorflow-csrf'),
        accept: header(req, 'accept'),
        contentType: header(req, 'content-type'),
        body,
      });
      route(path, res);
    });
  });

  const json = (res: ServerResponse, status: number, body: unknown) => {
    // Byte-for-byte the header the Java server sets, charset suffix included: the client matches
    // content types with `.includes()`, and an exact-equality regression would pass every stubbed
    // test (they send a bare `application/json`) while rejecting every real response.
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const route = (path: string, res: ServerResponse) => {
    if (path === '/api/v1/session') {
      json(res, 200, { csrfToken: CSRF, origin, openCloudKeyConfigured: false });
      return;
    }
    if (path.endsWith('/events')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      // Left open on purpose. Ending it would make the real EventSource reconnect, which would
      // reopen a stream against a server the test is about to close.
      streams.push(res);
      return;
    }
    // The documented 429 path. Asset id 429 selects it so a real public method reaches it —
    // `request` is private and reaching past that would test a shape the product never uses.
    if (path === '/api/v1/assets/429/verify-ownership') {
      json(res, 429, {
        error: 'Roblox Open Cloud is rate-limiting requests. Wait a moment and try again.',
        retryAfterSeconds: 17,
      });
      return;
    }
    if (path.startsWith('/api/v1/scan-runs/')) {
      json(res, 200, SCAN_RUN);
      return;
    }
    json(res, 200, { ok: true });
  };

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    server,
    origin,
    received,
    streams,
    push(frame) {
      const stream = streams.at(-1);
      if (!stream) throw new Error('push() before any SSE stream was opened');
      const data = 'malformed' in frame ? '{not json' : JSON.stringify(frame.data);
      stream.write(`event: ${frame.event}\ndata: ${data}\n\n`);
    },
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => done(body));
  });
}

/**
 * Resolves the client's relative URLs against the fake, and otherwise gets out of the way.
 *
 * The client hardcodes `/api/v1/…`, which Node rejects outright — there is no document to resolve
 * against. This is the one seam between the client and the socket, and it is kept to a URL rewrite
 * precisely so that everything the assertions look at (headers, status, framing) is still produced
 * by the real implementations. Assertions read what the *server* received, never what this saw.
 */
function installOrigin(origin: string) {
  const realFetch = globalThis.fetch;
  const RealEventSource = globalThis.EventSource;

  if (typeof RealEventSource !== 'function') {
    throw new Error(
      'EventSource is unavailable. This suite needs Node 22.3+ with --experimental-eventsource, '
      + 'which vitest.config.ts passes when the running Node still recognises the flag.',
    );
  }

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(new URL(String(input), origin), init)) as typeof fetch;

  globalThis.EventSource = class extends RealEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(new URL(String(url), origin), init);
    }
  } as typeof EventSource;

  // `toSession` compares the payload origin against the page's, and `followScan` schedules on
  // `window`. Neither exists in the node environment this project's tests run in.
  globalThis.window = {
    location: { origin },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  } as unknown as Window & typeof globalThis;

  return () => {
    globalThis.fetch = realFetch;
    globalThis.EventSource = RealEventSource;
    delete (globalThis as { window?: unknown }).window;
  };
}

// Definite-assignment so the test bodies can read `fake` directly; teardown re-widens it, because
// setup can fail and teardown must not throw over the top of the real error.
let fake!: Fake;
let restore: (() => void) | undefined;
/** Unsubscribes to run before the server closes, so no EventSource outlives the port. */
let closers: Array<() => void> = [];

beforeEach(async () => {
  closers = [];
  fake = await startFake();
  restore = installOrigin(fake.origin);
});

// Ordered so nothing is left holding the port: clients first, then streams, then the globals, then
// the server. Each step is guarded because a failure in setup must not cascade into teardown noise
// that hides it.
afterEach(async () => {
  for (const close of closers) close();
  const started = fake as Fake | undefined;
  for (const stream of started?.streams ?? []) stream.end();
  restore?.();
  restore = undefined;
  if (started) await new Promise<void>((done) => { started.server.close(() => done()); });
});

/** The real entry point: a session fetched over the socket, not a hand-built client object. */
async function connect() {
  const client = await LocalBridgeClient.detect();
  if (!client) throw new Error('detect() found no bridge — the fake did not answer /api/v1/session');
  return client;
}

/** Resolves once `count` events have arrived, so the tests wait on the stream, not on a clock. */
function collect(count: number) {
  const events: Array<{ type: string }> = [];
  let settle: () => void;
  const done = new Promise<void>((resolve) => { settle = resolve; });
  const onEvent = (event: unknown) => {
    events.push(event as { type: string });
    if (events.length >= count) settle();
  };
  return { events, onEvent, done };
}

describe('bridge wire behaviour', () => {
  it('completes the session handshake against a real server', async () => {
    const client = await connect();

    expect(client.session.csrfToken).toBe(CSRF);
    expect(client.session.origin).toBe(fake.origin);

    const session = fake.received.find((r) => r.path === '/api/v1/session');
    expect(session?.method).toBe('GET');
    expect(session?.accept).toBe('application/json');
  });

  it('delivers named SSE frames to the subscriber through a real EventSource', async () => {
    const client = await connect();
    const { events, onEvent, done } = collect(3);
    closers.push(client.subscribeToScanEvents('run-1', onEvent));

    // Wait for the stream to be accepted before pushing, or the frames go nowhere.
    await expect.poll(() => fake.streams.length).toBe(1);
    fake.push({ event: 'started', data: { sequence: 1, runId: 'run-1', type: 'STARTED' } });
    fake.push({ event: 'discovered', data: { sequence: 2, runId: 'run-1', type: 'DISCOVERED' } });
    fake.push({ event: 'completed', data: { sequence: 3, runId: 'run-1', type: 'COMPLETED' } });
    await done;

    /**
     * The one thing here no stub asserts: that a real EventSource routes an `event: discovered`
     * frame to the listener registered under that exact name, and hands `data` over as the string
     * the client parses. The stub proves the nine listeners are *registered*; this proves frames
     * sent under those names actually arrive. If that were ever untrue the scan UI would go silent
     * with no error raised anywhere — which is the failure this file is really here for.
     */
    expect(events.map((e) => e.type)).toEqual(['STARTED', 'DISCOVERED', 'COMPLETED']);
  });

  it('keeps the stream alive after a malformed frame, and still delivers what follows', async () => {
    const client = await connect();
    const { events, onEvent, done } = collect(2);
    closers.push(client.subscribeToScanEvents('run-1', onEvent));
    await expect.poll(() => fake.streams.length).toBe(1);

    fake.push({ event: 'started', data: { sequence: 1, runId: 'run-1', type: 'STARTED' } });
    fake.push({ event: 'warning', malformed: true });
    fake.push({ event: 'completed', data: { sequence: 3, runId: 'run-1', type: 'COMPLETED' } });
    await done;

    /**
     * The connection survives a bad frame and the next one still arrives. Note what this does and
     * does not protect: deleting the client's try/catch does *not* fail this test, because a real
     * EventSource absorbs a throwing listener on its own. The swallow itself is pinned by
     * `localBridge.test.ts`. What is pinned here is that a bad frame produces no phantom `onEvent`
     * call and does not tear the stream down — a property of the substrate, verified rather than
     * assumed.
     */
    expect(events.map((e) => e.type)).toEqual(['STARTED', 'COMPLETED']);
  });

  it('puts the CSRF header on a POST and leaves it off a GET, as the server sees them', async () => {
    const client = await connect();
    await client.getScanRun('run-1');
    await client.saveWorkspaceState({ activeProjectId: 1, activeScanRunId: null, selectedAssetId: null, selectedFindingId: null });

    const get = fake.received.find((r) => r.path === '/api/v1/scan-runs/run-1');
    const post = fake.received.find((r) => r.method === 'POST');

    expect(get?.csrf, 'the CSRF header rode along on a GET').toBeUndefined();
    expect(post?.csrf, 'a POST reached the server without X-CreatorFlow-CSRF, which it rejects').toBe(CSRF);
    expect(post?.contentType).toBe('application/json');
    expect(JSON.parse(post?.body ?? 'null')).toMatchObject({ activeProjectId: 1 });
  });

  it('maps a 429 envelope off the wire into a typed error carrying the wait', async () => {
    const client = await connect();

    const error = await client.verifyOwnership(429, 12345).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LocalBridgeError);
    expect((error as LocalBridgeError).status).toBe(429);
    // Dropping this is why a rate-limited person could not be told how long to wait.
    expect((error as LocalBridgeError).retryAfterSeconds).toBe(17);
    expect((error as LocalBridgeError).message).toContain('rate-limiting');
  });
});
