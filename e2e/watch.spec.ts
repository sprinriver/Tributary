import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-26';

test('WAT-03: watch a protein, publish a release with a hit for it, see and clear the alert', async ({
  page,
}) => {
  test.setTimeout(150_000);
  // SYNP0053 is the strongest hit of the demo topTable.
  await signIn(page, 'scientist', '/proteins/SYNP0053');
  const watch = page.getByRole('button', { name: /^(Watch|Watching)/ });
  if ((await watch.textContent())?.startsWith('Watch ')) await watch.click();
  await expect(page.getByRole('button', { name: /^Watching/ })).toBeVisible();

  await publishedExperiment(page, uniqueName('WAT'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  await page.goto('/');
  const menu = page.getByRole('button', { name: /^Alerts/ });
  await expect(menu).toContainText(/new/, { timeout: 20_000 });
  await menu.click();
  const alerts = page.getByRole('region', { name: 'Alerts' });
  await expect(alerts.getByRole('listitem').first()).toContainText('SYNP0053');
  await expect(alerts).toContainText(/adjusted p ≤ 0\.05/);
  await page.screenshot({ path: `${SHOTS}/alerts.png`, fullPage: true });
  await alerts.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: /^Alerts/ })).not.toContainText(/new/);
});
