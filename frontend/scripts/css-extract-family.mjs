/**
 * Move a feature family's rules out of a slab into its own file (issue #120).
 *
 * A "family" is every rule whose every selector mentions one of the given class prefixes.
 * Rules keep their document order; rules inside @media/@container/@supports move under a
 * recreated copy of the same at-rule in the extracted file. A comment sitting directly
 * above a moved rule moves with it. Rules where only SOME selectors match are left in
 * place and reported — those need a human decision, not a script's.
 *
 * This tool only rearranges text; whether the rearrangement is safe is decided by
 * css-cascade-check.mjs on the built output, never here.
 *
 * Usage:
 *   node scripts/css-extract-family.mjs <slab.css> <out.css> <prefix> [prefix...]
 *   # e.g. node scripts/css-extract-family.mjs src/styles/07-stress.css \
 *   #        src/styles/features/dependency-file.css dependency-file
 *
 * Appends to <out.css> if it exists (multi-slab families run once per donor slab).
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const postcss = require('postcss');

const [, , slabPath, outPath, ...prefixes] = process.argv;
if (!slabPath || !outPath || !prefixes.length) {
  console.error('Usage: css-extract-family.mjs <slab.css> <out.css> <prefix> [prefix...]');
  process.exit(2);
}

const matchesFamily = (sel) => prefixes.some((p) => new RegExp(`\\.${p}(?![\\w-])|\\.${p}-`).test(sel));

const root = postcss.parse(readFileSync(slabPath, 'utf8'), { from: slabPath });
const moved = [];
const partial = [];

/** Collect movable rules from a container (root or at-rule), returning extracted clones. */
function extractFrom(container, contextLabel) {
  const takes = [];
  container.each((node) => {
    if (node.type === 'rule') {
      const hits = node.selectors.filter(matchesFamily).length;
      if (hits === node.selectors.length) takes.push(node);
      else if (hits > 0) partial.push(`${contextLabel}${node.selector.replace(/\s+/g, ' ')} (line ${node.source.start.line})`);
    } else if (node.type === 'atrule' && ['media', 'container', 'supports'].includes(node.name)) {
      const innerTakes = extractFrom(node, `@${node.name} ${node.params} :: `);
      if (innerTakes.length) {
        const wrapper = postcss.atRule({ name: node.name, params: node.params });
        wrapper.raws.before = '\n\n';
        for (const t of innerTakes) wrapper.append(t);
        takes.push({ __wrapper: wrapper, __origin: node });
      }
    }
  });
  const clones = [];
  for (const t of takes) {
    if (t.__wrapper) {
      clones.push(t.__wrapper);
      if (t.__origin.nodes.length === 0) t.__origin.remove();
      continue;
    }
    const prev = t.prev();
    if (prev && prev.type === 'comment') {
      prev.remove();
      prev.raws.before = '\n\n';
      clones.push(prev);
    }
    t.remove();
    t.raws.before = clones.length && clones[clones.length - 1].type === 'comment' ? '\n' : '\n\n';
    clones.push(t);
    moved.push(`${contextLabel}${t.selector.replace(/\s+/g, ' ')}`);
  }
  return clones;
}

const clones = extractFrom(root, '');
if (!clones.length) {
  console.error(`No rules in ${slabPath} match [${prefixes.join(', ')}] — nothing written.`);
  for (const p of partial) console.error(`  mixed-selector rule left in place: ${p}`);
  process.exit(1);
}

const out = postcss.root();
for (const c of clones) out.append(c);

const header = existsSync(outPath) ? readFileSync(outPath, 'utf8').trimEnd() + '\n' : '';
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header + out.toString().trimStart().replace(/\r\n/g, '\n') + '\n');
writeFileSync(slabPath, root.toString());

console.log(`${moved.length} rules -> ${outPath}${header ? ' (appended)' : ''}`);
if (partial.length) {
  console.log(`\nLEFT IN PLACE — selector lists that mix family and non-family selectors:`);
  for (const p of partial) console.log(`  ${p}`);
}
