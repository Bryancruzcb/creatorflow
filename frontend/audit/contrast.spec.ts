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
 * twelve of the fourteen were `--ink-dim` on a near-black background.
 *
 * **The baseline is now empty: zero findings across zero pairs, on all sixteen surfaces.** It got
 * there in two steps, and the second is the argument for keying on pairs. Raising `--ink-dim` took
 * fourteen pairs to two. The last two were one token failing in opposite directions at once —
 * `--blue` had to be darker to carry white text and lighter to be read as text — so it was split
 * into `--blue-solid` and `--blue-accent` rather than moved.
 */

/**
 * Known pairs, with the ratio each actually measures. Ratios are recomputed here from the hex, so
 * the numbers in this file cannot drift from the colours in it.
 *
 * RATCHET: entries come off when a token is fixed. Nothing goes on. A pair not in this list fails.
 */
const KNOWN_PAIRS: Record<string, string> = {
  // Empty, and that is the finished state of a ratchet rather than a gate with nothing to say.
  //
  // The last two entries were the same token failing in both directions: --blue was a filled button
  // background needing to be DARKER for white text (3.66:1), and an accent text colour on dark
  // surfaces needing to be LIGHTER (4.50:1). No single value satisfies both, which is why it was
  // recorded here instead of patched. --blue is now --blue-solid (48%, bounded by --ink on top of
  // it) and --blue-accent (67%, bounded by the lightest surface it lands on), and the sixteen
  // surfaces report zero findings across zero pairs.
  //
  // Anything appearing here again is a new colour below 4.5:1. Add it only with a reason.
};

/**
 * Nodes axe cannot resolve — text over the WebGL hero, over gradients, over images.
 *
 * axe returns these as "incomplete" because it genuinely cannot sample a canvas. Treating that as
 * a pass would be as dishonest as treating it as a failure, so they are reported either way.
 *
 * They are only ASSERTED on surfaces with no live canvas. On canvas surfaces the count is
 * timing-dependent: the landing hero measured 66 in a solo run and 79 under parallel workers, the
 * same build both times, because what axe can sample depends on what the renderer has painted when
 * it looks. A budget on a number that moves is a flaky gate, and a flaky gate gets deleted.
 *
 * On the rest the count is stable and small, and growth there means new text over a gradient or an
 * image — worth knowing.
 */
const CANVAS_SURFACES = new Set(['landing', 'app-motion', 'app-gallery', 'app-assets', 'app-stress']);

const INCOMPLETE_BUDGET: Record<string, number> = {
  'app-overview': 18,
  'app-project': 17,
  'local-evidence': 16,
  'app-releases': 11,
  'app-sources': 11,
  'app-evidence': 11,
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
      + `across ${found.size} pairs [${[...found.keys()].join(', ')}], ${incomplete} unresolvable`,
    );

    expect(
      unknown.map(([key, v]) => `${key} = ${ratio(key.slice(0, 7), key.slice(-7)).toFixed(2)}:1 (x${v.count}, e.g. ${v.sample})`),
      `${surface.id}: colour pairs not in the known set. Either a new colour was introduced below `
      + '4.5:1, or an existing one moved. Add it only with a reason — the baseline is a ratchet.',
    ).toEqual([]);

    if (!CANVAS_SURFACES.has(surface.id)) {
      const budget = INCOMPLETE_BUDGET[surface.id] ?? 5;
      expect(
        incomplete,
        `${surface.id}: ${incomplete} nodes axe could not resolve, budget ${budget}. These are text `
        + 'over a gradient or an image. Growth means new text whose contrast nobody can verify.',
      ).toBeLessThanOrEqual(budget);
    }
  });
}
