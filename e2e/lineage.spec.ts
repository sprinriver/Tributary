import { expect, test } from '@playwright/test';
import { demoRun } from './data.ts';
import { apiCall, signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-18';

/** A tiny well-formed mzML (HUPO-PSI mzML 1.1.0 root element), uploaded as the experiment's raw file. */
const MZML = Buffer.from(
  '<?xml version="1.0" encoding="utf-8"?>\n<mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0">\n' +
    '  <run id="run01"/>\n</mzML>\n',
);

const LAYOUT = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};

test('LIN-01: lineage of a pipeline release — raw file → run (pipeline revision) → release → saved chart', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, 'scientist');
  const name = uniqueName('LIN');
  const raw = `${name.replaceAll(' ', '-')}-run01.mzML`;
  const run = await demoRun(page, name, [{ file: raw, buffer: MZML, role: 'raw' }]);
  const detail = await apiCall<{ outputs: { release_id: string | null }[] }>(
    page,
    'GET',
    `/v1/runs/${run.run}`,
  );
  const release = detail.body.outputs.find((o) => o.release_id)!.release_id!;
  const chart = `${name} volcano`;
  const view = await apiCall(page, 'POST', '/v1/views', {
    name: chart,
    visibility: 'private',
    query_spec: { source: { releaseIds: [release] } },
    chart_spec: {
      type: 'volcano',
      data: { source: { releaseIds: [release] } },
      encodings: { x: 'log2_fc', y: 'p_adj', label: 'feature_id' },
      options: {},
      layout: LAYOUT,
    },
  });
  expect(view.status, JSON.stringify(view.body)).toBe(201);

  await page.goto(`/releases/${release}`);
  await page.getByRole('link', { name: 'Lineage' }).click();
  await expect(page).toHaveURL(/\/lineage\/dataset_release\/[0-9a-f-]+/);
  await expect(page.getByRole('figure', { name: /Lineage graph/ })).toBeVisible();
  const nodes = page.getByRole('table', { name: 'Lineage nodes' });
  await expect(nodes).toContainText(raw);
  await expect(nodes).toContainText('pipelines/demo @ local');
  await expect(nodes).toContainText(`${name} v1`);
  await expect(nodes).toContainText(chart);
  await page.screenshot({ path: `${SHOTS}/lineage.png`, fullPage: true });
  // One step upstream reaches the run's output file, not the raw input three steps away.
  await page.getByLabel('Depth').selectOption('1');
  await expect(nodes).not.toContainText(raw);
  await expect(nodes).toContainText(chart);
});
