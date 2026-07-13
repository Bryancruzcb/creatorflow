import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const realManifest = path.resolve('public/assets/creatorflow-real-assets-manifest.json');

async function openProjectMenu(page: Page) {
  const switcher = page.getByRole('button', { name: /Switch project\. Current dataset:/ });
  await switcher.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Project datasets' })).toBeVisible();
}

async function chooseManifest(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Import scanner manifest|Replace imported scanner manifest/ }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(file);
}

test('imports a real scanner manifest, isolates sample data, and preserves it after a bad replacement', async ({ page }) => {
  const mutationRequests: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutationRequests.push(`${request.method()} ${request.url()}`);
  });

  await page.goto('/#workspace?view=overview');
  await openProjectMenu(page);
  await chooseManifest(page, realManifest);

  await expect(page.getByText('CreatorFlow-Real-Asset-Pack / 0.1.0')).toBeVisible();
  await expect(page.getByLabel('Active dataset: imported scanner snapshot')).toBeVisible();
  await expect(page.getByText('Creative asset payloads were not imported.')).toBeVisible();

  await page.getByRole('button', { name: 'Open Evidence' }).click();
  await expect(page.getByRole('heading', { name: 'Scanner records, without authored filler' })).toBeVisible();
  await expect(page.getByText('32 of 32 records')).toBeVisible();
  await expect(page.getByText('Mira Chen')).toHaveCount(0);

  await openProjectMenu(page);
  await chooseManifest(page, {
    name: 'broken-replacement.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"$schema":"creatorflow.manifest/v0.1","assets":[]}'),
  });
  await expect(page.getByRole('alert')).toContainText('Replacement rejected — current project preserved');
  await expect(page.getByLabel('Active dataset: imported scanner snapshot')).toBeVisible();
  await expect(page.getByText('32 of 32 records')).toBeVisible();

  await openProjectMenu(page);
  await page.getByRole('menuitem', { name: /Northwind/ }).click();
  await expect(page.getByLabel('Active dataset: sample scenario')).toBeVisible();
  expect(mutationRequests).toEqual([]);
});

test('paginates imported evidence at 100 records and filters without rendering the full manifest', async ({ page }) => {
  const assets = Array.from({ length: 101 }, (_, index) => ({
    path: `assets/item-${String(index).padStart(3, '0')}.png`,
    fileName: `item-${String(index).padStart(3, '0')}.png`,
    fileType: 'png',
    sizeBytes: index + 1,
    sha256: index.toString(16).padStart(64, '0'),
    width: 16,
    height: 16,
    fingerprints: { dHash: null, pHash: null, audio: null },
    verification: 'CLEAR',
    source: { source: null, license: null, evidenceUrl: null },
    decision: 'PENDING',
    matches: [],
    findings: [],
  }));
  const manifest = {
    $schema: 'creatorflow.manifest/v0.1',
    project: { name: 'Pagination fixture', release: '1.0.0' },
    generatedAt: '2026-07-12T21:00:00Z',
    summary: { total: 101, clear: 101, similar: 0, duplicate: 0, unresolvedSources: 101, pendingDecisions: 101 },
    assets,
  };

  await page.goto('/#workspace?view=overview');
  await openProjectMenu(page);
  await chooseManifest(page, {
    name: 'pagination.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(manifest)),
  });
  await page.getByRole('button', { name: 'Open Evidence' }).click();

  await expect(page.getByText('101 of 101 records')).toBeVisible();
  await expect(page.getByText('Page 1 of 2 · 100 records per page')).toBeVisible();
  await expect(page.locator('.imported-ledger tbody tr')).toHaveCount(100);

  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByText('Page 2 of 2 · 100 records per page')).toBeVisible();
  await expect(page.locator('.imported-ledger tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /item-100\.png/ })).toBeVisible();

  await page.getByRole('textbox', { name: 'Search imported records' }).fill('item-100');
  await expect(page.getByText('1 of 101 records')).toBeVisible();
  await expect(page.getByText('Page 1 of 1 · 100 records per page')).toBeVisible();
});
