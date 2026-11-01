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

/**
 * A 401 is an answer (signed out) and is never retried; a network error or 5xx right after sign-in is transient,
 * so it is retried a few times rather than showing a signed-in user as signed out.
 */
export const retryMe = (failures: number): boolean => failures < 3;

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => fetchMe(),
    staleTime: 60_000,
    retry: retryMe,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4_000),
  });
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
