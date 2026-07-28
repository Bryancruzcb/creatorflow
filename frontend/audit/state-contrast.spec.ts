import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * Colour contrast in the :hover, focus and :active states, which no other gate here can see.
 *
 * `contrast.spec.ts` reads the page as rendered, and a page is rendered in its default state. axe
 * has no notion of hovering or focusing, so an interaction style had never been measured by
 * anything. That is not hypothetical: `.button-primary:hover` put `--ink` on the light blue at
 * **2.81:1** — worse than the 3.66:1 default the contrast gate *did* flag — and the gate would have
 * stayed green over it indefinitely. It was found by hand while splitting `--blue`, which is not a
 * repeatable process.
 *
 * ## Why forcing the state, rather than driving the browser
 *
 * Playwright's `hover()` does full actionability checks and scrolls elements into view: measured at
 * **1459ms per element**, which across sixteen surfaces is about eleven minutes. Chrome's
 * `CSS.forcePseudoState` — what DevTools' "force element state" uses — is **17ms**, applies the
 * real cascade, and shows up in computed style. Same answer, ~84x cheaper.
 *
 * ## Why forcing them all at once is sound, per state
 *
 * Forcing every candidate at once is not a state one pointer or one focus ring can produce, so the
 * question is whether it can invent a colour pair that cannot really occur. Classifying every state
 * rule in the stylesheets by shape answers it:
 *
 * | state            | self | descendant | sibling |
 * |------------------|------|------------|---------|
 * | `:hover`         |  90  |     9      |    0    |
 * | `:focus-visible` |  32  |     0      |    1    |
 * | `:focus-within`  |   2  |     2      |    0    |
 * | `:focus`         |   2  |     0      |    0    |
 * | `:active`        |   5  |     2      |    0    |
 *
 * **self** and **descendant** are always safe: all three states already propagate up the ancestor
 * chain — hovering, focusing or activating a child puts its ancestors in that state too — so for
 * any node, "its own state plus its ancestors'" is exactly what a real interaction on it produces.
 *
 * **sibling** (`.a:focus + .b`) is the one unsound shape, because it needs `.a` stated while `.b`
 * may also be stated, and focus and active are singular. Exactly one exists, and it sets only
 * `outline` / `outline-offset` — properties the colour-contrast rule never reads, so it cannot
 * invent a pair. That is an assumption about a rule body, which is the kind of thing that quietly
 * stops being true, so `assertNoColouredSiblingRule` below **enforces** it rather than asserting it
 * in a comment. If someone gives that rule a colour, this gate fails and says why.
 *
 * ## What is still not covered
 *
 * `:visited` and `:target`. Neither is styled anywhere in this app, so a gate for them would assert
 * nothing today; the machinery here extends to both the day they are.
 */

/** Properties the colour-contrast rule actually reads. Anything else cannot invent a pair. */
const COLOUR_PROPERTIES = ['color', 'background', 'background-color', '-webkit-text-fill-color'];

interface StateGate {
  id: string;
  /** Pseudo-classes handed to CDP. Forced together because a real interaction sets them together. */
  pseudos: string[];
  /** Pseudo-classes to look for in the stylesheets when deciding what to force. */
  selectors: string[];
  /**
   * Pairs known to fail in this state, with the ratio each measures.
   * RATCHET: entries come off when a colour is fixed. Nothing goes on.
   */
  known: Record<string, string>;
}

const STATE_GATES: StateGate[] = [
  {
    id: 'hover',
    pseudos: ['hover'],
    selectors: [':hover'],
    // Empty on arrival: the one hover failure this gate was written for (--ink on --blue-hover at
    // 2.81:1, the primary button) was fixed by the token split that exposed it.
    known: {},
  },
  {
    id: 'focus',
    // A keyboard-focused element matches all three at once — :focus-within matches the focused
    // element itself, not only its ancestors — so forcing them together is one real state, not a
    // union of three.
    pseudos: ['focus', 'focus-visible', 'focus-within'],
    selectors: [':focus', ':focus-visible', ':focus-within'],
    known: {},
  },
  {
    id: 'active',
    pseudos: ['active'],
    selectors: [':active'],
    known: {},
  },
];

function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg: string, bg: string) {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** Walks every readable rule in the page's own stylesheets, including nested media/supports blocks. */
function eachRule(visit: (selectorText: string, style: CSSStyleDeclaration) => void) {
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
      const styleRule = rule as CSSStyleRule;
      if (styleRule.selectorText) visit(styleRule.selectorText, styleRule.style);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin sheets cannot be read. None are expected here; the forced-element count
      // asserted below is what would catch their absence mattering.
    }
  }
}

/**
 * Every selector styling one of `pseudos`, reduced to the element that has to be in that state.
 *
 * Read off `document.styleSheets` rather than from a list in this file: a gate that hardcodes which
 * components have interaction styles goes stale the first time somebody adds one, and goes stale
 * silently, which is the failure mode every gate in this directory exists to avoid.
 */
async function statedSelectors(page: Page, pseudos: string[]): Promise<string[]> {
  return page.evaluate(({ pseudos: names, source }) => {
    // eslint-disable-next-line no-new-func -- the walker is defined test-side and shipped in as text
    const walkRules = new Function(`return (${source})`)() as typeof eachRule;
    const out = new Set<string>();

    walkRules((selectorText) => {
      if (!names.some((p) => selectorText.includes(p))) return;
      for (const one of selectorText.split(',')) {
        const sel = one.trim();
        const used = names.filter((p) => sel.includes(p));
        if (!used.length) continue;
        // Keep everything up to and including the compound carrying the state, then drop the
        // pseudo: `.a:focus > .b` has to force `.a`, not `.b`.
        const segments = sel.split(/(\s*[>+~]\s*|\s+)/);
        let upto = '';
        for (const segment of segments) {
          upto += segment;
          if (used.some((p) => segment.includes(p))) break;
        }
        let base = upto;
        // Longest first so :focus-visible is not shortened into a stray "-visible".
        for (const p of [...names].sort((a, b) => b.length - a.length)) base = base.split(p).join('');
        base = base.trim().replace(/[>+~]\s*$/, '').trim();
        if (base) out.add(base);
      }
    });
    return [...out];
  }, { pseudos, source: eachRule.toString() });
}

/**
 * Fails if a sibling-combinator rule for this state sets a colour property.
 *
 * This is the single assumption that makes forcing every element at once sound, so it is checked
 * against the shipped stylesheets on every run instead of being written down and trusted.
 */
async function assertNoColouredSiblingRule(page: Page, pseudos: string[], properties: string[]) {
  const offenders = await page.evaluate(({ pseudos: names, properties: props, source }) => {
    // eslint-disable-next-line no-new-func -- see above
    const walkRules = new Function(`return (${source})`)() as typeof eachRule;
    const found: string[] = [];

    walkRules((selectorText, style) => {
      for (const one of selectorText.split(',')) {
        const sel = one.trim();
        for (const name of names) {
          for (let i = sel.indexOf(name); i !== -1; i = sel.indexOf(name, i + 1)) {
            const after = sel.slice(i + name.length);
            // `:focus` is a prefix of `:focus-visible`. Matching it there would read the tail as
            // "-visible + i" and skip a genuine sibling rule — which is exactly what happened, and
            // the canary for this guard passed while the guard was blind.
            if (/^[a-z-]/.test(after)) continue;
            if (!/^\s*[+~]/.test(after)) continue;
            const set = props.filter((prop) => style.getPropertyValue(prop));
            if (set.length) found.push(`${sel} sets ${set.join(', ')}`);
          }
        }
      }
    });
    return found;
  }, { pseudos, properties, source: eachRule.toString() });

  expect(
    offenders,
    'A sibling-combinator rule for this state now sets a colour. Forcing every element into the '
    + 'state at once then produces a pair that no single real interaction can produce, and this '
    + 'gate would report it as a failure. Either force one element at a time and accept the cost, '
    + 'or confirm the pair is reachable and baseline it.',
  ).toEqual([]);
}

for (const state of STATE_GATES) {
  for (const surface of surfaces) {
    test(`state-contrast · ${state.id} · ${surface.id}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await open(page, surface);

      await assertNoColouredSiblingRule(page, state.selectors, COLOUR_PROPERTIES);

      const selectors = await statedSelectors(page, state.selectors);

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
          // A selector Chrome's DOM agent will not parse; it is stricter than the CSS parser.
          continue;
        }
        for (const nodeId of nodeIds) {
          await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state.pseudos });
          forced++;
        }
      }

      /**
       * Two different things look identical from the outside, and only one is a bug.
       *
       * No SELECTORS means the extraction broke, and the gate would then measure the default state
       * on every surface while reporting green — the failure mode that matters for a gate with an
       * empty baseline, because nothing else would distinguish it from success. That fails here.
       *
       * No forced ELEMENTS is a true fact about this surface: `app-gallery` really has nothing that
       * styles `:active`. Failing on that would only teach whoever hits it to weaken the check
       * above, so it is logged loudly and the surface reports what it is.
       */
      expect(
        selectors.length,
        `no selector styling :${state.id} was found in the stylesheets, so this gate would measure `
        + 'the default state and report green on every surface',
      ).toBeGreaterThan(0);

      if (forced === 0) {
        console.log(
          `  [state-contrast:${state.id}] ${surface.id}: ${selectors.length} selectors, `
          + 'NO MATCHING ELEMENTS — this surface has nothing in this state, nothing was measured',
        );
        return;
      }

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

      const unknown = [...found.entries()].filter(([key]) => !(key in state.known));

      console.log(
        `  [state-contrast:${state.id}] ${surface.id}: ${selectors.length} selectors, ${forced} elements forced, `
        + `${[...found.values()].reduce((s, v) => s + v.count, 0)} findings across ${found.size} pairs`
        + `${found.size ? ` [${[...found.keys()].join(', ')}]` : ''}`,
      );

      expect(
        unknown.map(([key, v]) => `${key} = ${ratio(key.slice(0, 7), key.slice(-7)).toFixed(2)}:1 (x${v.count}, e.g. ${v.sample})`),
        `${surface.id}: colour pairs that fail while :${state.id}. An interaction style has to be as `
        + 'readable as a default one, and this is the only gate that looks at one.',
      ).toEqual([]);
    });
  }
}
