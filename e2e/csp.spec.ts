import { expect, test, type Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { publishedExperiment } from './data.ts';
import { apiCall, signIn, uniqueName } from './helpers.ts';

/** Records every CSP violation the page reports (the browser fires one event per blocked load or eval). */
async function watchViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction('__cspViolation', (v: string) => seen.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(
        `${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`,
      ),
    );
  });
  return seen;
}

test('SEC-02: the app is served with a Content-Security-Policy and its charts, 3D viewer, structures and uploads work under it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const violations = await watchViolations(page);
  const home = await page.goto('/');
  const csp = home!.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');

  await signIn(page, 'scientist');
  // Plotly (volcano, QC panel, dose-response) and the report.
  const made = await publishedExperiment(page, uniqueName('CSP'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
    { file: 'report.pg_matrix.tsv', importer: 'diann_pg_matrix' },
  ]);
  await page.goto(`/experiments/${made.experiment}/report`);
  await expect(page.getByRole('region', { name: 'QC' }).locator('.js-plotly-plot')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-contrast] .js-plotly-plot')).toBeVisible({ timeout: 60_000 });

  // Structures drawn by RDKit (SVG from the API).
  await page.goto('/compounds/CPD-000001');
  await expect(
    page.getByRole('region', { name: 'Structure' }).getByRole('img', { name: /Structure of CPD-000001/ }),
  ).toBeVisible({ timeout: 30_000 });

  // Mol* (WebGL, workers).
  await page.goto('/proteins/SYNP0053');
  const model = page.getByRole('region', { name: '3D model' });
  await model.getByRole('button', { name: 'Show 3D model' }).click();
  await expect(model.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(model.getByRole('status')).toHaveCount(0, { timeout: 60_000 });

  // A browser upload goes straight to object storage (connect-src).
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const draft = await apiCall<{ id: string }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name: uniqueName('CSP-UP'),
  });
  await page.goto(`/experiments/${draft.body.id}`);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page
    .getByLabel('Choose files')
    .setInputFiles([
      { name: 'reads.fastq.gz', mimeType: 'application/gzip', buffer: gzipSync('@r1\nACGT\n+\nIIII\n') },
    ]);
  await page.getByRole('button', { name: 'Upload 1 file' }).click();
  await expect(
    page
      .getByRole('table', { name: 'Files' })
      .getByRole('row', { name: /reads\.fastq\.gz/ })
      .getByText('QC passed'),
  ).toBeVisible({ timeout: 30_000 });

  expect(violations).toEqual([]);
});
