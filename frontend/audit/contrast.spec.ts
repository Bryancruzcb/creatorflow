import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * Colour contrast, at the real WCAG AA thresholds, baselined on COLOUR PAIRS rather than surfaces.
 *
 * `a11y.spec.ts` excluded this rule with the reasoning that "a gate that fails on 200 pre-existing
 * colour-contrast findings gets switched off in a week". The instinct was right and the premise
 * was wrong, which measuring settled: there are 332 findings across the sixteen surfaces, and they
 * are **fourteen distinct colour pairs**. The colour layer is almost entirely tokenised, so the
 * same few pairs repeat everywhere.
 *
 * That is why the baseline is keyed on the pair and not on the surface. A surface-level baseline
 * would exempt every page in the app and test nothing. A pair-level one still fails the moment a
 * new bad colour appears anywhere, and empties out almost entirely when one token is changed —
 * twelve of the fourteen are `--ink-dim` on a near-black background.
 *
 * Every known pair is between 3.66:1 and 4.50:1 against a 4.5 requirement. This is not a palette
 * with scattered mistakes in it; it is a palette one notch too dark, and fixing it is a design
 * decision with a real blast radius (238 `var(--ink-dim)` usages in src/styles alone), not a
 * cleanup to slip into a test PR.
 */

/**
 * Known pairs, with the ratio each actually measures. Ratios are recomputed here from the hex, so
 * the numbers in this file cannot drift from the colours in it.
 *
 * RATCHET: entries come off when a token is fixed. Nothing goes on. A pair not in this list fails.
 */
const KNOWN_PAIRS: Record<string, string> = {
  '#5f7fa0 on #111210': '--blue on --desk',
  '#818079 on #171816': '--ink-dim on a panel',
  '#818079 on #181916': '--ink-dim on a panel',
  '#818079 on #181a17': '--ink-dim on a panel',
  '#818079 on #191a17': '--ink-dim on --graphite',
  '#818079 on #1a1913': '--ink-dim on a panel',
  '#818079 on #1a1f1f': '--ink-dim on a panel',
  '#818079 on #1c1e1a': '--ink-dim on a panel',
  '#818079 on #1d2225': '--ink-dim on the darkroom skin',
  '#818079 on #1e1f1c': '--ink-dim on a panel',
  '#818079 on #1f201c': '--ink-dim on a panel',
  '#818079 on #1f2323': '--ink-dim on the darkroom skin',
  '#818079 on #22231f': '--ink-dim on --raised',
  '#f1f0ea on #5f7fa0': '--ink on --blue (primary button)',
};

/**
 * Nodes axe cannot resolve — text over the WebGL hero, over gradients, over images.
 *
 * These are reported, not asserted. axe returns "incomplete" because it genuinely cannot sample a
 * canvas, and treating that as a pass would be as dishonest as treating it as a failure. The
 * landing page carries 66 of them for exactly one reason: the hero field is a live WebGL canvas.
 *
 * Budgeted so the count cannot quietly grow. Measured today, largest first.
 */
const INCOMPLETE_BUDGET: Record<string, number> = {
  landing: 70,
  'app-motion': 26,
  'app-gallery': 20,
  'app-overview': 18,
  'app-project': 17,
  'local-evidence': 16,
  'app-assets': 15,
  'app-releases': 11,
  'app-sources': 11,
  'app-evidence': 11,
  'app-stress': 11,
  'app-settings': 7,
  'local-overview': 4,
  'local-scan': 4,
  'local-releases': 4,
  'local-sources': 4,
};

function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg: string, bg: string) {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

for (const surface of surfaces) {
  test(`contrast · ${surface.id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, surface);

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .exclude('[data-harness-chrome]')
      .analyze();

    const found = new Map<string, { count: number; sample: string }>();
    for (const violation of results.violations) {
      for (const node of violation.nodes) {
        const message = node.any?.[0]?.message ?? '';
        const m = /foreground color: (#[0-9a-f]{6}).*?background color: (#[0-9a-f]{6})/is.exec(message);
        if (!m) continue;
        const key = `${m[1].toLowerCase()} on ${m[2].toLowerCase()}`;
        const prev = found.get(key);
        found.set(key, { count: (prev?.count ?? 0) + 1, sample: prev?.sample ?? node.target.join(' ') });
      }
    }

    const unknown = [...found.entries()].filter(([key]) => !(key in KNOWN_PAIRS));
    const incomplete = results.incomplete.reduce((sum, v) => sum + v.nodes.length, 0);

    console.log(
      `  [contrast] ${surface.id}: ${[...found.values()].reduce((s, v) => s + v.count, 0)} findings `
      + `across ${found.size} pairs, ${incomplete} unresolvable`,
    );

    expect(
      unknown.map(([key, v]) => `${key} = ${ratio(key.slice(0, 7), key.slice(-7)).toFixed(2)}:1 (x${v.count}, e.g. ${v.sample})`),
      `${surface.id}: colour pairs not in the known set. Either a new colour was introduced below `
      + '4.5:1, or an existing one moved. Add it only with a reason — the baseline is a ratchet.',
    ).toEqual([]);

    const budget = INCOMPLETE_BUDGET[surface.id] ?? 5;
    expect(
      incomplete,
      `${surface.id}: ${incomplete} nodes axe could not resolve, budget ${budget}. These are text `
      + 'over a canvas, gradient or image. Growth means new unverifiable text, which is worth '
      + 'knowing even though it is not a failure by itself.',
    ).toBeLessThanOrEqual(budget);
  });
}
