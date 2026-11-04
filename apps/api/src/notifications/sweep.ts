// Placeholder so the tests compile; the sweep is implemented in the next commit.
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';

export async function sweepNotifications(
  _deps: { db: Database; fetch: typeof fetch; config: ApiConfig },
  _now?: Date,
): Promise<number> {
  return 0;
}
