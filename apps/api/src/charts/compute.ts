import {
  ClusterResultSchema,
  GroupSummaryResultSchema,
  GroupTestResultSchema,
  KdeResultSchema,
  PcaResultSchema,
  type ClusterResult,
  type GroupSummaryResult,
  type GroupTestResult,
} from '@tributary/contracts';
import type { z } from 'zod';
import type { ApiConfig } from '../config.ts';
import { HttpError } from '../errors.ts';
import { dataError } from './errors.ts';

type Body = Record<string, unknown>;
/** apps/compute statistics used by charts (ARCHITECTURE §7); injectable for tests. */
export interface Compute {
  cluster(body: Body): Promise<ClusterResult>;
  kde(body: Body): Promise<z.infer<typeof KdeResultSchema>>;
  groupTest(body: Body): Promise<GroupTestResult>;
  groupSummary(body: Body): Promise<GroupSummaryResult>;
  pca(body: Body): Promise<z.infer<typeof PcaResultSchema>>;
}

/** One apps/compute endpoint; its 422s become field errors on the control the user changes (`fields`). */
export function computeCall(config: ApiConfig, fetchImpl: typeof fetch) {
  return <S extends z.ZodType>(path: string, schema: S, fields: Record<string, string>) =>
    async (body: Body): Promise<z.infer<S>> => {
      let res: Response;
      try {
        res = await fetchImpl(`${config.computeUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        throw new HttpError(503, 'compute_unavailable', 'The compute service is not reachable.');
      }
      const json = (await res.json().catch(() => ({}))) as {
        code?: string;
        field?: string;
        message?: string;
      };
      if (res.status === 422)
        throw dataError(
          json.code ?? 'compute_failed',
          fields[json.field ?? ''] ?? `options.${json.field}`,
          json.message ?? 'The computation failed.',
        );
      if (!res.ok)
        throw new HttpError(502, 'compute_failed', `The compute service answered HTTP ${res.status}.`);
      return schema.parse(json);
    };
}

/** apps/compute's group summary takes at most this many groups per request (GroupSummaryRequest). */
export const GROUPS_PER_CALL = 200;

/** Sends group summaries in batches and merges them in order (a QC panel has one group per protein). */
function batched(one: (body: Body) => Promise<GroupSummaryResult>) {
  return async (body: Body): Promise<GroupSummaryResult> => {
    const groups = body.groups as unknown[];
    if (!Array.isArray(groups) || groups.length <= GROUPS_PER_CALL) return one(body);
    const parts: GroupSummaryResult[] = [];
    for (let i = 0; i < groups.length; i += GROUPS_PER_CALL)
      parts.push(await one({ ...body, groups: groups.slice(i, i + GROUPS_PER_CALL) }));
    // Every version that answered (a redeploy mid-panel is recorded, not hidden).
    const versions = [...new Set(parts.map((p) => p.compute_version))];
    return { groups: parts.flatMap((p) => p.groups), compute_version: versions.join(', ') };
  };
}

/** HTTP client; compute 422s become chart field errors (the control the user changes). */
export function httpCompute(config: ApiConfig, fetchImpl: typeof fetch): Compute {
  const call = computeCall(config, fetchImpl);
  return {
    cluster: call('/stats/cluster', ClusterResultSchema, {
      values: 'encodings.values',
      row_labels: 'encodings.rowLabel',
    }),
    kde: call('/stats/kde', KdeResultSchema, { values: 'encodings.x' }),
    groupTest: call('/stats/group-test', GroupTestResultSchema, { groups: 'options.p_values' }),
    groupSummary: batched(call('/stats/group-summary', GroupSummaryResultSchema, { groups: 'encodings.y' })),
    pca: call('/stats/pca', PcaResultSchema, {
      values: 'encodings.values',
      components: 'options.components',
    }),
  };
}
