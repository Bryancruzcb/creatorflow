import { describe, expect, it } from 'vitest';
import {
  CREATORFLOW_MANIFEST_SCHEMA,
  CREATORFLOW_MANIFEST_SCHEMA_V2,
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

function validManifestV2(): CreatorFlowManifest {
  return {
    ...validManifest(),
    $schema: CREATORFLOW_MANIFEST_SCHEMA_V2,
    gate: { result: 'PASS', reasons: [] },
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

  it('accepts a manifest with a declared intended experience', () => {
    const manifest = validManifest();
    manifest.experience = { universeId: 1234567890, placeId: 9876543210, experienceName: 'Obby Tower' };
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('still accepts a manifest that omits the intended experience entirely', () => {
    const manifest = validManifest();
    expect('experience' in manifest).toBe(false);
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('rejects a declared experience missing a required inner field', () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.experience = { universeId: 1234567890, placeId: 9876543210 };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });

  it('accepts both v0.1 and v0.2 as valid $schema values', () => {
    expect(validate(validManifest())).toMatchObject({ ok: true });
    expect(validate(validManifestV2())).toMatchObject({ ok: true });
  });

  it('accepts a v0.2 manifest with an embedded PASS gate and empty reasons', () => {
    const manifest = validManifestV2();
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('accepts a v0.2 manifest with an embedded BLOCKED gate and blocking reasons', () => {
    const manifest = validManifestV2();
    manifest.gate = {
      result: 'BLOCKED',
      reasons: [{
        code: 'UNRESOLVED_SOURCE',
        assetPath: 'Art/hero.png',
        verification: 'CLEAR',
        decision: 'PENDING',
        message: 'Source and license evidence must be resolved or the asset excluded',
      }],
    };
    const result = validate(manifest);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.manifest.gate?.reasons).toHaveLength(1);
  });

  it('rejects a v0.2 manifest missing its gate block', () => {
    const manifest = validManifestV2() as unknown as Record<string, unknown>;
    delete manifest.gate;
    const result = validate(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path.includes('gate'))).toBe(true);
  });

  it('rejects a gate block with an invalid result value', () => {
    const manifest = validManifestV2() as unknown as Record<string, unknown>;
    manifest.gate = { result: 'MAYBE', reasons: [] };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });

  it('rejects a gate reason missing a required field', () => {
    const manifest = validManifestV2() as unknown as Record<string, unknown>;
    manifest.gate = { result: 'BLOCKED', reasons: [{ code: 'UNRESOLVED_SOURCE', assetPath: 'a.png' }] };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });

  it('still accepts a v0.1 manifest that omits the gate block entirely', () => {
    const manifest = validManifest();
    expect('gate' in manifest).toBe(false);
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('rejects a v0.1 manifest that carries a gate block', () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.gate = { result: 'PASS', reasons: [] };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });

  it('accepts a v0.2 asset with a fully populated optional evidenceBases block', () => {
    const manifest = validManifestV2();
    manifest.assets[0].evidenceBases = {
      verification: 'VERIFIED',
      source: 'DECLARED',
      ownership: 'NOT_VERIFIED',
      decision: 'DECLARED',
    };
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('accepts a v0.2 asset with evidenceBases omitting the optional decision field', () => {
    const manifest = validManifestV2();
    manifest.assets[0].evidenceBases = {
      verification: 'VERIFIED',
      source: 'NOT_VERIFIED',
      ownership: 'NOT_VERIFIED',
    };
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('still accepts a v0.2 manifest whose assets omit evidenceBases entirely (backward compat)', () => {
    const manifest = validManifestV2();
    expect('evidenceBases' in manifest.assets[0]).toBe(false);
    expect(validate(manifest)).toMatchObject({ ok: true });
  });

  it('rejects an evidenceBases block with an invalid basis enum value', () => {
    const manifest = validManifestV2() as unknown as Record<string, unknown>;
    const assets = manifest.assets as Array<Record<string, unknown>>;
    assets[0].evidenceBases = { verification: 'MAYBE', source: 'NOT_VERIFIED', ownership: 'NOT_VERIFIED' };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });

  it('rejects an evidenceBases block missing a required facet', () => {
    const manifest = validManifestV2() as unknown as Record<string, unknown>;
    const assets = manifest.assets as Array<Record<string, unknown>>;
    assets[0].evidenceBases = { verification: 'VERIFIED', source: 'DECLARED' };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });

  it('rejects an evidenceBases block with an unknown extra property', () => {
    const manifest = validManifestV2() as unknown as Record<string, unknown>;
    const assets = manifest.assets as Array<Record<string, unknown>>;
    assets[0].evidenceBases = {
      verification: 'VERIFIED', source: 'DECLARED', ownership: 'NOT_VERIFIED', extra: 'nope',
    };
    const result = validate(manifest);
    expect(result.ok).toBe(false);
  });
});
