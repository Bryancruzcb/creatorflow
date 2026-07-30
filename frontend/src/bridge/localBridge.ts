export type ScanRunState = 'QUEUED' | 'RUNNING' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
export type ScanEventType = 'STARTED' | 'DISCOVERED' | 'FILE_STARTED' | 'FILE_COMPLETED' | 'FILE_SKIPPED' | 'WARNING' | 'ERROR' | 'CANCELLED' | 'COMPLETED';
export type LocalDecisionType = 'APPROVED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'EXCLUDED';

export interface LocalBridgeSession {
  csrfToken: string;
  origin: string;
  /**
   * Whether the desktop reports a Roblox Open Cloud API key configured — a **boolean only**. The key
   * itself never crosses the bridge, and neither does any prefix or masked form of it.
   *
   * `null` means the bridge did not report the flag at all: the status is *unknown*, and the UI must
   * not claim either way (it leaves the verify action available and lets the 409 answer instead).
   */
  openCloudKeyConfigured: boolean | null;
}

export interface LocalPluginPairing {
  id: string;
  projectId: number;
  endpoint: string;
  token: string;
  expiresAt: string;
}

export type PluginPairingStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** A previously issued pairing's metadata — never the token or its hash. */
export interface LocalPluginPairingSummary {
  id: string;
  issuedAt: string;
  expiresAt: string;
  status: PluginPairingStatus;
}

export interface LocalMotionComparison {
  id: string;
  projectId: number;
  sourceAssetId: string;
  candidateAssetId: string;
  sourceName: string;
  candidateName: string;
  sourceDuration: number;
  candidateDuration: number;
  sourceFingerprint: string;
  candidateFingerprint: string;
  overallPercent: number;
  posePercent: number;
  timingPercent: number;
  coveragePercent: number;
  exactCurveData: boolean;
  verdict: string;
  /**
   * True when the score was found by comparing the candidate MIRRORED (#102, #104).
   *
   * Optional because records written before the plugin route moved to v2 have no such field, and
   * absent is correctly read as false for them: the v1 engine could not detect a mirror at all.
   */
  mirrored?: boolean;
  algorithmVersion: string;
  createdAt: string;
  result: Record<string, unknown>;
}

export type AnimationSnapshotKind = 'LAST_KNOWN_GOOD' | 'LAST_PUBLISHED';
export type AnimationSnapshotStatus = 'FIRST_SNAPSHOT' | 'UNCHANGED' | 'CHANGED';

export interface LocalAnimationSnapshot {
  id: string;
  projectId: number;
  assetId: string;
  kind: AnimationSnapshotKind;
  sourceComparisonId: string | null;
  name: string;
  duration: number;
  fingerprint: string;
  algorithmVersion: string;
  supersedesSnapshotId: string | null;
  status: AnimationSnapshotStatus;
  createdAt: string;
}

/** A user-declared intended Roblox experience binding — CreatorFlow does not verify ownership of or access to it. */
export interface LocalIntendedExperience {
  universeId: number;
  placeId: number;
  experienceName: string;
}

export interface LocalProjectSummary {
  projectId: number;
  name: string;
  experience?: LocalIntendedExperience | null;
}

export interface LocalProjectRecord extends LocalProjectSummary {
  adoptedAt: string;
  activeScanRunId: string | null;
}

export interface LocalWorkspaceState {
  activeProjectId: number | null;
  activeScanRunId: string | null;
  selectedAssetId: number | null;
  selectedFindingId: number | null;
  filters?: Record<string, unknown>;
  queue?: unknown[];
  filtersJson?: string;
  queueJson?: string;
  updatedAt: string | null;
}

export interface SaveWorkspaceStateRequest {
  activeProjectId?: number | null;
  activeScanRunId?: string | null;
  selectedAssetId?: number | null;
  selectedFindingId?: number | null;
  filters?: Record<string, unknown>;
  queue?: unknown[];
}

export interface LocalReleaseComparison {
  previousReleaseId: string | null;
  added: number;
  changed: number;
  removed: number;
  addedPaths: string[];
  changedPaths: string[];
  removedPaths: string[];
  unresolved: number;
  approved: number;
  blocked: number;
  excluded: number;
}

export interface LocalRelease {
  id: string;
  scanRunId: string;
  release: string;
  releaseName?: string;
  policyResult: 'PASS' | 'BLOCKED';
  createdAt: string;
  manifestUrl: string;
  reportUrl: string;
  comparison: LocalReleaseComparison;
  report?: unknown;
  experience?: LocalIntendedExperience | null;
  /** The Roblox place version a team reports having published this release as — self-reported, not verified. */
  publishedPlaceVersion?: number | null;
}

export interface StartScanRequest {
  release: string;
  excludedDirectoryNames: string[];
  supportedFileTypes: string[];
  includeHidden: boolean;
  followSymbolicLinks: boolean;
}

export interface LocalScanRun {
  id: string;
  projectId: number;
  release: string;
  state: ScanRunState;
  discoveredCount: number;
  processedCount: number;
  bytesProcessed: number;
  supportedCount: number;
  ignoredCount: number;
  excludedCount: number;
  unreadableCount: number;
  missingDependencyCount: number;
  failedCount: number;
  warnings: string[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface LocalScanEvent {
  sequence: number;
  runId: string;
  timestamp: string;
  type: ScanEventType;
  processedFiles: number;
  discoveredFiles: number;
  bytesProcessed: number;
  currentRelativePath: string | null;
  warning: string | null;
  error: string | null;
}

export interface LocalScanAsset {
  id: number;
  scanRunId: string;
  ordinal: number;
  relativePath: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  dHash: string | null;
  pHash: string | null;
  audioFingerprint: string | null;
  verification: 'CLEAR' | 'SIMILAR' | 'DUPLICATE';
  findings: string[];
}

export interface LocalScanFinding {
  id: number;
  scanAssetId: number;
  code: string;
  severity: string;
  message: string;
  matchedAssetOrdinal: number | null;
  matchLayer: string | null;
  matchDistance: number | null;
}

export interface LocalSourceEvidence {
  id: number;
  scanAssetId: number;
  source: string | null;
  license: string | null;
  evidenceUrl: string | null;
  resolved: boolean;
  recordedAt: string;
}

export interface LocalDecision {
  id: string;
  scanAssetId: number;
  type: LocalDecisionType;
  reason: string;
  supersedesDecisionId: string | null;
  createdAt: string;
}

export type OwnershipIdentityType = 'USER' | 'GROUP';
/** `MATCH`/`MISMATCH` both mean facts were obtained; `UNVERIFIABLE` means they could not be. Mirrors the core `OwnershipOutcome`. */
export type OwnershipOutcome = 'MATCH' | 'MISMATCH' | 'UNVERIFIABLE';
/**
 * Where a checked animation id came from. Only `DECLARED_BY_USER` exists: a person types the id into
 * the ownership panel, because nothing in a scanned file identifies a Roblox asset. Mirrors
 * `OwnershipEvidence.ASSET_ID_DECLARED_BY_USER` / `ManifestOwnershipAssetIdSource`.
 */
export type OwnershipAssetIdSource = 'DECLARED_BY_USER';

/**
 * One persisted point-in-time Open Cloud ownership observation for a scan asset, as the bridge
 * serves it (the API key and the raw upstream JSON are never included). `verified` is `true` for
 * `MATCH`/`MISMATCH` (authoritative facts were obtained) and `false` for `UNVERIFIABLE`.
 *
 * Honesty (load-bearing): a populated record never means "you have the right to use this asset" — it
 * means CreatorFlow observed these facts at `checkedAt`. A `MISMATCH` is a review lead for a human,
 * never proof of wrongdoing. Mirrors `OwnershipVerificationRecord` on the desktop side.
 *
 * Honesty #2: every fact here is about `robloxAssetId`, and `assetIdSource` records that a person
 * supplied that id. The record says nothing verified about the scanned file itself — the claim that
 * the file is that animation is the user's, classified by `ownershipLinkBasis`.
 */
export interface LocalOwnershipVerification {
  id: string;
  scanAssetId: number;
  robloxAssetId: number;
  /** Always `DECLARED_BY_USER`: the id came from the verify form, not from the file. */
  assetIdSource: OwnershipAssetIdSource;
  universeId: number;
  creatorType: OwnershipIdentityType | null;
  creatorId: number | null;
  assetType: string | null;
  moderationState: string | null;
  ownerType: OwnershipIdentityType | null;
  ownerId: number | null;
  memberRank: number | null;
  outcome: OwnershipOutcome;
  verified: boolean;
  checkedAt: string;
}

export interface LocalAssetDetail {
  asset: LocalScanAsset;
  findings: LocalScanFinding[];
  sourceEvidence: LocalSourceEvidence | null;
  latestDecision: LocalDecision | null;
}

export interface LocalAssetsPage {
  scanRunId?: string;
  items: LocalScanAsset[];
  limit: number;
  offset: number;
}

export class LocalBridgeError extends Error {
  /**
   * @param retryAfterSeconds the server-reported wait from a 429 envelope, or `null` when the bridge
   *   reported none. `null` is an honest *unknown*, never "retry immediately" — callers must phrase
   *   it as such rather than inventing a number.
   */
  constructor(message: string, readonly status: number, readonly retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'LocalBridgeError';
  }
}

/**
 * The bridge's `retryAfterSeconds` when it reported a usable one, else `null` (unknown stays
 * unknown). Anything that is not a finite, non-negative number is discarded rather than rendered.
 */
function parseRetryAfterSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Builds the session from the `/api/v1/session` payload, or `null` when it is not a same-origin
 * session. Only the three known fields are copied off the payload — a session is never spread
 * wholesale, so nothing the bridge might add later leaks into client state by accident.
 */
function toSession(value: unknown): LocalBridgeSession | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.csrfToken !== 'string' || payload.csrfToken.length === 0) return null;
  if (typeof payload.origin !== 'string' || payload.origin !== window.location.origin) return null;
  return {
    csrfToken: payload.csrfToken,
    origin: payload.origin,
    // A missing or non-boolean flag is unknown, not "no key": an older/other bridge that does not
    // report it must not make the UI assert a key state it was never told.
    openCloudKeyConfigured: typeof payload.openCloudKeyConfigured === 'boolean'
      ? payload.openCloudKeyConfigured
      : null,
  };
}

function terminal(state: ScanRunState) {
  return state === 'CANCELLED' || state === 'COMPLETED' || state === 'FAILED';
}

/**
 * GETs and validates the session endpoint, or `null` when the bridge is absent, answers with
 * something other than an ok JSON body, or is not this page's origin. Never throws.
 */
async function fetchSession(signal?: AbortSignal): Promise<LocalBridgeSession | null> {
  try {
    const response = await fetch('/api/v1/session', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
    return toSession(await response.json());
  } catch {
    return null;
  }
}

export class LocalBridgeClient {
  private constructor(readonly session: LocalBridgeSession) {}

  static async detect(signal?: AbortSignal): Promise<LocalBridgeClient | null> {
    const session = await fetchSession(signal);
    return session ? new LocalBridgeClient(session) : null;
  }

  /**
   * Re-reads the desktop's Open Cloud key status — a **boolean only**, never the key. The status on
   * {@link session} is point-in-time: a key can be added (or cleared) in the desktop Settings card
   * while this page is open, so the UI re-checks rather than telling a person to add a key they
   * already added.
   *
   * `null` is an honest *unknown* — the bridge did not report the flag, or the read failed — and
   * callers must then leave the verify action available and let the 409 answer, rather than
   * asserting "no key". Never writes back to {@link session}: that stays the record of what this
   * page was told when it connected.
   */
  async refreshOpenCloudKeyStatus(signal?: AbortSignal): Promise<boolean | null> {
    return (await fetchSession(signal))?.openCloudKeyConfigured ?? null;
  }

  async pickProject(): Promise<LocalProjectSummary | null> {
    const response = await this.request<LocalProjectSummary | null>('/api/v1/project-picker', { method: 'POST' });
    return response;
  }

  listProjects() {
    return this.request<{ items: LocalProjectRecord[] }>('/api/v1/projects');
  }

  getWorkspaceState() {
    return this.request<LocalWorkspaceState>('/api/v1/workspace-state');
  }

  createPluginPairing(projectId: number) {
    return this.request<LocalPluginPairing>(`/api/v1/projects/${projectId}/plugin-pairings`, { method: 'POST' });
  }

  /** Every pairing issued for the project, newest first — never the token or its hash. */
  listPluginPairings(projectId: number) {
    return this.request<{ items: LocalPluginPairingSummary[] }>(`/api/v1/projects/${projectId}/plugin-pairings`);
  }

  /** Soft-deletes a pairing by id; an already-paired plugin's next request is rejected (401). */
  revokePluginPairing(projectId: number, pairingId: string) {
    return this.request<{ items: LocalPluginPairingSummary[] }>(
      `/api/v1/projects/${projectId}/plugin-pairings/${encodeURIComponent(pairingId)}/revoke`,
      { method: 'POST' },
    );
  }

  /** Declares (or edits) the intended Roblox experience for a project. A human declaration only — not verified. */
  bindExperience(projectId: number, request: { universeId: number; placeId: number; experienceName: string }) {
    return this.request<LocalProjectRecord>(`/api/v1/projects/${projectId}/experience`, { method: 'POST', body: request });
  }

  listMotionComparisons(projectId: number, limit = 25, offset = 0) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request<{ items: LocalMotionComparison[]; limit: number; offset: number }>(`/api/v1/projects/${projectId}/motion-comparisons?${query}`);
  }

  getMotionComparison(comparisonId: string) {
    return this.request<LocalMotionComparison>(`/api/v1/motion-comparisons/${encodeURIComponent(comparisonId)}`);
  }

  /** Promotes one side of a comparison into an immutable last-known-good / last-published snapshot. */
  captureAnimationSnapshot(projectId: number, request: {
    comparisonId: string;
    side: 'source' | 'candidate';
    kind: AnimationSnapshotKind;
  }) {
    return this.request<LocalAnimationSnapshot>(`/api/v1/projects/${projectId}/animation-snapshots`, {
      method: 'POST',
      body: request,
    });
  }

  /** The live references: the newest snapshot per asset and kind. */
  listAnimationSnapshots(projectId: number) {
    return this.request<{ items: LocalAnimationSnapshot[] }>(`/api/v1/projects/${projectId}/animation-snapshots`);
  }

  listAnimationSnapshotHistory(projectId: number, assetId: string, kind: AnimationSnapshotKind,
                               limit = 25, offset = 0) {
    const query = new URLSearchParams({
      assetId, kind, history: 'true', limit: String(limit), offset: String(offset),
    });
    return this.request<{ items: LocalAnimationSnapshot[] }>(`/api/v1/projects/${projectId}/animation-snapshots?${query}`);
  }

  saveWorkspaceState(state: SaveWorkspaceStateRequest) {
    return this.request<LocalWorkspaceState>('/api/v1/workspace-state', { method: 'POST', body: state });
  }

  listProjectReleases(projectId: number) {
    return this.request<{ items: LocalRelease[] }>(`/api/v1/projects/${projectId}/releases`);
  }

  createRelease(projectId: number, request: { scanRunId?: string; release?: string }) {
    return this.request<LocalRelease>(`/api/v1/projects/${projectId}/releases`, { method: 'POST', body: request });
  }

  getRelease(releaseId: string) {
    return this.request<LocalRelease>(`/api/v1/releases/${encodeURIComponent(releaseId)}`);
  }

  releaseManifestUrl(releaseId: string) {
    return `/api/v1/releases/${encodeURIComponent(releaseId)}/manifest`;
  }

  /** Records (self-reported, not verified against Roblox) the place version a team published a release as. */
  recordPublishedVersion(releaseId: string, publishedPlaceVersion: number) {
    return this.request<LocalRelease>(`/api/v1/releases/${encodeURIComponent(releaseId)}/published-version`, {
      method: 'POST',
      body: { publishedPlaceVersion },
    });
  }

  releaseReportUrl(releaseId: string) {
    return `/api/v1/releases/${encodeURIComponent(releaseId)}/report`;
  }

  startScan(projectId: number, options: StartScanRequest) {
    return this.request<LocalScanRun>(`/api/v1/projects/${projectId}/scan-runs`, { method: 'POST', body: options });
  }

  getScanRun(runId: string) {
    return this.request<LocalScanRun>(`/api/v1/scan-runs/${encodeURIComponent(runId)}`);
  }

  cancelScan(runId: string) {
    return this.request<{ state: 'CANCELLATION_REQUESTED' }>(`/api/v1/scan-runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  }

  listProjectAssets(projectId: number, limit = 100, offset = 0) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request<LocalAssetsPage>(`/api/v1/projects/${projectId}/assets?${query}`);
  }

  getAsset(assetId: number) {
    return this.request<LocalAssetDetail>(`/api/v1/assets/${assetId}`);
  }

  getDecisionHistory(assetId: number) {
    return this.request<{ items: LocalDecision[] }>(`/api/v1/assets/${assetId}/decisions`);
  }

  getSourceEvidence(assetId: number) {
    return this.request<{ items: LocalSourceEvidence[] }>(`/api/v1/assets/${assetId}/source-evidence`);
  }

  recordSourceEvidence(assetId: number, source: string | null, license: string | null, evidenceUrl: string | null) {
    return this.request<LocalSourceEvidence>(`/api/v1/assets/${assetId}/source-evidence`, {
      method: 'POST',
      body: { source, license, evidenceUrl },
    });
  }

  recordDecision(assetId: number, type: LocalDecisionType, reason: string, supersedesDecisionId?: string) {
    return this.request<LocalDecision>(`/api/v1/assets/${assetId}/decisions`, {
      method: 'POST',
      body: { type, reason, ...(supersedesDecisionId ? { supersedesDecisionId } : {}) },
    });
  }

  /**
   * The single live Open Cloud call: verifies the animation `robloxAssetId`'s creator against the
   * project's bound experience owner and persists the observation. Resolves the new record on
   * success (`MATCH`/`MISMATCH`/`UNVERIFIABLE`). Rejects with a {@link LocalBridgeError} whose
   * `status` distinguishes the failure modes the UI must handle honestly: 409 (no key configured),
   * 429 (rate-limited — the error also carries `retryAfterSeconds` when the bridge reported one),
   * 404 (no animation id / no bound experience).
   */
  verifyOwnership(assetId: number, robloxAssetId: number) {
    return this.request<LocalOwnershipVerification>(`/api/v1/assets/${assetId}/verify-ownership`, {
      method: 'POST',
      body: { robloxAssetId },
    });
  }

  /** The append-only ownership-verification history for an asset, newest first (never the API key). */
  listOwnershipVerifications(assetId: number) {
    return this.request<{ items: LocalOwnershipVerification[] }>(`/api/v1/assets/${assetId}/ownership-verifications`);
  }

  subscribeToScanEvents(runId: string, onEvent: (event: LocalScanEvent) => void, onDisconnect?: () => void) {
    const source = new EventSource(`/api/v1/scan-runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
    const eventNames = ['started', 'discovered', 'file_started', 'file_completed', 'file_skipped', 'warning', 'error', 'cancelled', 'completed'];
    const handle = (message: Event) => {
      if (!(message instanceof MessageEvent) || typeof message.data !== 'string') return;
      try {
        onEvent(JSON.parse(message.data) as LocalScanEvent);
      } catch {
        // A malformed progress frame does not invalidate the persisted run, which polling still observes.
      }
    };
    eventNames.forEach((name) => source.addEventListener(name, handle));
    source.onerror = () => onDisconnect?.();
    return () => source.close();
  }

  async followScan(runId: string, callbacks: {
    onRun: (run: LocalScanRun) => void;
    onEvent: (event: LocalScanEvent) => void;
    onError: (error: Error) => void;
  }) {
    let stopped = false;
    // Poll faster once the SSE stream drops (proxy buffering, connection loss).
    // The delay is re-read on every reschedule, so raising the flag actually
    // takes effect on the next tick.
    let fastPoll = false;
    let timer = 0;
    const closeEvents = this.subscribeToScanEvents(runId, callbacks.onEvent, () => { fastPoll = true; });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      closeEvents();
      window.clearTimeout(timer);
    };
    const poll = async () => {
      try {
        const run = await this.getScanRun(runId);
        if (stopped) return;
        callbacks.onRun(run);
        if (terminal(run.state)) { stop(); return; }
      } catch (error) {
        if (!stopped) callbacks.onError(error instanceof Error ? error : new Error('Could not refresh scan state'));
      }
      if (!stopped) timer = window.setTimeout(() => { void poll(); }, fastPoll ? 600 : 900);
    };
    await poll();
    return stop;
  }

  private async request<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method === 'POST') headers['X-CreatorFlow-CSRF'] = this.session.csrfToken;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 204) return null as T;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const payload: unknown = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const envelope = payload && typeof payload === 'object'
        ? payload as { error?: unknown; retryAfterSeconds?: unknown }
        : null;
      const message = typeof envelope?.error === 'string'
        ? envelope.error
        : `Local bridge request failed (${response.status})`;
      // A 429 envelope carries the upstream Retry-After the desktop observed. Carry it through:
      // dropping it is why a rate-limited person could not be told how long to wait.
      throw new LocalBridgeError(message, response.status, parseRetryAfterSeconds(envelope?.retryAfterSeconds));
    }
    if (!contentType.includes('application/json')) throw new LocalBridgeError('Local bridge returned an unexpected response', response.status);
    return payload as T;
  }
}
