import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-52';
const ADMIN_PAGES = [
  '/admin/access',
  '/admin/programs',
  '/admin/lists',
  '/admin/usage',
  '/admin/audit',
  '/admin/templates',
  '/admin/pipelines',
];

test('AUTH-03: a contributor opening an admin page sees Access denied and no admin data is requested', async ({
  page,
}) => {
  await signIn(page, 'scientist');
  const adminCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/v1\/(admin|audit)/.test(r.url())) adminCalls.push(r.url());
  });
  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await expect(page.getByText(/system administrators/i)).toBeVisible();
  }
  expect(adminCalls).toEqual([]);
  await page.goto('/admin/access');
  await page.screenshot({ path: `${SHOTS}/contributor-admin-denied.png` });
});

test('AUTH-03: a viewer sees no New experiment or Create version on the experiments list; a contributor does', async ({
  page,
  browser,
}) => {
  await signIn(page, 'viewer');
  // Filter by name: other specs add experiments, so the seeded one need not be on the first page.
  await page.goto('/experiments?name=ONC-DIA-05');
  await expect(page.getByRole('row', { name: /ONC-DIA-05/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New experiment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create version' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/viewer-list.png` });

  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const scientist = await ctx.newPage();
  await signIn(scientist, 'scientist');
  await scientist.goto('/experiments?name=ONC-DIA-05');
  await expect(scientist.getByRole('row', { name: /ONC-DIA-05/ })).toBeVisible();
  await expect(scientist.getByRole('link', { name: 'New experiment' })).toBeVisible();
  await expect(
    scientist.getByRole('row', { name: /ONC-DIA-05/ }).getByRole('button', { name: 'Create version' }),
  ).toBeVisible();
  await ctx.close();
});

test('AUTH-03: a system admin still opens the admin pages', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/admin/access');
  await expect(page.getByRole('heading', { name: 'Access', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Access denied' })).toHaveCount(0);
});
