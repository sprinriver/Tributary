import {
  ImportRunResultSchema,
  ReleasePreviewSchema,
  type ImportRunRequest,
  type ImportRunResult,
  type ReleasePreview,
  type ReleaseStorage,
} from '@tributary/contracts';
import type { ApiConfig } from '../config.ts';
import { HttpError } from '../errors.ts';

/**
 * Calls apps/query's internal routes (shared token). Import problems come back as 422; QuerySpec problems as 400
 * (with the spec field) and timeouts as 408; anything else is a 502.
 */
export async function callQueryService(
  fetchImpl: typeof fetch,
  config: ApiConfig,
  path: string,
  body: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.queryUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': config.queryInternalToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    throw new HttpError(503, 'query_unavailable', 'The query service is not reachable.');
  }
  const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string; field?: string };
  if (res.status === 400 || res.status === 408)
    throw new HttpError(
      res.status,
      json.code ?? 'invalid_query',
      json.message ?? 'Invalid query.',
      json.field,
    );
  if (res.status === 422)
    throw new HttpError(422, json.code ?? 'import_failed', json.message ?? 'Import failed.');
  if (!res.ok) throw new HttpError(502, 'query_failed', `The query service answered HTTP ${res.status}.`);
  return json;
}

export async function runImportJob(
  fetchImpl: typeof fetch,
  config: ApiConfig,
  request: ImportRunRequest,
): Promise<ImportRunResult> {
  return ImportRunResultSchema.parse(await callQueryService(fetchImpl, config, '/internal/imports', request));
}

export async function readRelease(
  fetchImpl: typeof fetch,
  config: ApiConfig,
  storage: ReleaseStorage,
  limit: number,
  orderBy: string[],
): Promise<ReleasePreview> {
  return ReleasePreviewSchema.parse(
    await callQueryService(fetchImpl, config, '/internal/releases/read', {
      storage,
      limit,
      order_by: orderBy,
    }),
  );
}
