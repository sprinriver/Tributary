import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

test('SUP-02: an admin downloads the support bundle from the health page', async ({ page }, info) => {
  await signIn(page, 'admin', '/admin/health');
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download support bundle' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^tributary-support-\d{4}-\d{2}-\d{2}\.json$/);
  const path = info.outputPath('bundle.json');
  await download.saveAs(path);
  const text = readFileSync(path, 'utf8');
  const bundle = JSON.parse(text) as {
    instance: { version: string };
    database: { migrations_pending: string[] };
  };
  expect(bundle.instance.version).toBe('2.1.0-dev');
  expect(bundle.database.migrations_pending).toEqual([]);
  expect(text).not.toMatch(/@example\.test/); // no email addresses
});
