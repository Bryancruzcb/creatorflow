/**
 * The gate for consolidating the slab CSS (issue #120).
 *
 * The invariant every rule move must preserve is not "the file looks the same" but "the
 * cascade resolves the same". This script proves that on the BUILT stylesheet — the same
 * artifact the app ships — by snapshotting two things per emitted CSS file:
 *
 *  1. Per-selector outcome: for every (at-rule context, selector), the final value each
 *     property resolves to after all of that selector's rules layer in source order.
 *     Catches any change to what a selector ultimately says, including a bad merge of
 *     duplicate definitions.
 *
 *  2. Order-sensitive pairs: for every pair of DIFFERENT selectors that share a class
 *     token (so they can plausibly match the same element), have equal specificity, and
 *     declare a common property with the same importance, the source-order relation that
 *     decides the winner. Catches the cross-selector regressions a per-selector map
 *     cannot see — the ".local-ownership-facts dt beats .local-asset-inspector dt by
 *     being later" class of dependency documented in styles/index.css.
 *
 * Together these are stronger than a screenshot sweep for rule moves: they are exhaustive
 * over every dynamic state (`atlas-stage-${status}` variants included), not just the
 * states a harness happens to reach.
 *
 * Usage (run `npm run build` first — this reads dist/):
 *   node scripts/css-cascade-check.mjs baseline   write audit/.css-cascade-baseline.json
 *   node scripts/css-cascade-check.mjs compare    diff current dist against the baseline
 *   node scripts/css-cascade-check.mjs dups       list multiply-defined selectors in src/styles
 *
 * The baseline is a migration gate, not a standing CI check — any intentional style
 * change rewrites it — so it stays untracked (see .gitignore).
 *
 * Scope: pairs are only compared within one emitted file. Lazy-loaded chunk CSS injects
 * after the main sheet at runtime, so cross-file order is a load-order question this
 * migration never touches (no rule moves between the slab barrel and component files).
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const postcss = require('postcss');

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = join(frontendDir, 'dist', 'assets');
const stylesDir = join(frontendDir, 'src', 'styles');
const baselinePath = join(frontendDir, 'audit', '.css-cascade-baseline.json');

/** dist filenames carry a content hash: index-CttE2QQE.css -> index.css */
const stableName = (f) => f.replace(/-[A-Za-z0-9_-]{8,12}(\.css)$/, '$1');

/**
 * Specificity as (ids, classes+attrs+pseudo-classes, elements+pseudo-elements).
 * :where() contributes nothing; :not(single-arg) contributes its argument, which
 * unwrapping reproduces exactly. Nothing in this codebase uses :is() or multi-arg
 * :not() (checked before writing this) — if that changes, revisit.
 */
function specificity(selector) {
  let s = selector.replace(/:where\([^)]*\)/g, '');
  s = s.replace(/:not\(/g, '(');
  const count = (re) => {
    const m = s.match(re) || [];
    s = s.replace(re, ' ');
    return m.length;
  };
  const ids = count(/#[\w-]+/g);
  const attrs = count(/\[[^\]]*\]/g);
  const classes = count(/\.[\w-]+/g);
  const pseudoEls = count(/::[\w-]+/g);
  const legacyPseudoEls = count(/:(before|after|first-line|first-letter)(?![\w-])/g);
  const pseudoCls = count(/:[\w-]+\([^)]*\)/g) + count(/:[\w-]+/g);
  const elements = (s.match(/(^|[\s>+~(,])[a-z][\w-]*/gi) || []).length;
  return ids * 1e6 + (attrs + classes + pseudoCls) * 1e3 + (elements + pseudoEls + legacyPseudoEls);
}

const classTokens = (selector) => selector.match(/\.[\w-]+/g) || [];

/**
 * The subject (rightmost compound) decides which box a selector styles. Two selectors can
 * only conflict on the same box, so: subjects naming different element types (dd vs dt)
 * never conflict, and a ::before subject never conflicts with a plain-element subject.
 */
function subjectInfo(selector) {
  const subject = selector.split(/[\s>+~]+/).filter(Boolean).pop() || '';
  const el = (subject.match(/^[a-z][\w-]*/i) || [null])[0];
  const pseudoEl =
    (subject.match(/::([\w-]+)/) || [])[1] ||
    (subject.match(/:(before|after|first-line|first-letter)(?![\w-])/) || [])[1] ||
    null;
  return { el: el ? el.toLowerCase() : null, pseudoEl };
}

/** Parse one stylesheet into flat entries: one per (rule x selector-in-list). */
function parseSheet(css, from) {
  const root = postcss.parse(css, { from });
  const entries = [];
  let idx = 0;
  root.walkRules((rule) => {
    const context = [];
    for (let p = rule.parent; p && p.type === 'atrule'; p = p.parent) {
      context.unshift(`@${p.name} ${p.params}`.trim());
    }
    const decls = [];
    rule.each((node) => {
      if (node.type === 'decl') decls.push([node.prop.toLowerCase(), node.value, !!node.important]);
    });
    if (!decls.length) return;
    for (const sel of rule.selectors) {
      const selector = sel.replace(/\s+/g, ' ').trim();
      entries.push({
        idx: idx++,
        key: `${context.join(' / ')}␟${selector}`,
        selector,
        spec: specificity(selector),
        decls,
        line: rule.source && rule.source.start ? rule.source.start.line : 0,
      });
    }
  });
  return entries;
}

/** Final property map per key, importance-aware, plus the idx that decides each prop. */
function resolveKeys(entries) {
  const keys = new Map();
  for (const e of entries) {
    let k = keys.get(e.key);
    if (!k) keys.set(e.key, (k = { spec: e.spec, props: new Map(), defs: 0 }));
    k.defs += 1;
    for (const [prop, value, imp] of e.decls) {
      const cur = k.props.get(prop);
      // Later declarations win, except a normal one never beats an earlier !important.
      if (!cur || imp || !cur.imp) k.props.set(prop, { value, imp, idx: e.idx });
    }
  }
  return keys;
}

/** Order-sensitive pairs among co-match candidates (shared class token). */
function orderPairs(entries, keys) {
  const buckets = new Map();
  const subjects = new Map();
  for (const e of entries) {
    subjects.set(e.key, subjectInfo(e.selector));
    const tokens = new Set(classTokens(e.selector));
    const subjEl = subjects.get(e.key).el;
    if (subjEl) tokens.add(`<${subjEl}>`); // same-element subjects can tie without sharing a class
    for (const t of tokens) {
      if (!buckets.has(t)) buckets.set(t, new Map());
      buckets.get(t).set(e.key, keys.get(e.key));
    }
  }
  const pairs = new Map();
  for (const bucket of buckets.values()) {
    const list = [...bucket.entries()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [keyA, a] = list[i];
        const [keyB, b] = list[j];
        if (keyA === keyB || a.spec !== b.spec) continue;
        const sa = subjects.get(keyA);
        const sb = subjects.get(keyB);
        if (sa.el && sb.el && sa.el !== sb.el) continue; // dd vs dt: never the same box
        if (sa.pseudoEl !== sb.pseudoEl) continue; // ::before styles a different box than the element
        for (const [prop, pa] of a.props) {
          const pb = b.props.get(prop);
          if (!pb || pa.imp !== pb.imp) continue;
          if (pa.value === pb.value) continue; // same value: order cannot matter
          const [first, second] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
          const [pf, ps] = keyA < keyB ? [pa, pb] : [pb, pa];
          pairs.set(`${first}␞${second}␞${prop}`, pf.idx > ps.idx ? 'first-wins' : 'second-wins');
        }
      }
    }
  }
  return pairs;
}

function snapshotDist() {
  const files = readdirSync(distAssets).filter((f) => f.endsWith('.css'));
  const snap = {};
  for (const f of files.sort()) {
    const entries = parseSheet(readFileSync(join(distAssets, f), 'utf8'), f);
    const keys = resolveKeys(entries);
    const outKeys = {};
    for (const [key, k] of [...keys.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      outKeys[key] = Object.fromEntries(
        [...k.props.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, v]) => [p, `${v.value}${v.imp ? ' !important' : ''}`]),
      );
    }
    const pairs = orderPairs(entries, keys);
    snap[stableName(f)] = {
      rules: entries.length,
      keys: outKeys,
      pairs: Object.fromEntries([...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    };
  }
  return snap;
}

function compare(baseline, current) {
  const problems = [];
  const show = (k) => k.replace(/␟/g, ' :: ').replace(/␞/g, '  <->  ');
  for (const file of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const b = baseline[file];
    const c = current[file];
    if (!b || !c) {
      problems.push(`${file}: ${b ? 'missing from current build' : 'not in baseline'}`);
      continue;
    }
    for (const key of Object.keys(b.keys)) {
      if (!c.keys[key]) problems.push(`${file}: selector disappeared: ${show(key)}`);
    }
    for (const key of Object.keys(c.keys)) {
      const bk = b.keys[key];
      if (!bk) {
        problems.push(`${file}: selector appeared: ${show(key)}`);
        continue;
      }
      const ck = c.keys[key];
      for (const prop of new Set([...Object.keys(bk), ...Object.keys(ck)])) {
        if (bk[prop] !== ck[prop]) {
          problems.push(`${file}: ${show(key)} -> ${prop}: ${JSON.stringify(bk[prop])} became ${JSON.stringify(ck[prop])}`);
        }
      }
    }
    for (const [pair, rel] of Object.entries(b.pairs)) {
      const cur = c.pairs[pair];
      if (cur && cur !== rel) problems.push(`${file}: winner flipped: ${show(pair)} (${rel} became ${cur})`);
    }
  }
  return problems;
}

function dups() {
  const files = [];
  const walk = (dir, prefix) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) walk(join(dir, d.name), `${prefix}${d.name}/`);
      else if (d.name.endsWith('.css')) files.push(`${prefix}${d.name}`);
    }
  };
  walk(stylesDir, '');
  const defs = new Map();
  for (const f of files.sort()) {
    const entries = parseSheet(readFileSync(join(stylesDir, f), 'utf8'), f);
    for (const e of entries) {
      if (!defs.has(e.key)) defs.set(e.key, []);
      defs.get(e.key).push(`${f}:${e.line}`);
    }
  }
  const multi = [...defs.entries()].filter(([, v]) => v.length > 1);
  for (const [key, locs] of multi.sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`${key.replace(/␟/g, ' :: ')}\n    ${locs.join('  ')}`);
  }
  console.log(`\n${multi.length} selectors defined more than once across ${files.length} slab files.`);
}

const mode = process.argv[2];
if (mode === 'baseline') {
  const snap = snapshotDist();
  writeFileSync(baselinePath, JSON.stringify(snap, null, 1));
  const total = Object.values(snap).reduce((n, f) => n + f.rules, 0);
  console.log(`Baseline written: ${Object.keys(snap).length} files, ${total} rule-selectors -> ${baselinePath}`);
} else if (mode === 'compare') {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    console.error(`No baseline at ${baselinePath} — run the baseline mode on a known-good build first.`);
    process.exit(2);
  }
  const problems = compare(baseline, snapshotDist());
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error(`\n${problems.length} cascade differences against the baseline.`);
    process.exit(1);
  }
  console.log('Cascade identical to baseline: every selector resolves the same, no source-order winner flipped.');
} else if (mode === 'dups') {
  dups();
} else {
  console.error('Usage: css-cascade-check.mjs baseline|compare|dups');
  process.exit(2);
}
