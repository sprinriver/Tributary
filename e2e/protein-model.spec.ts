import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-29';

// SYNP0053 has a synthetic demo model in fixtures/structures (the dev default model directory).
test('STRUC-03: open the 3D model on a protein page, coloured by pLDDT, with its source', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, 'scientist', '/proteins/SYNP0053');
  const panel = page.getByRole('region', { name: '3D model' });
  await expect(panel).toContainText('Predicted model from Local model directory');
  await expect(panel.getByRole('note')).toContainText('Synthetic demo model');
  await panel.getByRole('button', { name: 'Show 3D model' }).click();
  const viewer = panel.getByRole('img', { name: '3D model of SYNP0053' });
  await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole('status')).toHaveCount(0, { timeout: 60_000 }); // loaded
  await expect(panel.getByRole('list', { name: 'pLDDT colour key' })).toContainText('Very high (> 90)');
  await page.waitForTimeout(1500); // let WebGL draw a frame for the screenshot
  await page.screenshot({ path: `${SHOTS}/protein-3d-model.png`, fullPage: true });
});
