import { expect, test } from '@playwright/test';
import { apiCall, signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-19';

// The e2e stack runs the API with AI_PROVIDER=stub. Write tools are switched on by an admin first.
test('AI-04: a write proposed by the assistant waits for Approve, then runs as the user', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, 'admin');
  await adminPage.goto('/admin/health');
  const ai = adminPage.getByRole('region', { name: 'AI assistant' });
  const writes = ai.getByRole('checkbox', { name: /Allow write tools/ });
  if (!(await writes.isChecked())) {
    await writes.check();
    await ai.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(ai.getByRole('status')).toContainText('Saved');
  }
  await adminContext.close();

  await signIn(page, 'scientist');
  const releases = await page.evaluate(async () => {
    const res = await fetch('/api/v1/datasets?kind=differential_abundance');
    return (await res.json()) as { items: { latest_release: { id: string; status: string } | null }[] };
  });
  const release = releases.items.find((d) => d.latest_release?.status === 'published')?.latest_release?.id;
  test.skip(!release, 'no published differential abundance release in this stack');
  const name = `Assistant view ${Date.now()}`;

  await page.getByRole('button', { name: 'Assistant' }).click();
  const panel = page.getByRole('complementary', { name: 'Assistant' });
  await panel
    .getByRole('textbox', { name: 'Ask the assistant' })
    .fill(`Save a view of release ${release} named ${name}`);
  await panel.getByRole('button', { name: 'Send' }).click();
  const card = panel.getByRole('article', { name: /create_saved_view/ });
  await expect(card).toContainText('Waiting for your approval');
  await page.screenshot({ path: `${SHOTS}/assistant-approval.png` });
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toContainText('ran');

  await page.goto('/views');
  await expect(page.getByText(name)).toBeVisible();
});

test('AI-04: the manifest editor suggests ontology terms and applies only the accepted ones', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'scientist');
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name: uniqueName('CUR'),
  });
  const base = { organism: 'Homo sapiens', compound_id: 'vehicle', dose: 'not applicable', time: '24 h' };
  await apiCall(page, 'PUT', `/v1/versions/${created.body.versions[0]!.id}/samples`, {
    rows: [
      { ...base, sample_key: 'S1', source_name: 's1', cell_line: 'hela cells', raw_file: 'r1.raw' },
      { ...base, sample_key: 'S2', source_name: 's2', cell_line: 'mcf7', raw_file: 'r2.raw' },
      { ...base, sample_key: 'S3', source_name: 's3', cell_line: 'zebrafish fin', raw_file: 'r3.raw' },
    ],
  });
  await page.goto(`/experiments/${created.body.id}`);
  await page.getByRole('tab', { name: 'Samples' }).click();
  await expect(page.getByRole('grid')).toBeVisible();

  // Every free-text value gets a lookup; only the accepted suggestion is applied.
  await page.getByRole('button', { name: 'Suggest ontology terms' }).click();
  const suggest = page.getByRole('dialog', { name: 'Suggested ontology terms' });
  await expect(suggest.getByRole('row', { name: /hela cells.*HeLa/ })).toBeVisible();
  await expect(suggest.getByRole('row', { name: /mcf7.*MCF-7/ })).toBeVisible();
  await expect(suggest.getByRole('row', { name: /zebrafish fin.*No match/ })).toBeVisible();
  await suggest.getByRole('checkbox', { name: 'Accept HeLa for hela cells' }).check();
  await page.screenshot({ path: `${SHOTS}/curation-suggestions.png` });
  await suggest.getByRole('button', { name: 'Apply accepted' }).click();
  const cellLine = (key: string) =>
    page.locator('.ag-row', { hasText: key }).locator('.ag-cell[col-id="cell_line"]');
  await expect(cellLine('S1')).toHaveText('HeLa');
  await expect(cellLine('S2')).toHaveText('mcf7');
});
