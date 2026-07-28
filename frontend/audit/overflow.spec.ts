import { expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * Nothing may overflow its container, at any width.
 *
 * Added after the landing dossier shipped broken on a phone. The composition is three absolutely
 * positioned sheets at percentage widths overlapping each other — fine at 1440, and at 390px each
 * sheet was about 226px wide, so every panel clipped its own text and the manifest ran off the
 * right edge. It read as a rendering fault.
 *
 * Nothing caught it. The type-floor and accessible-name gates both run, and both run at 1440 only,
 * so a layout that only fails narrow was invisible to every check in the repo. That is the gap
 * this closes: the other two gates ask "is this readable", and neither asks "does it fit".
 */

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'laptop', width: 1280, height: 900 },
] as const;

/**
 * There is no baseline any more, and the one that was here recorded the wrong cause.
 *
 * It said the workspace shell "does not collapse on a phone" and blamed a 224px fixed nav rail.
 * That was a confident false statement in a repo whose binding rule is that nothing may claim
 * more than it measured. The shell already collapses at 48rem in 06-local.css — `.product-workspace`
 * computes to `display: block` and the sidebar becomes a full-width row.
 *
 * The real 231px was one declaration: a `@media (max-width: 48rem)` override pinning the proof
 * ribbon to `repeat(5, minmax(7.6rem, 1fr))`, which is 608px of tracks inside a 366px ribbon. It
 * was identical on all nine views because the ribbon is shell chrome, and app-settings measured 0
 * only because that view does not render a ribbon at all — a detail the old comment read as
 * "settings is fine".
 */
interface Overflow {
  sel: string;
  by: number;
  text: string;
}

for (const vp of WIDTHS) {
  for (const surface of surfaces) {
    test(`fits · ${surface.id} · ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, surface);

      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        /**
         * Horizontal page overflow is never intentional. Vertical is the normal way pages work,
         * so only the horizontal axis is asserted at the document level.
         */
        const pageBy = doc.scrollWidth - doc.clientWidth;

        /**
         * Content wider than the element clipping it. Restricted to elements that actually clip,
         * because an element with `overflow: visible` spilling is a layout choice rather than lost
         * content, and to leaf-ish nodes, so one clipped child does not report as ten nested ones.
         */
        const clipped: Overflow[] = [];
        document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
          if (el.closest('[data-harness-chrome]')) return;
          if (el.classList.contains('sr-only')) return;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (!el.getClientRects().length) return;
          // Scroll containers are meant to hold more than they show.
          const scrolls = [cs.overflow, cs.overflowX, cs.overflowY].some((v) => v === 'auto' || v === 'scroll');
          if (scrolls) return;
          const hides = [cs.overflow, cs.overflowX].some((v) => v === 'hidden' || v === 'clip');
          if (!hides) return;
          // text-overflow: ellipsis is deliberate truncation, not a layout failure.
          if (cs.textOverflow === 'ellipsis') return;
          const by = el.scrollWidth - el.clientWidth;
          if (by <= 2) return;
          const sel = el.tagName.toLowerCase()
            + (typeof el.className === 'string' && el.className
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : '');
          clipped.push({ sel, by, text: (el.textContent || '').trim().slice(0, 44) });
        });

        // Collapse repeats of the same rule so a list of 24 rows reports once.
        const seen = new Set<string>();
        const unique = clipped.filter((o) => {
          if (seen.has(o.sel)) return false;
          seen.add(o.sel);
          return true;
        });

        return { pageBy, clipped: unique };
      });

      expect(
        result.pageBy,
        `${surface.id} at ${vp.width}px scrolls horizontally by ${result.pageBy}px`,
      ).toBeLessThanOrEqual(2);

      expect(
        result.clipped,
        `${surface.id} at ${vp.width}px — content clipped by its own container:\n`
          + result.clipped.map((o) => `  ${o.sel} overflows by ${o.by}px  "${o.text}"`).join('\n'),
      ).toEqual([]);
    });
  }
}
