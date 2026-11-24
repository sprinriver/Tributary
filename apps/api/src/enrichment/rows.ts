// One contrast's differential-abundance rows (Phase 24; shared with interaction networks, Phase 45). Only the chosen
// contrast is read (filtered in the query), and a partial read is an error, never a result.
import { QueryResultSchema, type ResolvedSource } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError } from '../errors.ts';
import type { DaRow } from './select.ts';

/** More rows than this for one contrast is refused rather than read partly. */
export const MAX_ROWS = 500_000;

export async function readContrastRows(
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
  source: ResolvedSource,
  releaseId: string,
  contrastLabel: string | undefined,
): Promise<{ rows: DaRow[]; label: string }> {
  const internal = {
    spec: {
      source: { releaseIds: [releaseId] },
      select: ['contrast_label', 'gene_names', 'protein_ids', 'log2_fc', 'adj_p_value', 'adj_method'],
      ...(contrastLabel !== undefined
        ? {
            where: {
              combinator: 'and',
              rules: [{ field: 'contrast_label', operator: '=', value: contrastLabel }],
            },
          }
        : {}),
    },
    source,
    joins: [],
    all_rows: MAX_ROWS,
  };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', internal),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    throw new HttpError(
      422,
      'too_many_rows',
      `More than ${MAX_ROWS} rows: choose one contrast.`,
      'contrast_label',
    );
  const rows = result.rows as DaRow[];
  const labels = [...new Set(rows.map((r) => r.contrast_label ?? ''))];
  if (labels.length > 1)
    throw new HttpError(
      422,
      'contrast_required',
      `This release has ${labels.length} contrasts: choose one.`,
      'contrast_label',
    );
  const label = contrastLabel ?? labels[0] ?? '';
  if (rows.length === 0)
    throw new HttpError(422, 'unknown_contrast', `No rows for contrast "${label}".`, 'contrast_label');
  return { rows, label };
}
