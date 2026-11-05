import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

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

test('OPS-09: every scientist page has no serious or critical accessibility violations', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'scientist');
  // Its own published experiment and release: the suite runs in parallel, so no other test's data is assumed.
  const made = await publishedExperiment(page, uniqueName('A11Y'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  const experiment = made.experiment;
  const release = made.releases[0]!;
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
    '/triage',
    '/qc',
    '/settings/notifications',
    '/compounds/search?q=c1ccccc1&mode=substructure',
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
    '/admin/notifications',
    '/admin/usage',
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
