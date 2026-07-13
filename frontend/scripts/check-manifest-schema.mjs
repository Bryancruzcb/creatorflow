import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendSchema = resolve(root, 'src/manifest/creatorflow-manifest-v0.1.schema.json');
const publicSchema = resolve(root, 'public/creatorflow-manifest-v0.1.schema.json');
const javaSchemaCandidates = [
  resolve(root, '../core/src/main/resources/creatorflow-manifest-v0.1.schema.json'),
  resolve(root, '../../work/creatorflow-current/core/src/main/resources/creatorflow-manifest-v0.1.schema.json'),
];
const javaSchema = javaSchemaCandidates.find(existsSync);

function canonicalJson(path) {
  return JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
}

const frontend = canonicalJson(frontendSchema);
const comparisons = [publicSchema, ...(javaSchema ? [javaSchema] : [])];

for (const comparison of comparisons) {
  if (frontend !== canonicalJson(comparison)) {
    throw new Error(`Manifest schema parity check failed: ${frontendSchema} differs from ${comparison}`);
  }
}

console.log(`Manifest schema parity verified against ${comparisons.length} canonical cop${comparisons.length === 1 ? 'y' : 'ies'}.`);
