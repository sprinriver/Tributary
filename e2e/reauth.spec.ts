import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCall, signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-18';
const FIXTURE = resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-05/samples.tsv');

test('AUD-02: publishing with an old sign-in asks to confirm identity at the IdP, then publishes', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, 'scientist');
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const name = uniqueName('REAUTH');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name,
  });
  const [header, ...lines] = readFileSync(FIXTURE, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  const rows = lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
  await apiCall(page, 'PUT', `/v1/versions/${created.body.versions[0]!.id}/samples`, { rows });

  // A session older than the allowed age: the API answers reauth_required (simulated once; real check is API-tested).
  let refused = false;
  await page.route('**/api/v1/versions/*/publish', async (route) => {
    if (refused) return route.continue();
    refused = true;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'reauth_required', message: 'Sign in again to publish.' }),
    });
  });

  await page.goto(`/experiments/${created.body.id}`);
  await page.getByRole('button', { name: 'Publish' }).click();
  const publish = page.getByRole('dialog', { name: 'Publish version 1' });
  await publish.getByLabel(/reason/i).fill('Ready for analysis');
  await publish.getByRole('button', { name: 'Publish version' }).click();

  const confirm = page.getByRole('dialog', { name: 'Confirm it’s you' });
  await expect(confirm).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/reauth-dialog.png` });
  await confirm.getByRole('link', { name: 'Sign in again' }).click();

  // The IdP must ask for credentials again even though its own session is still valid.
  await page.waitForURL(/\/realms\//);
  expect(page.url()).toContain('prompt=login');
  expect(page.url()).toContain('max_age=0');
  // Keycloak keeps the user and only asks for the password again.
  await expect(page.getByText('Please re-authenticate to continue')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('scientist');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(new RegExp(`/experiments/${created.body.id}`));

  await page.getByRole('button', { name: 'Publish' }).click();
  await publish.getByLabel(/reason/i).fill('Ready for analysis');
  await publish.getByRole('button', { name: 'Publish version' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
});
