import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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

// The standalone-compiled validators (src/manifest/validators.generated.{js,d.ts}) are
// committed so the app never runs Ajv's `new Function`-based compile() at runtime under
// the desktop app's CSP (see compile-manifest-validators.mjs for why). That only holds
// if the committed file always matches what the schemas actually compile to, so
// regenerate into a scratch location here and fail the build if it has drifted —
// otherwise an edit to the schema without re-running codegen would silently ship a
// stale, CSP-broken validator.
const generatedDir = resolve(root, 'src/manifest');
const committedValidators = resolve(generatedDir, 'validators.generated.js');
const committedDeclarations = resolve(generatedDir, 'validators.generated.d.ts');

const scratchDir = resolve(root, 'node_modules/.cache/manifest-validators-check');
mkdirSync(scratchDir, { recursive: true });
const scratchValidators = resolve(scratchDir, 'validators.generated.js');
const scratchDeclarations = resolve(scratchDir, 'validators.generated.d.ts');

execFileSync(
  process.execPath,
  [resolve(root, 'scripts/compile-manifest-validators.mjs'), scratchValidators],
  { stdio: 'inherit' },
);

// Normalize line endings before comparing: this repo has no .gitattributes, and on a
// checkout with core.autocrlf=true (the default many Windows Git installs suggest), the
// committed (LF) file lands on disk as CRLF, while the freshly regenerated scratch copy
// below is written straight from Node with LF. Comparing raw bytes would then report
// "drift" on every run for a purely cosmetic reason. Compare content, not line endings.
const normalizeEol = (text) => text.replace(/\r\n/g, '\n');

const committedValidatorsSource = normalizeEol(readFileSync(committedValidators, 'utf8'));
const committedDeclarationsSource = normalizeEol(readFileSync(committedDeclarations, 'utf8'));
const freshValidatorsSource = normalizeEol(readFileSync(scratchValidators, 'utf8'));
const freshDeclarationsSource = normalizeEol(readFileSync(scratchDeclarations, 'utf8'));
rmSync(scratchDir, { recursive: true, force: true });

if (committedValidatorsSource !== freshValidatorsSource || committedDeclarationsSource !== freshDeclarationsSource) {
  throw new Error(
    'Manifest validator codegen check failed: src/manifest/validators.generated.js (or its .d.ts) ' +
      'does not match what scripts/compile-manifest-validators.mjs produces from the current schemas. ' +
      'Run `npm run schema:validators` and commit the result.',
  );
}

console.log('Manifest validator codegen verified: validators.generated.js/.d.ts match the committed schemas.');
