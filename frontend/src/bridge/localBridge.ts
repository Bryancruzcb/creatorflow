export type ScanRunState = 'QUEUED' | 'RUNNING' | 'CANCELLATION_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
export type ScanEventType = 'STARTED' | 'DISCOVERED' | 'FILE_STARTED' | 'FILE_COMPLETED' | 'FILE_SKIPPED' | 'WARNING' | 'ERROR' | 'CANCELLED' | 'COMPLETED';
export type LocalDecisionType = 'APPROVED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'EXCLUDED';

export interface LocalBridgeSession {
  csrfToken: string;
  origin: string;
}

export interface LocalPluginPairing {
  projectId: number;
  endpoint: string;
  token: string;
  expiresAt: string;
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
  algorithmVersion: string;
  createdAt: string;
  result: Record<string, unknown>;
}

export interface LocalProjectSummary {
  projectId: number;
  name: string;
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
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LocalBridgeError';
  }
}

function isSession(value: unknown): value is LocalBridgeSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<LocalBridgeSession>;
  return typeof session.csrfToken === 'string' && session.csrfToken.length > 0
    && typeof session.origin === 'string' && session.origin === window.location.origin;
}

function terminal(state: ScanRunState) {
  return state === 'CANCELLED' || state === 'COMPLETED' || state === 'FAILED';
}

export class LocalBridgeClient {
  private constructor(readonly session: LocalBridgeSession) {}

  static async detect(signal?: AbortSignal): Promise<LocalBridgeClient | null> {
    try {
      const response = await fetch('/api/v1/session', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
      const value: unknown = await response.json();
      return isSession(value) ? new LocalBridgeClient(value) : null;
    } catch {
      return null;
    }
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

  listMotionComparisons(projectId: number, limit = 25, offset = 0) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request<{ items: LocalMotionComparison[]; limit: number; offset: number }>(`/api/v1/projects/${projectId}/motion-comparisons?${query}`);
  }

  getMotionComparison(comparisonId: string) {
    return this.request<LocalMotionComparison>(`/api/v1/motion-comparisons/${encodeURIComponent(comparisonId)}`);
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
    let polling = false;
    const closeEvents = this.subscribeToScanEvents(runId, callbacks.onEvent, () => { polling = true; });
    const poll = async () => {
      try {
        const run = await this.getScanRun(runId);
        if (stopped) return;
        callbacks.onRun(run);
        if (terminal(run.state)) stop();
      } catch (error) {
        if (!stopped) callbacks.onError(error instanceof Error ? error : new Error('Could not refresh scan state'));
      }
    };
    const interval = window.setInterval(() => { void poll(); }, polling ? 600 : 900);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      closeEvents();
      window.clearInterval(interval);
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
      const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Local bridge request failed (${response.status})`;
      throw new LocalBridgeError(message, response.status);
    }
    if (!contentType.includes('application/json')) throw new LocalBridgeError('Local bridge returned an unexpected response', response.status);
    return payload as T;
  }
}
