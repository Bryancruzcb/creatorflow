import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The slab order is load-bearing, so it is asserted rather than trusted to a comment.
 *
 * `src/styles/` is one 11,978-line stylesheet cut into eleven numbered files and re-imported in
 * order. Several rules in it win on source position rather than on specificity — the split was
 * verified byte-identical precisely because reordering it changes what renders. Three separate
 * bugs have already traced to position deciding a rule:
 *
 *  - `.local-ownership-facts dt` used to beat `.local-asset-inspector dt` on position alone;
 *    the #120 consolidation fixed that tie at the selector (dl-qualified), but it stands as
 *    the canonical example of the failure mode this file guards against.
 *  - A verdict headline authored at 16px rendered at 12px because a container's descendant rule
 *    outranked it.
 *  - A mobile override lost a specificity tie because it was written earlier in the file than the
 *    rule it was meant to override.
 *
 * These are cheap, deterministic checks for the mechanical half of that risk: a slab dropped from
 * the barrel, a slab added and never imported, a duplicate, or the order changed. They do not and
 * cannot tell you whether a given rule wins for a good reason — that needs the browser, and it is
 * a separate, larger piece of work.
 */

const STYLES = resolve(__dirname);
const INDEX = resolve(STYLES, 'index.css');

/** `@import './07-stress.css';` -> `07-stress.css`, in the order they appear. */
function importedSlabs(): string[] {
  const css = readFileSync(INDEX, 'utf8');
  return [...css.matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => m[1]);
}

/** Numbered slabs on disk, sorted by their own prefix. */
function slabsOnDisk(): string[] {
  return readdirSync(STYLES)
    .filter((f) => /^\d\d-.+\.css$/.test(f))
    .sort();
}

describe('stylesheet slab order', () => {
  it('imports every numbered slab on disk', () => {
    const missing = slabsOnDisk().filter((f) => !importedSlabs().includes(f));
    expect(
      missing,
      `these slabs exist but index.css never imports them, so nothing in them renders:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('imports nothing that is not on disk', () => {
    const onDisk = new Set(slabsOnDisk());
    const dangling = importedSlabs().filter((f) => /^\d\d-/.test(f) && !onDisk.has(f));
    expect(dangling, `index.css imports files that do not exist: ${dangling.join(', ')}`).toEqual([]);
  });

  it('imports them in ascending numeric order', () => {
    /**
     * The whole point. A reordered barrel changes which of two colliding rules wins, silently and
     * everywhere at once — and the split's own guarantee was that the built CSS is byte-identical
     * to the monolith, which only holds while this order does.
     */
    const numbered = importedSlabs().filter((f) => /^\d\d-/.test(f));
    const sorted = [...numbered].sort();
    expect(
      numbered,
      'index.css imports the slabs out of numeric order. Source position decides which rule wins '
      + 'in several known places, so this reorders the cascade rather than reorganising files.\n'
      + `  found:  ${numbered.join(' ')}\n  expect: ${sorted.join(' ')}`,
    ).toEqual(sorted);
  });

  it('imports each slab exactly once', () => {
    const seen = new Map<string, number>();
    for (const f of importedSlabs()) seen.set(f, (seen.get(f) ?? 0) + 1);
    const repeated = [...seen.entries()].filter(([, n]) => n > 1).map(([f, n]) => `${f} x${n}`);
    expect(
      repeated,
      `a slab imported twice is appended twice, so its rules beat everything between the two `
      + `copies: ${repeated.join(', ')}`,
    ).toEqual([]);
  });

  it('imports every extracted feature file exactly once, and nothing that is not on disk', () => {
    /**
     * Feature files (issue #120 consolidation) carry the same position-is-load-bearing
     * property as the slabs: each is imported at its donor slab's position, and the
     * cascade gate (scripts/css-cascade-check.mjs) proved that exact position harmless.
     * A dropped import silently unstyles a feature; a duplicate appends its rules twice.
     */
    const onDisk = readdirSync(resolve(STYLES, 'features')).filter((f) => f.endsWith('.css'));
    const imported = importedSlabs().filter((f) => f.startsWith('features/'));
    const counts = new Map<string, number>();
    for (const f of imported) counts.set(f.slice('features/'.length), (counts.get(f.slice('features/'.length)) ?? 0) + 1);
    const missing = onDisk.filter((f) => !counts.has(f));
    const dangling = [...counts.keys()].filter((f) => !onDisk.includes(f));
    const repeated = [...counts.entries()].filter(([, n]) => n > 1).map(([f, n]) => `${f} x${n}`);
    expect(missing, `feature files on disk that index.css never imports: ${missing.join(', ')}`).toEqual([]);
    expect(dangling, `index.css imports feature files that do not exist: ${dangling.join(', ')}`).toEqual([]);
    expect(repeated, `feature files imported more than once: ${repeated.join(', ')}`).toEqual([]);
  });

  it('leaves no numbered gap, which would mean a slab was deleted rather than emptied', () => {
    const numbers = slabsOnDisk().map((f) => Number(f.slice(0, 2)));
    const gaps: number[] = [];
    for (let n = 1; n <= Math.max(...numbers); n += 1) if (!numbers.includes(n)) gaps.push(n);
    expect(
      gaps,
      `slab numbers ${gaps.join(', ')} are missing. Renumbering the survivors to close a gap would `
      + 'move every rule after it relative to every rule before it.',
    ).toEqual([]);
  });
});
