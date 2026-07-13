import { describe, expect, it } from 'vitest';
import {
  CREATORFLOW_MANIFEST_SCHEMA,
  MAX_MANIFEST_BYTES,
  validateManifestText,
  type CreatorFlowManifest,
} from './manifest';

function validManifest(): CreatorFlowManifest {
  return {
    $schema: CREATORFLOW_MANIFEST_SCHEMA,
    project: { name: 'Unseen project', release: 'test-1' },
    generatedAt: '2026-07-12T21:00:00Z',
    summary: { total: 1, clear: 1, similar: 0, duplicate: 0, unresolvedSources: 0, pendingDecisions: 1 },
    assets: [{
      path: 'Art/hero.png',
      fileName: 'hero.png',
      fileType: 'png',
      sizeBytes: 42,
      sha256: 'a'.repeat(64),
      width: 16,
      height: 16,
      fingerprints: { dHash: '0123456789abcdef', pHash: null, audio: null },
      verification: 'CLEAR',
      source: { source: 'Studio archive', license: 'Owned', evidenceUrl: 'https://example.test/evidence/hero' },
      decision: 'PENDING',
      matches: [],
      findings: [],
    }],
  };
}

function validate(value: unknown) {
  return validateManifestText(JSON.stringify(value));
}

describe('CreatorFlow manifest validation', () => {
  it('accepts a schema-valid and semantically consistent manifest', () => {
    expect(validate(validManifest())).toMatchObject({ ok: true });
  });

  it('rejects malformed JSON', () => {
    const result = validateManifestText('{not-json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toContain('not valid JSON');
  });

  it('rejects unsupported schema versions', () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.$schema = 'creatorflow.manifest/v9';
    const result = validate(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.includes('$schema'))).toBe(true);
  });

  it('rejects a payload over the 25 MB boundary before parsing', () => {
    const result = validateManifestText('{}', MAX_MANIFEST_BYTES + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toContain('import limit');
  });

  it('rejects duplicate portable paths and traversal paths', () => {
    const duplicate = validManifest();
    duplicate.assets.push({ ...structuredClone(duplicate.assets[0]), sha256: 'b'.repeat(64) });
    duplicate.summary = { ...duplicate.summary, total: 2, clear: 2, pendingDecisions: 2 };
    const duplicateResult = validate(duplicate);
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) expect(duplicateResult.issues.some((issue) => issue.message.includes('case-collides'))).toBe(true);

    const traversal = validManifest();
    traversal.assets[0].path = '../outside.png';
    const traversalResult = validate(traversal);
    expect(traversalResult.ok).toBe(false);
    if (!traversalResult.ok) expect(traversalResult.issues.some((issue) => issue.path.includes('/path'))).toBe(true);
  });

  it('rejects summary totals that disagree with asset records', () => {
    const manifest = validManifest();
    manifest.summary.clear = 0;
    manifest.summary.similar = 1;
    const result = validate(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === '/summary/clear')).toBe(true);
  });

  it('rejects match IDs outside the one-based asset range', () => {
    const manifest = validManifest();
    manifest.assets[0].matches.push({ matchedAssetId: 2, matchedFileName: 'missing.png', layer: 'dhash', distance: 4, note: 'Missing record' });
    const result = validate(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.endsWith('/matchedAssetId'))).toBe(true);
  });

  it('rejects non-http evidence URLs', () => {
    const manifest = validManifest();
    manifest.assets[0].source.evidenceUrl = 'javascript:alert(1)';
    const result = validate(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.includes('evidenceUrl'))).toBe(true);
  });

  it('accepts unresolved source records when the summary reports them', () => {
    const manifest = validManifest();
    manifest.assets[0].source = { source: null, license: null, evidenceUrl: null };
    manifest.summary.unresolvedSources = 1;
    expect(validate(manifest)).toMatchObject({ ok: true });
  });
});
