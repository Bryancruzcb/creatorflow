import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * Colour contrast in the :hover state, which no other gate here can see.
 *
 * `contrast.spec.ts` reads the page as rendered, and a page is rendered in its default state. axe
 * has no notion of hovering, so a hover style has never been measured by anything. That is not
 * hypothetical: `.button-primary:hover` put `--ink` on the light blue at **2.81:1** — worse than
 * the 3.66:1 default the contrast gate *did* flag — and the gate would have stayed green over it
 * indefinitely. It was found by hand while splitting `--blue`, which is not a repeatable process.
 *
 * ## Why forcing the state, rather than moving the mouse
 *
 * Playwright's `hover()` does full actionability checks and scrolls elements into view: measured at
 * **1459ms per element**, which across sixteen surfaces is about eleven minutes. Chrome's
 * `CSS.forcePseudoState` — what DevTools' "force element state" uses — is **17ms**, applies the
 * real cascade, and shows up in computed style. Same answer, ~84x cheaper.
 *
 * ## Why forcing them all at once is sound
 *
 * Forcing every hoverable element simultaneously is not a state a single pointer can produce, so
 * the question is whether it can invent a colour pair that cannot really occur. It cannot here:
 *
 * - `:hover` already propagates up the ancestor chain — hovering a child hovers its parents — so
 *   for any given node, "its own :hover plus its ancestors' :hover" is exactly what a real pointer
 *   on that node produces. Four descendant/sibling state rules exist and all are of that shape.
 * - The only way one subtree could style another is `:has()` with a state pseudo, and there is
 *   none. (`:has()` appears twice in the stylesheets, neither with a state.)
 *
 * If either of those changes, this gate starts measuring combinations that cannot happen, and the
 * honest response is to hover elements one at a time and accept the cost.
 *
 * ## What is still not covered
 *
 * `:focus-visible` and `:active`. The same machinery would reach them and the same reasoning
 * applies, but each needs its own baseline and its own look at what it finds; bundling them in
 * would mean shipping three gates none of which had been read carefully. Stated here rather than
 * left for someone to assume this file covers every state.
 */

/**
 * Pairs known to fail in a hovered state, with the ratio each measures.
 *
 * RATCHET: entries come off when a colour is fixed. Nothing goes on. A pair not in this list fails.
 */
const KNOWN_PAIRS: Record<string, string> = {
  // Empty on arrival. The one hover failure this gate was written for (--ink on --blue-hover at
  // 2.81:1, the primary button) was fixed by the token split that exposed it, so this gate starts
  // green and is canaried instead: reverting --blue-solid-hover fails it.
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

/**
 * Every selector in the page's own stylesheets that styles a `:hover`, reduced to the element that
 * has to be hovered for it to apply.
 *
 * Read off `document.styleSheets` rather than from a list in this file: a gate that hardcodes which
 * components have hover styles goes stale the first time somebody adds one, and goes stale
 * silently, which is the failure mode every gate in this directory exists to avoid.
 */
async function hoverableSelectors(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();

    const collect = (rules: CSSRuleList) => {
      for (const rule of rules) {
        // Media and supports blocks nest the rules that matter.
        if ('cssRules' in rule) collect((rule as CSSGroupingRule).cssRules);
        const selectorText = (rule as CSSStyleRule).selectorText;
        if (!selectorText || !selectorText.includes(':hover')) continue;

        for (const one of selectorText.split(',')) {
          const sel = one.trim();
          if (!sel.includes(':hover')) continue;
          // Keep everything up to and including the compound that carries :hover, then drop the
          // pseudo itself: `.a:hover > .b` has to force `.a`, not `.b`.
          const segments = sel.split(/(\s*[>+~]\s*|\s+)/);
          let upto = '';
          for (const segment of segments) {
            upto += segment;
            if (segment.includes(':hover')) break;
          }
          const base = upto.replace(/:hover/g, '').trim().replace(/[>+~]\s*$/, '').trim();
          if (base) out.add(base);
        }
      }
    };

    for (const sheet of document.styleSheets) {
      try {
        collect(sheet.cssRules);
      } catch {
        // A cross-origin sheet cannot be read. None are expected; skipping one silently would be
        // the kind of hole this suite is meant to close, so it is surfaced by the count logged below.
      }
    }
    return [...out];
  });
}

for (const surface of surfaces) {
  test(`state-contrast · ${surface.id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, surface);

    const selectors = await hoverableSelectors(page);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });

    let forced = 0;
    for (const selector of selectors) {
      let nodeIds: number[] = [];
      try {
        ({ nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector }));
      } catch {
        // A selector Chrome's DOM agent will not parse (it is stricter than the CSS parser).
        // Counted below rather than swallowed.
        continue;
      }
      for (const nodeId of nodeIds) {
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
        forced++;
      }
    }

    /**
     * If nothing was forced, this test would pass while measuring the default state — a gate that
     * silently checks nothing. Every surface in this app has hover styling somewhere, so zero means
     * the selector extraction broke, not that the surface is clean.
     */
    expect(forced, `${surface.id}: no element was put into :hover, so this gate measured nothing`)
      .toBeGreaterThan(0);

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

    console.log(
      `  [state-contrast] ${surface.id}: ${selectors.length} hover selectors, ${forced} elements forced, `
      + `${[...found.values()].reduce((s, v) => s + v.count, 0)} findings across ${found.size} pairs`
      + `${found.size ? ` [${[...found.keys()].join(', ')}]` : ''}`,
    );

    expect(
      unknown.map(([key, v]) => `${key} = ${ratio(key.slice(0, 7), key.slice(-7)).toFixed(2)}:1 (x${v.count}, e.g. ${v.sample})`),
      `${surface.id}: colour pairs that fail while hovered. A hover style is as readable as a `
      + 'default one has to be, and this is the only gate that looks at it.',
    ).toEqual([]);
  });
}
