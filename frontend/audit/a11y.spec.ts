import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * Accessible names and text alternatives.
 *
 * Three of the last five serious review findings were of this kind — a colour channel that was the
 * sole carrier of a measurement with no text alternative, a progress readout announced ~41 times
 * into a live region, an error state that removed the live region entirely. None were visible to
 * vitest or tsc, and all were found by hand. This is the gate that was missing.
 *
 * Scoped to the rules that catch that class of defect, not a full WCAG sweep.
 *
 * The original reason given here was "a gate that fails on 200 pre-existing colour-contrast
 * findings gets switched off in a week". The instinct was right; the number was invented. Measured
 * afterwards: 332 findings, but only FOURTEEN distinct colour pairs, because the colour layer is
 * almost entirely tokenised. contrast.spec.ts now covers them with a pair-keyed baseline — see
 * that file. Landmarks and heading order are still uncovered.
 */

const NAME_RULES = [
  'aria-command-name',
  'aria-input-field-name',
  'aria-meter-name',
  'aria-progressbar-name',
  'aria-toggle-field-name',
  'aria-tooltip-name',
  'button-name',
  'empty-heading',
  'frame-title',
  'image-alt',
  'input-button-name',
  'input-image-alt',
  'label',
  'link-name',
  'object-alt',
  'role-img-alt',
  'select-name',
  'svg-img-alt',
  // structure rules that decide whether a name is announced at all
  'aria-hidden-focus',
  'aria-required-attr',
  'aria-valid-attr-value',
  'duplicate-id-aria',
];

for (const surface of surfaces) {
  test(`accessible names · ${surface.id}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(page, surface);

    const results = await new AxeBuilder({ page })
      .withRules(NAME_RULES)
      .exclude('[data-harness-chrome]')
      .analyze();

    const report = results.violations.map((v) => {
      const where = v.nodes.slice(0, 4).map((n) => `      ${n.target.join(' ')}`).join('\n');
      return `  [${v.id}] ${v.help} (${v.nodes.length})\n${where}`;
    }).join('\n');

    expect(results.violations, `${surface.id}: unnamed or unannounceable elements —\n${report}`).toEqual([]);
  });
}
