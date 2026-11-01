import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-19';

// The e2e stack runs the API with AI_PROVIDER=stub (deterministic; no model calls).
test('AI-03: the assistant answers through tools, shows each call, and opens a built query in the Explorer', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page, 'scientist');
  await page.getByRole('button', { name: 'Assistant' }).click();
  const panel = page.getByRole('complementary', { name: 'Assistant' });
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox', { name: 'Ask the assistant' }).fill('Find experiments with HEK293');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByRole('article', { name: /search_experiments/ })).toBeVisible();
  await expect(panel.getByRole('log')).toContainText('IMM-DIA-04');
  await page.screenshot({ path: `${SHOTS}/assistant-search.png` });

  // A data question becomes a validated QuerySpec, shown and openable in the Explorer.
  const releases = await page.evaluate(async () => {
    const res = await fetch('/api/v1/datasets?kind=differential_abundance');
    return (await res.json()) as { items: { latest_release: { id: string; status: string } | null }[] };
  });
  const release = releases.items.find((d) => d.latest_release?.status === 'published')?.latest_release?.id;
  test.skip(!release, 'no published differential abundance release in this stack');
  await panel
    .getByRole('textbox', { name: 'Ask the assistant' })
    .fill(`Show the first rows of release ${release}`);
  await panel.getByRole('button', { name: 'Send' }).click();
  const card = panel.getByRole('article', { name: /build_query/ });
  await expect(card).toContainText('releaseIds');
  await expect(panel.getByRole('article', { name: /run_query/ })).toContainText('rows');
  await page.screenshot({ path: `${SHOTS}/assistant-query.png` });
  await card.getByRole('link', { name: 'Open in Explorer' }).click();
  await expect(page).toHaveURL(/\/explore\?q=/);
  await expect(page.getByRole('grid')).toBeVisible();
});
