import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, signIn } from './helpers.ts';

// Phase 22 accessibility pass (SPEC §9: WCAG 2.2 AA for forms, tables and navigation). Every page of the app,
// with seeded data (`pnpm db:seed`); the list and form pages of the registry are also covered by REG-07.
const SHOTS = 'artifacts/phase-22';

async function expectNoSeriousViolations(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('main')).toBeVisible();
  // Let data-driven content (grids, charts) render before scanning.
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  return serious.map((v) => `${path}: ${v.id} — ${v.help} (${v.nodes.length})`);
}

type Item = { id: string; latest_release?: { id: string } | null; experiment_id?: string };

test('OPS-09: every scientist page has no serious or critical accessibility violations', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'scientist');
  const experiments = await apiCall<{ items: Item[] }>(page, 'GET', '/v1/experiments');
  const datasets = await apiCall<{ items: Item[] }>(page, 'GET', '/v1/datasets');
  const experiment = experiments.body.items[0]!.id;
  const release = datasets.body.items.find((d) => d.latest_release)!.latest_release!.id;
  const paths = [
    '/',
    `/experiments/${experiment}`,
    `/experiments/${experiment}/results`,
    '/datasets',
    `/releases/${release}`,
    '/explore',
    '/views',
    '/compare',
    '/search?q=kinase',
    '/proteins/P31749',
    '/compounds/CPD-000005',
    `/lineage/release/${release}`,
  ];
  const found: string[] = [];
  for (const path of paths) found.push(...(await expectNoSeriousViolations(page, path)));
  await page.goto('/explore');
  await page.screenshot({ path: `${SHOTS}/a11y-explorer.png`, fullPage: true });
  expect(found).toEqual([]);
});

test('OPS-09: every admin page has no serious or critical accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'admin');
  const found: string[] = [];
  for (const path of [
    '/admin/programs',
    '/admin/lists',
    '/admin/access',
    '/admin/lifecycle',
    '/admin/health',
    '/admin/templates',
    '/admin/pipelines',
    '/admin/audit',
  ])
    found.push(...(await expectNoSeriousViolations(page, path)));
  expect(found).toEqual([]);
});
