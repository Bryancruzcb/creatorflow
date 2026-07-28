import type { Page } from '@playwright/test';

export const APP = 'http://127.0.0.1:4177';
export const HARNESS = 'http://127.0.0.1:4176';

/**
 * Every surface the audits sweep.
 *
 * `harness` surfaces are the ones gated on a live desktop bridge. They are the reason the harness
 * exists: they cannot be reached from a built app at all, so before this they were audited by
 * nobody and by nothing.
 */
export interface Surface {
  id: string;
  url: string;
  /** Something that only exists once the surface has actually rendered. */
  ready: string;
  /** Views that mount a WebGL canvas need longer and settle later. */
  heavy?: boolean;
}

export const surfaces: Surface[] = [
  { id: 'landing', url: `${APP}/`, ready: 'h1' },
  { id: 'app-overview', url: `${APP}/#workspace?view=overview`, ready: '.product-workspace' },
  { id: 'app-evidence', url: `${APP}/#workspace?view=evidence`, ready: '.product-workspace' },
  { id: 'app-assets', url: `${APP}/#workspace?view=assets`, ready: '.product-workspace' },
  { id: 'app-releases', url: `${APP}/#workspace?view=releases`, ready: '.product-workspace' },
  { id: 'app-sources', url: `${APP}/#workspace?view=sources`, ready: '.product-workspace' },
  { id: 'app-settings', url: `${APP}/#workspace?view=settings`, ready: '.product-workspace' },
  { id: 'app-project', url: `${APP}/#workspace?view=project`, ready: '.product-workspace' },
  { id: 'app-gallery', url: `${APP}/#workspace?view=gallery`, ready: '.product-workspace', heavy: true },
  { id: 'app-motion', url: `${APP}/#workspace?view=motion`, ready: '.product-workspace', heavy: true },
  { id: 'app-stress', url: `${APP}/#workspace?view=stress`, ready: '.product-workspace', heavy: true },
  { id: 'local-evidence', url: `${HARNESS}/?scene=evidence`, ready: '[data-harness-scene]' },
  { id: 'local-overview', url: `${HARNESS}/?scene=overview`, ready: '[data-harness-scene]' },
  { id: 'local-scan', url: `${HARNESS}/?scene=scan`, ready: '[data-harness-scene]' },
  { id: 'local-releases', url: `${HARNESS}/?scene=releases`, ready: '[data-harness-scene]' },
  { id: 'local-sources', url: `${HARNESS}/?scene=sources`, ready: '[data-harness-scene]' },
];

/** Dismiss the first-run modal so it does not mask the surface under audit. */
export async function open(page: Page, surface: Surface) {
  // Key must match WELCOME_KEY in WorkspaceWelcome.tsx. If it drifts, the modal reopens and masks
  // every surface — which is loud rather than silent, because the ready selector then times out.
  await page.addInitScript(() => {
    try { localStorage.setItem('creatorflow:welcomed', '1'); } catch { /* ignore */ }
  });
  await page.goto(surface.url, { waitUntil: 'networkidle' });
  const close = page.locator('[role="dialog"] button[aria-label*="lose" i], [role="dialog"] button:has-text("Explore on my own")').first();
  if (await close.count()) await close.click().catch(() => undefined);
  await page.waitForSelector(surface.ready, { timeout: 20_000 });
  await page.waitForTimeout(surface.heavy ? 2500 : 700);
}
