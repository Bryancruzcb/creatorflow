import type { AssetRecord } from '../data';
import { CREATORFLOW_MANIFEST_SCHEMA, type CreatorFlowManifest, type ManifestAsset } from './manifest';

export interface ReleaseManifestOptions {
  projectName: string;
  release: string;
  generatedAt: string;
}

const SIZE_UNIT_BYTES: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

/** Parses a human size like "684 KB" or "7.7 MB" into bytes, honouring the unit. */
function sizeToBytes(size: string): number {
  const value = Number.parseFloat(size);
  if (!Number.isFinite(value)) return 0;
  const unit = /([kmgt]?b)\b/i.exec(size)?.[1]?.toUpperCase();
  return Math.round(value * (SIZE_UNIT_BYTES[unit ?? 'MB'] ?? SIZE_UNIT_BYTES.MB));
}

function toManifestAsset(asset: AssetRecord): ManifestAsset {
  return {
    path: `${asset.path}/${asset.name}`,
    fileName: asset.name,
    fileType: asset.format.toLowerCase(),
    sizeBytes: sizeToBytes(asset.size),
    sha256: asset.hash.toLowerCase(),
    width: 0,
    height: 0,
    fingerprints: { dHash: null, pHash: null, audio: null },
    verification: asset.status === 'review' ? 'SIMILAR' : 'CLEAR',
    source: {
      source: asset.origin,
      license: asset.license,
      evidenceUrl: asset.matches?.[0]?.sourceUrl ?? null,
    },
    decision: asset.decision.replace('-', '_').toUpperCase() as ManifestAsset['decision'],
    matches: asset.matches?.map((match, index) => ({
      matchedAssetId: index + 1,
      matchedFileName: match.title,
      layer: match.method,
      distance: 100 - match.similarity,
      note: match.relationship,
    })) ?? [],
    findings: [asset.evidence],
  };
}

/**
 * Builds the portable creative-asset manifest for a prepared release.
 *
 * <p>The summary counters are derived from the emitted asset records with the
 * same rules CreatorFlow's own importer applies ({@link validateManifestText}):
 * verification counts come from each record's {@code verification} field, and an
 * unresolved source is one whose {@code source}/{@code license} is blank. Earlier
 * this function counted clears from the in-app {@code status} and unresolved
 * sources from string heuristics, so an excluded blocked asset (labelled
 * {@code CLEAR} with non-empty "No license" text) produced a manifest that the
 * importer rejected. Deriving the summary from the records keeps the export and
 * its validator in lock-step.
 */
export function buildReleaseManifest(
  assets: AssetRecord[],
  options: ReleaseManifestOptions,
): CreatorFlowManifest {
  const records = assets.map(toManifestAsset);
  const isResolvedSource = (asset: ManifestAsset) =>
    Boolean(asset.source.source?.trim() && asset.source.license?.trim());

  return {
    $schema: CREATORFLOW_MANIFEST_SCHEMA,
    project: { name: options.projectName, release: options.release },
    generatedAt: options.generatedAt,
    summary: {
      total: records.length,
      clear: records.filter((asset) => asset.verification === 'CLEAR').length,
      similar: records.filter((asset) => asset.verification === 'SIMILAR').length,
      duplicate: records.filter((asset) => asset.verification === 'DUPLICATE').length,
      unresolvedSources: records.filter((asset) => !isResolvedSource(asset)).length,
      pendingDecisions: records.filter((asset) => asset.decision === 'PENDING').length,
    },
    assets: records,
  };
}
