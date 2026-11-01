import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { publishedExperiment } from './data.ts';
import { apiCall, signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-18';

test('AUD-02: release history shows the publish with reason and approver; admin filters and exports the audit log', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const scientist = await (await browser.newContext()).newPage();
  await signIn(scientist, 'scientist');
  const name = uniqueName('AUD');
  const made = await publishedExperiment(scientist, name, [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true, publish: false },
  ]);
  const release = made.releases[0]!;

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin', `/releases/${release}`);
  const reason = `Approved for analysis ${name}`;
  expect((await apiCall(admin, 'POST', `/v1/releases/${release}/publish`, { reason })).status).toBe(200);

  await scientist.goto(`/releases/${release}`);
  const history = scientist.getByRole('region', { name: 'History' });
  const publish = history.getByRole('row', { name: /release\.publish/ });
  await expect(publish).toContainText(reason);
  await expect(publish).toContainText('Admin Dev');
  await scientist.screenshot({ path: `${SHOTS}/release-history.png`, fullPage: true });

  await admin.goto('/admin/audit');
  await admin.getByLabel('Action').fill('release.publish');
  await admin.getByLabel('Entity id').fill(release);
  await admin.getByRole('button', { name: 'Apply' }).click();
  const log = admin.getByRole('table', { name: 'Audit log' });
  await expect(log.getByRole('row', { name: new RegExp(reason) })).toBeVisible();
  await expect(log.getByRole('row')).toHaveCount(2); // header + the one publish
  await admin.screenshot({ path: `${SHOTS}/audit-log.png`, fullPage: true });
  const download = admin.waitForEvent('download');
  await admin.getByRole('link', { name: 'Export CSV' }).click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  expect(csv.split('\n')[0]).toBe('at,actor,actor_type,action,entity_type,entity_id,reason,request_id');
  expect(csv).toContain(reason);
});
