import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every manifest schema version that ships in all three locations (core resources,
// frontend/src/manifest, frontend/public) and must stay byte-identical across them.
const SCHEMA_VERSIONS = ['v0.1', 'v0.2'];

function canonicalJson(path) {
  return JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
}

let totalComparisons = 0;

for (const version of SCHEMA_VERSIONS) {
  const filename = `creatorflow-manifest-${version}.schema.json`;
  const frontendSchema = resolve(root, 'src/manifest', filename);
  const publicSchema = resolve(root, 'public', filename);
  const javaSchemaCandidates = [
    resolve(root, '../core/src/main/resources', filename),
    resolve(root, '../../work/creatorflow-current/core/src/main/resources', filename),
  ];
  const javaSchema = javaSchemaCandidates.find(existsSync);

  const frontend = canonicalJson(frontendSchema);
  const comparisons = [publicSchema, ...(javaSchema ? [javaSchema] : [])];

  for (const comparison of comparisons) {
    if (frontend !== canonicalJson(comparison)) {
      throw new Error(`Manifest schema parity check failed: ${frontendSchema} differs from ${comparison}`);
    }
    totalComparisons += 1;
  }
}

console.log(`Manifest schema parity verified across ${SCHEMA_VERSIONS.length} schema version(s), ${totalComparisons} canonical cop${totalComparisons === 1 ? 'y' : 'ies'} checked.`);
