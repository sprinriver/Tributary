import { MeResponseSchema, type MeResponse } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { setCsrfToken } from './api.ts';

/** The signed-in user, or null when signed out (401). */
export async function fetchMe(fetchImpl: typeof fetch = fetch): Promise<MeResponse | null> {
  const res = await fetchImpl('/api/v1/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Could not load the current user (HTTP ${res.status})`);
  const me = MeResponseSchema.parse(await res.json());
  setCsrfToken(me.csrf_token);
  return me;
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => fetchMe(), staleTime: 60_000, retry: false });
}

export const loginHref = (returnTo: string) => `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

/** Ends the API session, then leaves through the identity provider's logout page. */
export async function signOut(me: MeResponse): Promise<void> {
  const res = await fetch('/api/v1/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': me.csrf_token ?? '' },
  });
  const body = res.ok ? ((await res.json()) as { logout_url?: string }) : {};
  window.location.assign(body.logout_url ?? '/');
}
