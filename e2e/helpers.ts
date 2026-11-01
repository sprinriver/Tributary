import { expect, type Page } from '@playwright/test';

/** Signs in through the local Keycloak (users from infra/local/keycloak; password = username). */
export async function signIn(
  page: Page,
  user: 'admin' | 'scientist' | 'viewer',
  returnTo = '/',
): Promise<void> {
  await page.goto(`/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel(/username/i).fill(user);
  await page.getByLabel('Password', { exact: true }).fill(user);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.href.includes('/realms/'));
  // The first page after sign-in loads the app and /me while other workers run pipelines; give it time.
  await expect(page.getByRole('button', { name: new RegExp(`${user} dev`, 'i') })).toBeVisible({
    timeout: 15_000,
  });
}

/** Calls the API from the signed-in page (cookie session + CSRF), for setup steps and immutability checks. */
export async function apiCall<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const me = (await (await fetch('/api/v1/auth/me')).json()) as { csrf_token?: string };
      const res = await fetch(`/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': me.csrf_token ?? '',
          'x-change-reason': 'e2e',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
    },
    { method, path, body },
  );
}

export const uniqueName = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
