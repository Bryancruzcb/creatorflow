import { expect, test } from '@playwright/test';
import { open, surfaces } from './surfaces';

/**
 * Keyboard behaviour of the first-run dialog.
 *
 * Deliberately narrow. A full keyboard audit — tab-order walks across all sixteen surfaces, focus
 * indicator detection, trap detection — was scoped out after review: it bundles four independent
 * mechanisms, and the trap detector it proposed only catches one trap shape while reading as
 * though it catches all of them. This covers the one place with a real, specific WCAG defect.
 *
 * `WorkspaceWelcome` renders `role="dialog" aria-modal="true"` and handles Escape, and does
 * nothing else a modal has to do: focus never enters it, Tab walks straight out into the page
 * behind it, and on dismissal focus is wherever the browser left it. `aria-modal` tells assistive
 * tech the rest of the page is inert while the DOM says otherwise — the announcement and the
 * behaviour disagree, which is worse than not claiming modality at all.
 *
 * Each assertion below is written out rather than counted. An earlier draft of this plan said
 * "three of five fail" in one place and "four of five" in another; a number nobody can check is
 * exactly what this project forbids.
 */

const WORKSPACE = surfaces.find((s) => s.id === 'app-overview')!;

/** Everything the dialog owns, in DOM order. */
const FOCUSABLE = '[role="dialog"] button, [role="dialog"] a[href], [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea';

async function openFirstRun(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, WORKSPACE, { firstRun: true });
  await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
}

/** tag plus its first class — enough to name an element in a failure message. */
async function activeSignature(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${cls}[${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}]`;
  });
}

test.describe('first-run dialog · keyboard', () => {
  test('focus moves into the dialog when it opens', async ({ page }) => {
    await openFirstRun(page);
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement && document.querySelector('[role="dialog"]')?.contains(document.activeElement)));
    expect(inside, `focus is on ${await activeSignature(page)}, outside the dialog — a keyboard user `
      + 'has to tab through the whole page behind it to reach a dialog that claims to be modal').toBe(true);
  });

  test('Tab from the last control wraps to the first, not out of the dialog', async ({ page }) => {
    await openFirstRun(page);
    const count = await page.locator(FOCUSABLE).count();
    expect(count, 'the dialog has no focusable controls').toBeGreaterThan(1);

    // Walk to the last control, then once more.
    await page.locator(FOCUSABLE).last().focus();
    await page.keyboard.press('Tab');

    const inside = await page.evaluate(() =>
      Boolean(document.activeElement && document.querySelector('[role="dialog"]')?.contains(document.activeElement)));
    expect(inside, `Tab from the last control left the dialog and landed on ${await activeSignature(page)}. `
      + 'aria-modal="true" tells assistive tech the rest of the page is inert; the DOM disagrees.').toBe(true);
  });

  test('Shift+Tab from the first control wraps to the last', async ({ page }) => {
    await openFirstRun(page);
    await page.locator(FOCUSABLE).first().focus();
    await page.keyboard.press('Shift+Tab');

    const inside = await page.evaluate(() =>
      Boolean(document.activeElement && document.querySelector('[role="dialog"]')?.contains(document.activeElement)));
    expect(inside, `Shift+Tab from the first control left the dialog and landed on ${await activeSignature(page)}`).toBe(true);
  });

  test('Escape dismisses it', async ({ page }) => {
    await openFirstRun(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  /**
   * Restoration needs a stated target, which is why the first draft of this assertion could not
   * have passed. The dialog opens from localStorage during mount, so nothing was ever focused to
   * return to — `document.activeElement` is `<body>`, and "restore to body" is not a behaviour.
   * The fix gives the workspace main region `tabIndex={-1}` and sends focus there, so a keyboard
   * user resumes at the content the dialog was covering instead of at the top of the document.
   */
  test('dismissing lands focus on the workspace, not on body', async ({ page }) => {
    await openFirstRun(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    const landed = await activeSignature(page);
    expect(landed, 'after dismissal focus fell back to document body; the next Tab starts from the '
      + 'top of the page rather than from the content the dialog was covering').not.toBe('body');
  });
});
