import { HealthStatusSchema, type HealthStatus } from '@tributary/contracts';
import type { StatusTone } from '@tributary/ui';

export async function fetchApiHealth(fetchImpl: typeof fetch = fetch): Promise<HealthStatus> {
  const res = await fetchImpl('/api/healthz');
  if (!res.ok) throw new Error(`API health check failed with HTTP ${res.status}`);
  return HealthStatusSchema.parse(await res.json());
}

export type HealthQueryState =
  { state: 'pending' } | { state: 'error' } | { state: 'success'; health: HealthStatus };

/** What the home page shows for the API health query. */
export function describeHealth(query: HealthQueryState): { label: string; tone: StatusTone } {
  switch (query.state) {
    case 'pending':
      return { label: 'API: checking…', tone: 'pending' };
    case 'error':
      return { label: 'API: unreachable', tone: 'error' };
    case 'success':
      return {
        label: `API: ${query.health.status}`,
        tone: query.health.status === 'ok' ? 'ok' : query.health.status === 'degraded' ? 'warning' : 'error',
      };
  }
}
