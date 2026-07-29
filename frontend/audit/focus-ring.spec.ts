import { type Page, expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * WCAG 1.4.11: the focus ring itself, against what it is drawn on. 3:1, not 4.5 — it is a graphical
 * object, not text.
 *
 * `state-contrast.spec.ts` measures TEXT colour while an element is focused, and found nothing
 * because none of the 25 focus rules in this app changes a text or background colour. They all set
 * `outline`. So the entire focus treatment — the thing a keyboard user actually navigates by — was
 * measured by no gate at all, and "focus: 0 findings" was quietly reporting on rules that do not
 * exist rather than on the ones that do.
 *
 * axe has no rule for this. It is computed here from the rendered page: force the state, read the
 * outline, resolve what is behind it, composite, compare.
 *
 * ## Which elements this asserts on, and which it only counts
 *
 * Probing the three states a focusable element can be in showed that only one of them is honestly
 * measurable from computed style:
 *
 *  - **An app-authored ring** (`outline-style` solid/dashed/…, width > 0). Asserted.
 *  - **The UA ring** (`outline-style: auto`). Chrome paints an adaptive two-tone ring, and the
 *    computed `outline-color` does not describe it — it reports `rgb(16, 16, 16)`, which measured
 *    against a near-black surface would be a confident ~1:1 failure that is not real. Counted, never
 *    asserted, because a gate that invents failures gets switched off as fast as one that misses them.
 *  - **No outline at all.** Not automatically a bug: on this app every such element is an `input`
 *    whose focus affordance is drawn on a SIBLING (`.workspace-setting-switch input:focus-visible + i`)
 *    or is `.sr-only`. Deciding whether a sibling or ancestor is showing focus properly is SC 2.4.7,
 *    a different question with a different answer shape. Counted, not asserted.
 *
 * The two counted buckets are budgeted per surface, so they cannot quietly grow into a hole. That
 * is the same shape `contrast.spec.ts` uses for the nodes axe cannot resolve, for the same reason:
 * silently unmeasured and measured-and-passing must not look identical.
 *
 * ## What "against" means
 *
 * `outline-offset` decides it. A positive offset draws the ring OUTSIDE the element, so the adjacent
 * colour is whatever is behind it — the nearest ancestor with an opaque background, composited. A
 * zero or negative offset overlaps the element, so the element's own background counts too, and the
 * worse of the two is what gets asserted. Every ring in this app currently sits at +2px or +3px.
 */

/** WCAG 1.4.11 non-text contrast. */
const MINIMUM = 3;

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * Ring/background pairs known to fall below 3:1, with the ratio each measures.
 * RATCHET: entries come off when a colour is fixed. Nothing goes on.
 */
const KNOWN_PAIRS: Record<string, string> = {};

/**
 * Focusable elements whose ring cannot be measured from computed style, per surface.
 *
 * `auto` is Chrome's own ring; `none` is an element whose affordance lives on a sibling or ancestor.
 * Both are real and both are outside what this gate can honestly answer, so they are capped rather
 * than ignored — growth here means focusable UI arriving with no ring of its own.
 */
const UNMEASURED_BUDGET: Record<string, number> = {
  'app-motion': 6,
  'app-settings': 5,
  'app-assets': 3,
  'app-stress': 3,
  'app-evidence': 2,
  'app-gallery': 2,
  'app-overview': 2,
  'app-project': 2,
  'app-releases': 2,
  'app-sources': 2,
  'local-evidence': 1,
  'local-releases': 1,
  'local-scan': 1,
  landing: 0,
  'local-overview': 0,
  'local-sources': 0,
};
/** A surface not listed above is new, and new UI should arrive with its own ring. */
const DEFAULT_UNMEASURED = 0;

function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg: string, bg: string) {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

interface Measured {
  ring: string;
  background: string;
  sample: string;
}

interface RingReport {
  measured: Measured[];
  auto: number;
  none: number;
  unresolvable: number;
  /** How each element looked, in document order, so focused can be diffed against default. */
  signatures: string[];
  /** Whether that element has an outline this gate can read, aligned with `signatures`. */
  measurable: boolean[];
}

/**
 * What an element's focus affordance looks like, as one comparable string.
 *
 * Read before forcing the state and again after. If it does not change, focusing that element
 * changes nothing a person can see — which is how a decorative outline that out-specifies the
 * focus rule hides the ring completely, and it looks identical to a correct page from every other
 * angle including this gate's own contrast check.
 */
async function readSignatures(page: Page, focusable: string): Promise<Array<{ sig: string; what: string }>> {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const cs = getComputedStyle(el);
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ').join('.')}` : '';
      return {
        sig: `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.outlineOffset}|${cs.boxShadow}`,
        what: `${el.tagName.toLowerCase()}${cls}`,
      };
    }), focusable);
}

/**
 * Reads every focused element's ring and the colour behind it, in the page.
 *
 * Colours are composited by the browser on a canvas rather than parsed here. Computed styles come
 * back as `lab()` / `oklab()` in this Chrome, alpha is possible at every layer, and reimplementing
 * colour-space conversion plus alpha compositing in a test is how a gate ends up confidently wrong.
 */
async function readRings(page: Page, focusable: string): Promise<RingReport> {
  return page.evaluate((sel) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const pixel = (base: string, layers: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 1, 1);
      for (const layer of layers) {
        ctx.fillStyle = layer;
        ctx.fillRect(0, 0, 1, 1);
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    };

    const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

    /**
     * Alpha without parsing a colour string: paint it over white and over black. For a colour C
     * with alpha a, result = a*C + (1-a)*B, so the gap between the two backgrounds is (1-a)*255.
     * Exact, and indifferent to which colour syntax Chrome hands back.
     */
    const alphaOf = (colour: string) => {
      const onWhite = pixel('#ffffff', [colour])[0];
      const onBlack = pixel('#000000', [colour])[0];
      return 1 - (onWhite - onBlack) / 255;
    };

    /** The opaque colour behind `start`, composited, or null when an image makes it unknowable. */
    const backgroundBehind = (start: Element | null): string | null => {
      const layers: string[] = [];
      for (let n = start; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage !== 'none') return null;
        const colour = cs.backgroundColor;
        if (alphaOf(colour) > 0) layers.unshift(colour);
        if (alphaOf(colour) >= 0.999) return hex(pixel('#000000', layers));
      }
      // Nothing opaque all the way up. The page root is opaque in this app, so this means an
      // unexpected tree; black is the safest assumption because it maximises a light ring's ratio
      // and so cannot manufacture a failure.
      return hex(pixel('#000000', layers));
    };

    const report = { measured: [] as Measured[], auto: 0, none: 0, unresolvable: 0, signatures: [] as string[], measurable: [] as boolean[] };

    for (const el of document.querySelectorAll(sel)) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      const width = parseFloat(cs.outlineWidth);
      report.signatures.push(`${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.outlineOffset}|${cs.boxShadow}`);
      // Only an element that HAS a readable outline can be said to have one that fails to change.
      // An `outline: 0` search input whose affordance lives on its wrapper is a different case and
      // is counted below, not asserted on here.
      report.measurable.push(cs.outlineStyle !== 'none' && cs.outlineStyle !== 'auto' && width > 0);

      if (cs.outlineStyle === 'auto') { report.auto++; continue; }
      if (cs.outlineStyle === 'none' || !(width > 0)) { report.none++; continue; }

      const offset = parseFloat(cs.outlineOffset) || 0;
      // Positive offset puts the ring outside the box, so it sits on whatever is behind the
      // element. Zero or negative overlaps it, and then the element's own background counts too.
      const behind = backgroundBehind(el.parentElement);
      const over = offset > 0 ? [behind] : [behind, backgroundBehind(el)];
      if (over.some((b) => b === null)) { report.unresolvable++; continue; }

      const description = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}`;
      for (const background of over as string[]) {
        report.measured.push({
          ring: hex(pixel(background, [cs.outlineColor])),
          background,
          sample: description,
        });
      }
    }
    return report;
  }, focusable);
}

for (const surface of surfaces) {
  test(`focus-ring · ${surface.id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, surface);

    // Before anything is forced: what the page looks like with nothing focused.
    const before = await readSignatures(page, FOCUSABLE);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: FOCUSABLE });
    for (const nodeId of nodeIds) {
      // Both, because :focus-visible is what the app's rules target and :focus is what a couple of
      // older rules use. A keyboard-focused element matches both at once.
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
    }

    /**
     * No focusable elements means this gate measured nothing while reporting green — the failure
     * mode that matters for a gate whose baseline is empty. Every surface in this app has at least
     * a nav button, so zero is a broken harness, not a clean page.
     */
    expect(nodeIds.length, `${surface.id}: no focusable element was found, so nothing was measured`)
      .toBeGreaterThan(0);

    const report = await readRings(page, FOCUSABLE);

    const found = new Map<string, { count: number; sample: string; ratio: number }>();
    for (const m of report.measured) {
      const r = ratio(m.ring, m.background);
      if (r >= MINIMUM) continue;
      const key = `${m.ring} on ${m.background}`;
      const prev = found.get(key);
      found.set(key, { count: (prev?.count ?? 0) + 1, sample: prev?.sample ?? m.sample, ratio: r });
    }

    /**
     * Elements that look exactly the same focused as unfocused.
     *
     * A decorative `outline` on a two-class selector out-specifies `button:focus-visible`, so the
     * ring never renders and the contrast check above happily measures the decoration instead. The
     * page looks correct to every other signal. Only diffing the two states catches it.
     */
    const unchanged = before
      .filter((b, i) => b.sig === report.signatures[i] && report.measurable[i])
      .map((b) => b.what);

    const unmeasured = report.auto + report.none + report.unresolvable;
    console.log(
      `  [focus-ring] ${surface.id}: ${report.measured.length} rings measured, `
      + `${found.size} below ${MINIMUM}:1, ${unchanged.length} unchanged when focused [${unchanged.join(', ')}], ${unmeasured} unmeasurable `
      + `(${report.auto} browser-default, ${report.none} no ring of their own, ${report.unresolvable} over an image)`,
    );

    const unknown = [...found.entries()].filter(([key]) => !(key in KNOWN_PAIRS));
    expect(
      unknown.map(([key, v]) => `${key} = ${v.ratio.toFixed(2)}:1 (x${v.count}, e.g. ${v.sample})`),
      `${surface.id}: focus rings below ${MINIMUM}:1 against what they are drawn on. A ring nobody `
      + 'can see is the same as no ring for the person navigating by keyboard.',
    ).toEqual([]);

    expect(
      unchanged,
      `${surface.id}: these have an outline that is identical focused and unfocused, so focusing `
      + 'them shows nothing new. The usual cause is a decorative `outline` on a two-class selector '
      + 'out-specifying `button:focus-visible` (0,1,1), which silently replaces the focus ring with '
      + 'the decoration — and the contrast check above then measures the decoration and passes.',
    ).toEqual([]);

    const budget = UNMEASURED_BUDGET[surface.id] ?? DEFAULT_UNMEASURED;
    expect(
      unmeasured,
      `${surface.id}: ${unmeasured} focusable elements whose ring this gate cannot measure, budget `
      + `${budget}. Growth means focusable UI arriving with no ring of its own, or relying on the `
      + 'browser default — neither is checked by anything, which is why the count is capped.',
    ).toBeLessThanOrEqual(budget);
  });
}
