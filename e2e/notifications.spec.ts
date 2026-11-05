import { expect, test } from '@playwright/test';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-31';

test('NOTIF-04: an admin adds a Slack channel, sends a test message and sees the delivery', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/notifications');
  await expect(page.getByRole('heading', { name: 'Team notifications' })).toBeVisible();
  const name = uniqueName('Lab channel');
  const add = page.getByRole('region', { name: 'Add a channel' });
  await add.getByLabel('Name').fill(name);
  await add
    .getByLabel('Incoming webhook URL')
    .fill('https://hooks.slack.com/services/T000/B000/e2e-not-a-real-token');
  await add.getByLabel('Triage decision').check();
  await add.getByRole('button', { name: 'Add channel' }).click();
  const card = page.getByRole('region', { name: `Channel ${name}` });
  await expect(card).toContainText('https://hooks.slack.com/…');
  await expect(card).not.toContainText('e2e-not-a-real-token'); // the secret is never shown again
  await card.getByRole('button', { name: 'Send test' }).click();
  // No real channel exists here: the outcome is reported either way.
  await expect(card.getByRole('status')).toContainText(/Test message (delivered|failed)/, {
    timeout: 30_000,
  });
  await expect(card.getByRole('table', { name: `Deliveries of ${name}` })).toContainText(
    'Tributary test message',
  );
  await page.screenshot({ path: `${SHOTS}/notifications.png`, fullPage: true });
  await card.getByRole('button', { name: 'Pause' }).click();
  await expect(card).toContainText('paused');
});
