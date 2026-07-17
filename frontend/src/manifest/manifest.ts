import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import manifestSchemaV1 from './creatorflow-manifest-v0.1.schema.json';
import manifestSchemaV2 from './creatorflow-manifest-v0.2.schema.json';

export const CREATORFLOW_MANIFEST_SCHEMA = 'creatorflow.manifest/v0.1' as const;
export const CREATORFLOW_MANIFEST_SCHEMA_V2 = 'creatorflow.manifest/v0.2' as const;
export const MAX_MANIFEST_BYTES = 25 * 1024 * 1024;
export const MANIFEST_PAGE_SIZE = 100;

export type ManifestVerification = 'CLEAR' | 'SIMILAR' | 'DUPLICATE';
export type ManifestDecision = 'PENDING' | 'APPROVED' | 'NEEDS_REVIEW' | 'BLOCKED' | 'EXCLUDED';

/**
 * The provenance basis for one piece of manifest evidence. Honesty constraint: `VERIFIED` means
 * CreatorFlow computed the value itself (e.g. a fingerprint match) — never "original", "owned", or
 * "non-infringing". `DECLARED` means a human typed it. `NOT_VERIFIED` means the tool did not/cannot
 * check it — an honest "unknown", never a negative verdict.
 */
export type ManifestEvidenceBasis = 'VERIFIED' | 'DECLARED' | 'NOT_VERIFIED';

/**
 * Per-facet evidence provenance for one asset. `decision` is omitted until a human records a
 * decision. `ownership` is always `NOT_VERIFIED` — nothing in CreatorFlow calls a Roblox ownership
 * or permission API.
 */
export interface ManifestEvidenceBases {
  verification: ManifestEvidenceBasis;
  source: ManifestEvidenceBasis;
  ownership: ManifestEvidenceBasis;
  decision?: ManifestEvidenceBasis;
}

export interface ManifestFingerprints {
  dHash: string | null;
  pHash: string | null;
  audio: string | null;
}

export interface ManifestSourceEvidence {
  source: string | null;
  license: string | null;
  evidenceUrl: string | null;
}

export interface ManifestMatch {
  matchedAssetId: number;
  matchedFileName: string;
  layer: string;
  distance: number;
  note: string;
}

export interface ManifestAsset {
  path: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
  fingerprints: ManifestFingerprints;
  verification: ManifestVerification;
  source: ManifestSourceEvidence;
  decision: ManifestDecision;
  /** OPTIONAL (v0.2, no schema bump): present when the export path has computed it. */
  evidenceBases?: ManifestEvidenceBases;
  matches: ManifestMatch[];
  findings: string[];
}

export interface ManifestIntendedExperience {
  universeId: number;
  placeId: number;
  experienceName: string;
}

export interface ManifestGateReason {
  code: string;
  assetPath: string;
  verification: string;
  decision: string;
  message: string;
}

/**
 * The embedded release-gate outcome on a v0.2 manifest. `result` reflects process/evidence
 * completeness (decisions resolved, sources present, flags approved) — it is not a copyright
 * or originality verdict. A PASS must never be presented as "original" or "cleared for copyright".
 */
export interface ManifestGate {
  result: 'PASS' | 'BLOCKED';
  reasons: ManifestGateReason[];
}

export interface CreatorFlowManifest {
  $schema: typeof CREATORFLOW_MANIFEST_SCHEMA | typeof CREATORFLOW_MANIFEST_SCHEMA_V2;
  project: {
    name: string;
    release: string;
  };
  /** A human declaration only — CreatorFlow does not verify ownership of or access to it. */
  experience?: ManifestIntendedExperience | null;
  generatedAt: string;
  summary: {
    total: number;
    clear: number;
    similar: number;
    duplicate: number;
    unresolvedSources: number;
    pendingDecisions: number;
  };
  /** Present on v0.2 manifests only; absent on v0.1 (pre-gate) manifests. */
  gate?: ManifestGate;
  assets: ManifestAsset[];
}

export interface ManifestValidationIssue {
  path: string;
  message: string;
}

export type ManifestValidationResult =
  | { ok: true; manifest: CreatorFlowManifest }
  | { ok: false; issues: ManifestValidationIssue[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchemaV1 = ajv.compile<CreatorFlowManifest>(manifestSchemaV1);
const validateSchemaV2 = ajv.compile<CreatorFlowManifest>(manifestSchemaV2);

function schemaIssue(error: ErrorObject): ManifestValidationIssue {
  const missingProperty = typeof error.params.missingProperty === 'string' ? `/${error.params.missingProperty}` : '';
  return {
    path: `${error.instancePath || '/'}${missingProperty}`,
    message: error.message ?? 'does not match the manifest schema',
  };
}

function isResolvedSource(asset: ManifestAsset) {
  return Boolean(asset.source.source?.trim() && asset.source.license?.trim());
}

function safeEvidenceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function safePortablePath(value: string) {
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:\//.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function semanticIssues(manifest: CreatorFlowManifest): ManifestValidationIssue[] {
  const issues: ManifestValidationIssue[] = [];
  const verification = { CLEAR: 0, SIMILAR: 0, DUPLICATE: 0 };
  let unresolvedSources = 0;
  let pendingDecisions = 0;
  const paths = new Map<string, number>();

  manifest.assets.forEach((asset, index) => {
    const path = `/assets/${index}`;
    verification[asset.verification] += 1;
    if (!isResolvedSource(asset)) unresolvedSources += 1;
    if (asset.decision === 'PENDING') pendingDecisions += 1;

    if (!safePortablePath(asset.path)) {
      issues.push({ path: `${path}/path`, message: 'must be a normalized project-relative path without backslashes, empty segments, or traversal' });
    }

    const pathKey = asset.path.normalize('NFC').toLocaleLowerCase('en-US');
    const firstIndex = paths.get(pathKey);
    if (firstIndex !== undefined) {
      issues.push({ path: `${path}/path`, message: `duplicates or case-collides with /assets/${firstIndex}/path` });
    } else {
      paths.set(pathKey, index);
    }

    if (asset.source.evidenceUrl !== null && !safeEvidenceUrl(asset.source.evidenceUrl)) {
      issues.push({ path: `${path}/source/evidenceUrl`, message: 'must use an absolute http: or https: URL' });
    }

    asset.matches.forEach((match, matchIndex) => {
      if (match.matchedAssetId < 1 || match.matchedAssetId > manifest.assets.length) {
        issues.push({
          path: `${path}/matches/${matchIndex}/matchedAssetId`,
          message: `must reference an asset ID between 1 and ${manifest.assets.length}`,
        });
      }
    });
  });

  const expected: Record<string, number> = {
    total: manifest.assets.length,
    clear: verification.CLEAR,
    similar: verification.SIMILAR,
    duplicate: verification.DUPLICATE,
    unresolvedSources,
    pendingDecisions,
  };

  Object.entries(expected).forEach(([key, value]) => {
    const actual = manifest.summary[key as keyof CreatorFlowManifest['summary']];
    if (actual !== value) {
      issues.push({ path: `/summary/${key}`, message: `is ${actual}; expected ${value} from the asset records` });
    }
  });

  return issues;
}

export function validateManifestText(text: string, byteLength = new TextEncoder().encode(text).byteLength): ManifestValidationResult {
  if (byteLength > MAX_MANIFEST_BYTES) {
    return { ok: false, issues: [{ path: '/', message: `file exceeds the ${formatBytes(MAX_MANIFEST_BYTES)} import limit` }] };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: '/', message: error instanceof Error ? `is not valid JSON: ${error.message}` : 'is not valid JSON' }],
    };
  }

  const schemaValue = value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>).$schema
    : undefined;
  const validateSchema = schemaValue === CREATORFLOW_MANIFEST_SCHEMA_V2 ? validateSchemaV2
    : schemaValue === CREATORFLOW_MANIFEST_SCHEMA ? validateSchemaV1
    : undefined;
  if (!validateSchema) {
    return {
      ok: false,
      issues: [{
        path: '/$schema',
        message: `is ${JSON.stringify(schemaValue)}; expected '${CREATORFLOW_MANIFEST_SCHEMA}' or '${CREATORFLOW_MANIFEST_SCHEMA_V2}'`,
      }],
    };
  }

  if (!validateSchema(value)) {
    return { ok: false, issues: (validateSchema.errors ?? []).map(schemaIssue) };
  }

  const issues = semanticIssues(value);
  return issues.length ? { ok: false, issues } : { ok: true, manifest: value };
}

export async function validateManifestFile(file: File): Promise<ManifestValidationResult> {
  if (file.size > MAX_MANIFEST_BYTES) {
    return { ok: false, issues: [{ path: '/', message: `${file.name} exceeds the ${formatBytes(MAX_MANIFEST_BYTES)} import limit` }] };
  }
  try {
    return validateManifestText(await file.text(), file.size);
  } catch (error) {
    return {
      ok: false,
      issues: [{ path: '/', message: error instanceof Error ? `could not be read: ${error.message}` : 'could not be read' }],
    };
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

export function titleCaseManifestValue(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}
