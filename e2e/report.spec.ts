import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-33';

test('REP-03: open the report from the results page and download it as PowerPoint', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('REP'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  await page.getByRole('link', { name: /Report \(PDF or PowerPoint\)/ }).click();
  await expect(page).toHaveURL(/\/report/);
  const contrast = page.getByRole('region', { name: /^Contrast / });
  await expect(contrast).toContainText(/\d+ up and \d+ down at \|log2 FC\| ≥ 1 and adjusted p ≤ 0.05/, {
    timeout: 30_000,
  });
  await expect(contrast.locator('.js-plotly-plot')).toBeVisible({ timeout: 30_000 });
  await expect(contrast.getByRole('table', { name: /^Top hits/ }).getByRole('row')).toHaveCount(11);
  await expect(page.getByRole('region', { name: 'Methods' })).toContainText('log2');
  await page.screenshot({ path: `${SHOTS}/report.png`, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidebar-rail')).toBeHidden(); // the app frame is not printed
  await page.screenshot({ path: `${SHOTS}/report-print.png`, fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Download PowerPoint' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/report\.pptx$/);
  const path = info.outputPath('report.pptx');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip (Office Open XML)
  expect(bytes.includes(Buffer.from('ppt/slides/slide4.xml'))).toBe(true); // title, methods, contrast, top hits
  expect(bytes.includes(Buffer.from('ppt/media/'))).toBe(true); // the volcano image
});
