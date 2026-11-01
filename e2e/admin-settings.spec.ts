import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-18';

test('ADM-02: admin adds a program and edits the time-point picklist; the new-experiment form offers them', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin', '/admin/programs');
  const code = `E${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const form = admin.getByRole('region', { name: 'New program' });
  await form.getByLabel('Code').fill(code);
  await form.getByLabel('Name').fill(`Programme ${code}`);
  await form.getByLabel('Requires approval to publish').check();
  await form.getByRole('button', { name: 'Create program' }).click();
  await expect(
    admin.getByRole('table', { name: 'Programs' }).getByRole('row', { name: new RegExp(code) }),
  ).toContainText('Approval required');

  await admin.goto('/admin/lists');
  const times = admin.getByRole('region', { name: 'Time points' });
  const value = `${(Date.now() % 90) + 2} h`;
  await times.getByLabel('New value').fill(value);
  await times.getByRole('button', { name: 'Add' }).click();
  await times.getByRole('button', { name: 'Save time points' }).click();
  await expect(times.getByRole('status')).toContainText('Saved');
  await admin.screenshot({ path: `${SHOTS}/admin-lists.png`, fullPage: true });

  const scientist = await (await browser.newContext()).newPage();
  await signIn(scientist, 'scientist', '/experiments/new');
  await expect(scientist.getByLabel('Program').locator('option', { hasText: code })).toHaveCount(1);
  await expect(scientist.locator('datalist#time-point-options option', { hasText: value })).toHaveCount(1);
  await expect(scientist.getByLabel('Species').locator('option', { hasText: 'Homo sapiens' })).toHaveCount(1);
});

test('ADM-02: ontology sources can be switched off and on again', async ({ page }) => {
  await signIn(page, 'admin', '/admin/lists');
  const sources = page.getByRole('region', { name: 'Ontology sources' });
  const efo = sources.getByRole('checkbox', { name: /EFO/ });
  await efo.uncheck();
  await sources.getByRole('button', { name: 'Save sources' }).click();
  await expect(sources.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Ontology sources' }).getByRole('checkbox', { name: /EFO/ }),
  ).not.toBeChecked();
  // Leave the shared stack as it was.
  await page.getByRole('region', { name: 'Ontology sources' }).getByRole('checkbox', { name: /EFO/ }).check();
  await page
    .getByRole('region', { name: 'Ontology sources' })
    .getByRole('button', { name: 'Save sources' })
    .click();
  await expect(page.getByRole('region', { name: 'Ontology sources' }).getByRole('status')).toContainText(
    'Saved',
  );
});

test('ADM-03: group mapping, lifecycle policies and system health', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, 'admin', '/admin/access');
  const mappings = page.getByRole('region', { name: 'Group mappings' });
  const group = `e2e-qa-${Date.now().toString(36)}`;
  await mappings.getByLabel('IdP group').fill(group);
  await mappings.getByLabel('Role').selectOption('viewer');
  await mappings.getByLabel('Programs').fill('ONC');
  await mappings.getByRole('button', { name: 'Add mapping' }).click();
  await mappings.getByRole('button', { name: 'Save mappings' }).click();
  await expect(mappings.getByRole('status')).toContainText('Saved');
  await expect(mappings.getByRole('table', { name: 'Mappings' })).toContainText(group);
  // Leave only the mappings that were there before.
  await mappings.getByRole('button', { name: `Remove ${group}` }).click();
  await mappings.getByRole('button', { name: 'Save mappings' }).click();
  await expect(mappings.getByRole('status')).toContainText('Saved');

  await page.goto('/admin/lifecycle');
  const raw = page.getByRole('group', { name: 'raw files' });
  await expect(raw.getByLabel('Move after (days)')).toHaveValue(/\d+/);
  const before = await raw.getByLabel('Move after (days)').inputValue();
  await raw.getByLabel('Move after (days)').fill('45');
  await page.getByRole('button', { name: 'Save policies' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(page.getByRole('group', { name: 'raw files' }).getByLabel('Move after (days)')).toHaveValue(
    '45',
  );
  await page.getByRole('group', { name: 'raw files' }).getByLabel('Move after (days)').fill(before);
  await page.getByRole('button', { name: 'Save policies' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');

  await page.goto('/admin/health');
  const checks = page.getByRole('table', { name: 'Health checks' });
  for (const name of ['Database', 'Object storage', 'Query service', 'Compute service', 'Identity provider'])
    await expect(checks.getByRole('row', { name: new RegExp(`${name}.*OK`) })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Pipeline runners' })).toContainText('local');
  // The e2e stack runs the assistant with the stub provider (playwright.config.ts).
  await expect(page.getByRole('region', { name: 'AI assistant' })).toContainText('stub · stub-1');
  await page.screenshot({ path: `${SHOTS}/admin-health.png`, fullPage: true });
});
