import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCall, signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-18';
const FIXTURE = resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-05/samples.tsv');

function rows(): Record<string, string>[] {
  const [header, ...lines] = readFileSync(FIXTURE, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
}

/** A DDA experiment (no other test uses that assay type, so template changes stay local to this test). */
async function ddaExperiment(page: Page, name: string) {
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dda',
    name,
  });
  const version = created.body.versions[0]!;
  await apiCall(page, 'PUT', `/v1/versions/${version.id}/samples`, { rows: rows() });
  const detail = await apiCall<{ template_version: string }>(page, 'GET', `/v1/versions/${version.id}`);
  return { experiment: created.body.id, version: version.id, template: detail.body.template_version };
}

test('ADM-01: admin publishes a template version with a required field; published versions keep theirs, new drafts need it', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const scientist = await (await browser.newContext()).newPage();
  await signIn(scientist, 'scientist');
  const before = await ddaExperiment(scientist, uniqueName('TPL-old'));
  expect(
    (await apiCall(scientist, 'POST', `/v1/versions/${before.version}/publish`, { reason: 'ready' })).status,
  ).toBe(200);

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'admin', '/admin/templates');
  await admin.getByLabel('Assay type').selectOption('proteomics_dda');
  const versions = admin.getByRole('table', { name: 'Template versions' });
  await expect(
    versions.getByRole('row', { name: new RegExp(`${before.template.replaceAll('.', '\\.')}.*Published`) }),
  ).toBeVisible();

  const tag = Date.now().toString(36);
  const key = `passage_${tag}`;
  await admin.getByRole('button', { name: 'New version' }).click();
  const editor = admin.getByRole('region', { name: 'New template version' });
  await editor.getByLabel('Key').fill(key);
  await editor.getByLabel('Label').fill(`Passage ${tag}`);
  await editor.getByLabel('Type').selectOption('integer');
  await editor.getByLabel('Required').check();
  await editor.getByRole('button', { name: 'Add field' }).click();
  await expect(editor.getByRole('table', { name: 'Fields' })).toContainText(key);
  await editor.getByRole('button', { name: 'Create draft' }).click();

  const preview = admin.getByRole('region', { name: 'Migration preview' });
  await expect(preview).toContainText(key);
  await expect(preview).toContainText('Newly required');
  await admin.screenshot({ path: `${SHOTS}/template-preview.png`, fullPage: true });
  const next = (await preview.getByTestId('new-version').textContent())!.trim();
  await preview.getByRole('button', { name: 'Publish version' }).click();
  const dialog = admin.getByRole('dialog', { name: `Publish template ${next}` });
  await dialog.getByLabel('Reason').fill('Passage number is now required for DDA');
  await dialog.getByRole('button', { name: 'Publish' }).click();
  await expect(
    versions.getByRole('row', { name: new RegExp(`${next.replaceAll('.', '\\.')}.*Published`) }),
  ).toBeVisible();
  await admin.screenshot({ path: `${SHOTS}/template-published.png`, fullPage: true });

  // Published versions keep their pinned template and stay valid.
  const old = await apiCall<{ status: string; template_version: string }>(
    scientist,
    'GET',
    `/v1/versions/${before.version}`,
  );
  expect(old.body).toMatchObject({ status: 'published', template_version: before.template });
  // New drafts pin the new version and must provide the field.
  const after = await ddaExperiment(scientist, uniqueName('TPL-new'));
  expect(after.template).toBe(next);
  const blocked = await apiCall(scientist, 'POST', `/v1/versions/${after.version}/publish`, {
    reason: 'ready',
  });
  expect(blocked.status).toBe(422);
  expect(JSON.stringify(blocked.body)).toContain(key);
  await scientist.goto(`/experiments/${after.experiment}`);
  await scientist.getByRole('tab', { name: 'Samples' }).click();
  await expect(scientist.getByRole('columnheader', { name: new RegExp(`Passage ${tag}`) })).toBeVisible();
});
