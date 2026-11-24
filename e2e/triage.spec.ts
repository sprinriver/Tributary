import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-25';

test('TRI-04: add a protein to the triage board, decide with a reason, comment — all from the keyboard-friendly board', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'scientist', '/proteins/P31749');
  const add = page.getByRole('region', { name: 'Triage' });
  await add.getByLabel('Program').selectOption({ label: 'ONC' });
  await add.getByRole('button', { name: 'Add to triage' }).click();
  await add.getByRole('link', { name: 'Open on the triage board' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Triage board' })).toBeVisible();
  const item = page.getByRole('region', { name: /^Triage item P31749/ });
  await expect(item).toBeVisible();
  // Pick a decision different from the current one (the board keeps state between runs).
  const current = await item.getByLabel('Decision').inputValue();
  const next = current === 'advance' ? 'watch' : 'advance';
  await item.getByLabel('Decision').selectOption(next);
  await expect(item.getByRole('button', { name: 'Save decision' })).toBeDisabled(); // a reason is required
  await item.getByLabel('Reason').fill('Consistent across two experiments');
  await item.getByRole('button', { name: 'Save decision' }).click();
  const column = page.getByRole('region', {
    name: new RegExp(`^${next === 'advance' ? 'Advance' : 'Watch'} \\(`),
  });
  await expect(column.getByRole('button', { name: /P31749/ })).toBeVisible();
  const history = item.getByRole('list', { name: 'History' });
  await expect(history).toContainText(`${current} → ${next}`);
  await expect(history).toContainText('Consistent across two experiments');

  await item.getByLabel('Comment').fill('Orthogonal assay booked');
  await item.getByRole('button', { name: 'Add comment' }).click();
  await expect(history).toContainText('Orthogonal assay booked');
  await page.screenshot({ path: `${SHOTS}/triage-board.png`, fullPage: true });
});
