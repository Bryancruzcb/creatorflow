import { describe, expect, it } from 'vitest';
import type { AssetRecord } from '../data';
import { validateManifestText } from './manifest';
import { buildReleaseManifest } from './releaseManifest';

const HEX64 = '5d36edd89e44331da003f181b6fb3a2a98303922600e3093b213e78913415af7';

function assetRecord(overrides: Partial<AssetRecord>): AssetRecord {
  return {
    id: 'asset',
    name: 'file.glb',
    path: 'Art/Props',
    format: 'GLB',
    size: '4.0 MB',
    kind: 'model',
    origin: 'Created in-house',
    license: 'Proprietary · declaration recorded',
    fingerprint: 'no match',
    evidence: 'Evidence text.',
    status: 'clear',
    decision: 'approved',
    owner: 'Tester',
    firstSeen: 'May 01, 2026',
    hash: HEX64,
    ...overrides,
  };
}

const OPTIONS = { projectName: 'Northwind', release: '1.2.0', generatedAt: '2026-07-14T00:00:00.000Z' };

describe('release manifest export', () => {
  it('produces a manifest that passes CreatorFlow\'s own validator, even with excluded blocked assets', () => {
    // Mirrors the app's "Apply prepared sample resolutions" outcome: a blocked,
    // unlicensed asset is excluded from the release but still exported.
    const assets: AssetRecord[] = [
      assetRecord({ id: 'clear-one', name: 'clear_one.glb', status: 'clear', decision: 'approved' }),
      assetRecord({
        id: 'ambient-loop',
        name: 'ambient_loop.mp3',
        path: 'Audio/Ambience',
        format: 'MP3',
        origin: 'Unknown source',
        license: 'No license found',
        status: 'blocked',
        decision: 'excluded',
      }),
    ];

    const manifest = buildReleaseManifest(assets, OPTIONS);
    const result = validateManifestText(JSON.stringify(manifest));

    expect(result.ok, result.ok ? '' : JSON.stringify(result.issues)).toBe(true);
  });

  it('never fabricates a matchedAssetId for a match that is not in this manifest', () => {
    const externalMatch = {
      id: 'upstream', title: 'Some Upstream Model — upstream GLB', provider: 'Khronos glTF Sample Assets',
      recordType: 'Upstream source model', similarity: 99, method: 'Mesh topology',
      firstRegistered: '2017', license: 'CC0 1.0 Universal', relationship: 'Derived from the upstream source.',
      differences: [],
    } as unknown as NonNullable<AssetRecord['matches']>[number];

    const manifest = buildReleaseManifest(
      [assetRecord({ id: 'a', name: 'hero.glb', status: 'review', matches: [externalMatch] })],
      OPTIONS,
    );

    // The old builder emitted `index + 1` here, asserting the match was asset #1 of this
    // manifest. It is an external registry record, so it must not appear as an in-manifest
    // pointer at all — and the information must not vanish silently either.
    expect(manifest.assets[0].matches).toHaveLength(0);
    expect(manifest.assets[0].findings.join(' ')).toContain('EXTERNAL_MATCH');
    expect(manifest.assets[0].findings.join(' ')).toContain('Some Upstream Model');
  });

  it('resolves a matchedAssetId to the real ordinal when the matched file is in this manifest', () => {
    const intraMatch = {
      id: 'sibling', title: 'sibling.glb', provider: 'This project', recordType: 'Project asset',
      similarity: 96, method: 'dHash', firstRegistered: '2026', license: 'Proprietary',
      relationship: 'Near-duplicate of a sibling asset.', differences: [],
    } as unknown as NonNullable<AssetRecord['matches']>[number];

    const manifest = buildReleaseManifest(
      [
        assetRecord({ id: 'a', name: 'hero.glb', status: 'review', matches: [intraMatch] }),
        assetRecord({ id: 'b', name: 'sibling.glb' }),
      ],
      OPTIONS,
    );

    expect(manifest.assets[0].matches).toHaveLength(1);
    // sibling.glb is the SECOND asset, so the ordinal is 2 — not the match's own index of 1.
    expect(manifest.assets[0].matches[0].matchedAssetId).toBe(2);
    expect(validateManifestText(JSON.stringify(manifest)).ok).toBe(true);
  });

  it('scales file sizes by their unit instead of assuming megabytes', () => {
    const assets = [assetRecord({ id: 'font', name: 'display.otf', format: 'OTF', size: '684 KB' })];

    const manifest = buildReleaseManifest(assets, OPTIONS);

    expect(manifest.assets[0].sizeBytes).toBe(Math.round(684 * 1024));
  });
});
