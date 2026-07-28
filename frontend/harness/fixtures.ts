/**
 * Stub data and a stub bridge for the harness.
 *
 * These are deliberately *unflattering* fixtures: long file names, a group-owned asset, warnings
 * present, a blocked release. A harness seeded with short tidy strings proves the layout survives
 * short tidy strings, which is not the case anyone ships into.
 */
import type {
  LocalAssetDetail, LocalBridgeClient, LocalBridgeSession, LocalDecision,
  LocalOwnershipVerification, LocalProjectSummary, LocalRelease, LocalScanAsset, LocalScanRun,
} from '../src/bridge/localBridge';

export const project: LocalProjectSummary = {
  projectId: 9,
  name: 'Skybound Obby — Winter Event',
  experience: { universeId: 90110, placeId: 12345, experienceName: 'Skybound Obby Tower' },
};

export const asset: LocalScanAsset = {
  id: 501, scanRunId: 'run-abc', ordinal: 1,
  relativePath: 'assets/animations/characters/hero/hero-idle-loop-v3-final-FINAL.rbxm',
  fileName: 'hero-idle-loop-v3-final-FINAL.rbxm',
  fileType: 'rbxm', sizeBytes: 2_097_152, sha256: 'a3f9'.repeat(16),
  width: 0, height: 0, dHash: null, pHash: null, audioFingerprint: null,
  verification: 'CLEAR', findings: [],
};

export const secondAsset: LocalScanAsset = {
  ...asset, id: 502, ordinal: 2,
  relativePath: 'assets/audio/ambience/wind-loop-mono-48k.ogg',
  fileName: 'wind-loop-mono-48k.ogg', fileType: 'ogg',
  sizeBytes: 813_000, sha256: 'b7c2'.repeat(16), verification: 'REVIEW',
};

export const detail: LocalAssetDetail = {
  asset, findings: [], sourceEvidence: null, latestDecision: null,
};

export const decision: LocalDecision = {
  id: 'dec-1', scanAssetId: asset.id, type: 'APPROVE',
  reason: 'Authored in-house by the animation team; source .blend is in the shared drive.',
  supersedesDecisionId: null, createdAt: '2026-07-24T00:00:00Z',
};

export const verification: LocalOwnershipVerification = {
  id: 'own-1', scanAssetId: asset.id, robloxAssetId: 507766388,
  assetIdSource: 'DECLARED_BY_USER', universeId: 90110,
  creatorType: 'GROUP', creatorId: 33445566, assetType: 'Animation',
  moderationState: 'Approved', ownerType: 'GROUP', ownerId: 33445566,
  memberRank: 254, outcome: 'MATCH', verified: true,
  checkedAt: '2026-07-27T12:00:00Z',
};

export const run: LocalScanRun = {
  id: 'run-abc', projectId: 9, release: 'winter-event-rc4', state: 'COMPLETED',
  discoveredCount: 248, processedCount: 248, bytesProcessed: 918_000_000,
  supportedCount: 231, ignoredCount: 11, excludedCount: 4,
  unreadableCount: 1, missingDependencyCount: 1, failedCount: 0,
  warnings: ['1 file could not be read: assets/legacy/old-tower.rbxm'],
  error: null,
  createdAt: '2026-07-27T11:00:00Z', startedAt: '2026-07-27T11:00:02Z',
  completedAt: '2026-07-27T11:04:41Z',
};

export const release: LocalRelease = {
  id: 'rel-1', scanRunId: 'run-abc', release: 'winter-event-rc4',
  releaseName: 'Winter Event RC4', policyResult: 'BLOCKED',
  createdAt: '2026-07-27T11:05:00Z',
  manifestUrl: 'blob:manifest', reportUrl: 'blob:report',
  comparison: {
    previousReleaseId: 'rel-0', added: 12, changed: 5, removed: 2,
    addedPaths: ['assets/animations/characters/hero/hero-idle-loop-v3-final-FINAL.rbxm'],
    changedPaths: ['assets/audio/ambience/wind-loop-mono-48k.ogg'],
    removedPaths: ['assets/legacy/old-tower.rbxm'],
    unresolved: 3, approved: 228, blocked: 1, excluded: 4,
  },
  publishedPlaceVersion: null,
};

export const session: LocalBridgeSession = {
  csrfToken: 'harness-csrf', origin: 'http://127.0.0.1:4176', openCloudKeyConfigured: true,
};

/**
 * Every method the local views call, as one list.
 *
 * Kept explicit and checked at runtime because the first version of this stub was assembled by
 * guessing names from the component, and two scenes crashed on methods it had not implemented
 * (`listProjectReleases`, then `releaseManifestUrl`) — each discovered only when the scene failed
 * to render. Anything missing here now fails loudly at construction with the name in the message,
 * rather than as `x is not a function` three renders deep.
 *
 * Regenerate with:
 *   grep -oE 'client\.[a-zA-Z]+' src/components/LocalProjectWorkspace.tsx | sort -u
 */
const REQUIRED = [
  'bindExperience', 'cancelScan', 'createRelease', 'followScan', 'getAsset',
  'getDecisionHistory', 'getScanRun', 'listOwnershipVerifications', 'listProjectAssets',
  'listProjectReleases', 'recordDecision', 'recordPublishedVersion', 'recordSourceEvidence',
  'refreshOpenCloudKeyStatus', 'releaseManifestUrl', 'saveWorkspaceState', 'startScan',
  'verifyOwnership',
] as const;

export function stubClient(overrides: Record<string, unknown> = {}): LocalBridgeClient {
  const client: Record<string, unknown> = {
    session,
    refreshOpenCloudKeyStatus: async () => true,
    listProjectAssets: async () => ({ scanRunId: run.id, items: [asset, secondAsset], limit: 100, offset: 0 }),
    saveWorkspaceState: async () => undefined,
    getAsset: async () => detail,
    getDecisionHistory: async () => ({ items: [decision] }),
    recordDecision: async () => decision,
    recordSourceEvidence: async () => undefined,
    listOwnershipVerifications: async () => ({ items: [verification] }),
    verifyOwnership: async () => verification,
    getScanRun: async () => run,
    // Resolves immediately with the completed run: the harness renders finished states, and a
    // stub that streamed progress would make every screenshot depend on timing.
    followScan: async (_runId: string, cb: { onRun: (r: LocalScanRun) => void }) => {
      cb.onRun(run);
      return () => undefined;
    },
    cancelScan: async () => ({ state: 'CANCELLATION_REQUESTED' as const }),
    startScan: async () => run,
    listProjectReleases: async () => ({ items: [release] }),
    createRelease: async () => release,
    recordPublishedVersion: async () => release,
    releaseManifestUrl: (id: string) => `/harness/manifest/${id}.json`,
    releaseReportUrl: (id: string) => `/harness/report/${id}.json`,
    bindExperience: async () => ({ ...project, adoptedAt: '2026-07-27T10:00:00Z', activeScanRunId: run.id }),
    ...overrides,
  };

  const missing = REQUIRED.filter((name) => typeof client[name] !== 'function');
  if (missing.length) throw new Error(`harness stubClient is missing: ${missing.join(', ')}`);
  return client as unknown as LocalBridgeClient;
}
