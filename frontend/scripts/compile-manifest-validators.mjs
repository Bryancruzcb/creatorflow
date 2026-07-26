// Compiles the CreatorFlow manifest JSON Schemas into standalone, dependency-free
// validator functions ahead of time.
//
// Why: Ajv's normal `ajv.compile()` builds a validator by generating JS source and
// running it through `new Function(...)` at runtime. The desktop app serves the built
// frontend under a strict Content-Security-Policy (`script-src 'self'`, no
// `unsafe-eval`), so that runtime code generation throws an EvalError and the whole
// bundle fails to evaluate — see docs/HANDOFF.md and desktop LocalBridgeServer's
// addSecurityHeaders(). Ajv's "standalone code" mode (ajv/dist/standalone) generates
// the equivalent validator as plain, static ESM source at build time, so nothing gets
// eval'd in the browser.
//
// Usage: node scripts/compile-manifest-validators.mjs [output-file]
//   Defaults to writing src/manifest/validators.generated.js. Pass an explicit path
//   (e.g. a temp file) to compare against the committed output without touching it —
//   see schema:check in check-manifest-schema.mjs, which does exactly that.
//
// Determinism: schema files and ajv-formats are read directly with no
// timestamps/randomness folded in, so identical schema input always produces a
// byte-identical generated module. Do not add anything (dates, absolute paths, etc.)
// that would break that.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestDir = resolve(root, 'src/manifest');

const SCHEMA_KEYS = {
  validateManifestV1: 'creatorflow-manifest-v0.1.schema.json',
  validateManifestV2: 'creatorflow-manifest-v0.2.schema.json',
};

function readSchema(filename) {
  return JSON.parse(readFileSync(resolve(manifestDir, filename), 'utf8'));
}

// Ajv's `code.esm: true` option only changes how the *exports* at the very top/bottom
// of the standalone module are written (`export const` vs `module.exports`). It does
// NOT touch the internal helper references Ajv pulls in for things like format
// validators (ajv-formats) or unicode-aware string length (ajv/dist/runtime/*) — those
// still come out as CommonJS `require("...")` calls (this is a known Ajv limitation,
// not a bug in this script). A file that mixes top-level `export` with bare `require()`
// is not valid ESM and — more importantly for us — `require` does not exist in a
// browser bundle, so leaving it in would silently break under CSP too (a
// ReferenceError instead of an EvalError, but still a blank page). rewriteRequiresAsImports
// statically rewrites each `const x = require("mod").accessor;` into a hoisted
// `import * as ns from "mod";` plus `const x = ns.accessor;`, so the committed file is
// 100% static ESM with no `require`/`new Function`/`eval` anywhere.
function rewriteRequiresAsImports(source) {
  const requirePattern = /const\s+([\w$]+)\s*=\s*require\("([^"]+)"\)((?:\.[\w$]+|\["[^"]+"\])*);/g;
  // Keyed by `${modulePath}\u0000${exportedName}` -> generated local identifier.
  const bindingsByKey = new Map();

  const rewritten = source.replace(requirePattern, (_match, ident, modulePath, accessor) => {
    // `require("mod").a.b["c"]` needs to become a *named* import of `a` (the first
    // accessor segment) plus whatever accessor chain remains after it — NOT a
    // namespace import (`import * as ns from "mod"`) with the whole chain reapplied to
    // `ns`. Namespace-object default-interop is exactly the kind of thing that
    // legitimately differs between plain Node's ESM/CJS interop (where `ns.default` is
    // always `module.exports` as a whole) and bundler "smart" interop (Vite/esbuild
    // unwrap `ns.default` to the CJS module's own `exports.default` when it sees an
    // `__esModule` marker) — an earlier version of this script picked one behavior and
    // broke under the other. A *named* import of the specific export Ajv actually
    // requested sidesteps that divergence entirely: named-CJS-export detection (via
    // static `exports.x = ...` analysis, i.e. cjs-module-lexer) is the one part of
    // CJS/ESM interop every tool here (Node, Vite/esbuild, Rolldown, Vitest) agrees on.
    const tokens = accessor.match(/\.[\w$]+|\["[^"]+"\]/g) ?? [];
    if (tokens.length === 0) {
      throw new Error(`compile-manifest-validators: require("${modulePath}") has no accessor to import — cannot rewrite.`);
    }
    const [firstToken, ...restTokens] = tokens;
    const exportedName = firstToken.startsWith('.') ? firstToken.slice(1) : firstToken.slice(2, -2);
    const remainingAccessor = restTokens.join('');

    const key = `${modulePath}\u0000${exportedName}`;
    if (!bindingsByKey.has(key)) {
      const safeModule = modulePath.replace(/[^a-zA-Z0-9]+/g, '_');
      const safeExport = exportedName.replace(/[^a-zA-Z0-9]+/g, '_');
      bindingsByKey.set(key, {
        modulePath,
        exportedName,
        localIdent: `__cjs_${safeModule}_${safeExport}_${bindingsByKey.size}`,
      });
    }

    return `const ${ident} = ${bindingsByKey.get(key).localIdent}${remainingAccessor};`;
  });

  // Guard against Ajv emitting `require(...)` in a shape this script doesn't know how
  // to rewrite (e.g. a future Ajv version needing a different runtime helper). Silently
  // leaving a `require(` in the output would defeat the whole point of this script.
  if (/\brequire\(/.test(rewritten)) {
    throw new Error(
      'compile-manifest-validators: generated code still contains require() after rewriting — ' +
        'update rewriteRequiresAsImports to handle the new shape.',
    );
  }

  // Node's own ESM resolver (unlike Vite/Rollup's bundler-style resolution, which mimics
  // CJS `require` and happily resolves these extensionless) requires an explicit file
  // extension for deep imports into a package that has no "exports" map entry for them.
  // Adding ".js" here costs nothing under a bundler and makes the committed file resolve
  // correctly under plain `node`, too (see scripts/check-manifest-schema.mjs, which loads
  // this file directly with Node during schema:check to compare it byte-for-byte).
  const importStatements = [...bindingsByKey.values()]
    .map(({ modulePath, exportedName, localIdent }, index) => {
      const specifier = /\.[a-zA-Z0-9]+$/.test(modulePath) ? modulePath : `${modulePath}.js`;
      if (exportedName !== 'default') {
        return `import { ${exportedName} as ${localIdent} } from "${specifier}";`;
      }
      // `default` is the ONE binding where the named-import trick above does not hold:
      // for a CJS module written as `exports.default = fn`, plain Node ESM binds
      // `default` to the whole `module.exports` OBJECT (the function then sits at
      // `.default.default`), while bundler "smart" interop binds it straight to `fn`.
      // Importing the namespace and unwrapping at runtime is correct under BOTH — and
      // getting this wrong is not a build error, it is a runtime "X is not a function"
      // thrown from inside the validator, which only the built bundle reveals (the
      // dev/vitest interop hides it). See e2e/manifest-import.spec.ts.
      const nsIdent = `__ns_${index}`;
      return (
        `import * as ${nsIdent} from "${specifier}";\n` +
        `const ${localIdent} = ${nsIdent}.default?.default ?? ${nsIdent}.default ?? ${nsIdent};`
      );
    })
    .join('\n');

  const marker = '"use strict";';
  const markerIndex = rewritten.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('compile-manifest-validators: expected generated code to start with a "use strict"; directive.');
  }
  const insertAt = markerIndex + marker.length;
  return importStatements
    ? `${rewritten.slice(0, insertAt)}\n${importStatements}\n${rewritten.slice(insertAt)}`
    : rewritten;
}

function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true, esm: true } });
  addFormats(ajv);

  for (const [exportName, filename] of Object.entries(SCHEMA_KEYS)) {
    ajv.addSchema(readSchema(filename), exportName);
  }

  const refs = Object.fromEntries(Object.keys(SCHEMA_KEYS).map((exportName) => [exportName, exportName]));
  return rewriteRequiresAsImports(standaloneCode(ajv, refs));
}

const HEADER = `// GENERATED FILE — do not hand-edit.
//
// Produced by scripts/compile-manifest-validators.mjs from
// creatorflow-manifest-v0.1.schema.json and creatorflow-manifest-v0.2.schema.json
// using Ajv's standalone code generation (ajv/dist/standalone). This module contains
// no runtime code generation (no \`new Function\`/\`eval\`), so it works under the
// desktop app's \`script-src 'self'\` Content-Security-Policy. See that script for why
// this exists and how to regenerate it, and \`npm run schema:validators\`.
//
// Regenerate with: npm run schema:validators
// Verified byte-identical by: npm run schema:check
`;

// `allowJs` is off for the app's TS project (tsconfig.app.json), so this plain .js file
// needs a hand-shaped .d.ts sibling for manifest.ts to import it with types. Its shape
// never changes independently of this script (same two export names, same Ajv
// ValidateFunction type), so it is generated as a fixed template rather than derived
// from the compiled Ajv output.
const DECLARATIONS = `// GENERATED FILE — do not hand-edit. Companion types for validators.generated.js,
// produced by scripts/compile-manifest-validators.mjs.
import type { ValidateFunction } from 'ajv/dist/2020';
import type { CreatorFlowManifest } from './manifest';

export declare const validateManifestV1: ValidateFunction<CreatorFlowManifest>;
export declare const validateManifestV2: ValidateFunction<CreatorFlowManifest>;
`;

const outputArg = process.argv[2];
const outputPath = outputArg ? resolve(outputArg) : resolve(manifestDir, 'validators.generated.js');
const declarationsPath = outputPath.replace(/\.js$/, '.d.ts');

const body = compile();
writeFileSync(outputPath, `${HEADER}${body}`);
writeFileSync(declarationsPath, DECLARATIONS);

if (!outputArg) {
  console.log(`Wrote standalone manifest validators to ${outputPath}`);
  console.log(`Wrote type declarations to ${declarationsPath}`);
}
