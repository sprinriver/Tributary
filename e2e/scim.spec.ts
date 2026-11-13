import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-35';

test('SCIM-04: an admin creates a SCIM token, and the identity provider can use it on the shown endpoint', async ({
  page,
}) => {
  await signIn(page, 'admin', '/admin/access');
  const panel = page.getByRole('region', { name: 'SCIM provisioning' });
  await expect(panel).toContainText('/api/scim/v2');
  await panel.getByRole('button', { name: 'Create SCIM token' }).click();
  const shown = panel.getByRole('status');
  await expect(shown).toContainText('trb_');
  const token = (await shown.locator('code').textContent())!.trim();
  await expect(panel.getByRole('table', { name: 'SCIM tokens' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/scim-token.png`, fullPage: true });
  // What an IdP does first: read the service provider configuration with the token.
  const res = await page.request.get('/api/scim/v2/ServiceProviderConfig', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).patch.supported).toBe(true);
  // The same token reads nothing from the regular API.
  expect(
    (await page.request.get('/api/v1/programs', { headers: { authorization: `Bearer ${token}` } })).status(),
  ).toBe(403);
});
