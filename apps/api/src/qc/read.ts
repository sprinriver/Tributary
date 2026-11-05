// Cross-experiment QC (Phase 27, QCD-01): which releases are read, and their rows as per-run quantities.
import { QueryResultSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { resolveSource } from '../query/resolve.ts';
import { collectRuns, type Collected } from './runs.ts';

/** Rows read per release (protein groups × runs). A larger release is skipped and listed, never truncated. */
export const MAX_ROWS_PER_RELEASE = 500_000;

export interface QcExperiment {
  experiment_id: string;
  experiment_name: string;
  experiment_date: string | null;
  program_code: string;
  release_id: string;
  version_id: string;
  dataset_name: string;
  importer: string | null;
}

export interface QcRelease extends QcExperiment, Collected {
  /** Manifest plate and condition by sample_key. */
  factors: Map<string, Record<string, string>>;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v));

/** The latest published protein_quant release of each readable experiment's latest published version, newest N. */
export async function latestReleases(
  db: Database,
  readable: string[] | null,
  programId: string | undefined,
  max: number,
): Promise<QcExperiment[]> {
  if (readable?.length === 0) return [];
  let q = db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      'e.id as experiment_id',
      'e.name as experiment_name',
      'v.experiment_date',
      'v.id as version_id',
      'p.code as program_code',
      'r.id as release_id',
      'd.name as dataset_name',
      'r.importer',
      'r.published_at',
      'e.created_at',
    ])
    .distinctOn('e.id')
    .where('d.kind', '=', 'protein_quant')
    .where('r.status', '=', 'published')
    .where('r.deleted_at', 'is', null)
    .where('d.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .where('v.is_latest_published', '=', true);
  if (readable) q = q.where('d.program_id', 'in', readable);
  if (programId) q = q.where('d.program_id', '=', programId);
  const rows = await q.orderBy('e.id').orderBy('r.published_at', 'desc').orderBy('r.id', 'desc').execute();
  // Newest experiments first (experiment date, else creation), then the chosen ones oldest first for the trend.
  const when = (r: (typeof rows)[number]) => iso(r.experiment_date) ?? iso(r.created_at) ?? '';
  return rows
    .sort((a, b) => when(b).localeCompare(when(a)) || b.experiment_id.localeCompare(a.experiment_id))
    .slice(0, max)
    .reverse()
    .map((r) => ({
      experiment_id: r.experiment_id,
      experiment_name: r.experiment_name,
      experiment_date: iso(r.experiment_date),
      program_code: r.program_code,
      release_id: r.release_id,
      version_id: r.version_id,
      dataset_name: r.dataset_name,
      importer: r.importer,
    }));
}

/** One release's runs, or why it was not read (never a partial read). */
export async function readRelease(
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
  exp: QcExperiment,
): Promise<{ release: QcRelease } | { skipped: string }> {
  const source = await resolveSource(deps.db, { releaseIds: [exp.release_id] }, null);
  if (!source) return { skipped: 'release not readable' };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { releaseIds: [exp.release_id] },
        select: [
          'sample_key',
          'instrument_run',
          'protein_group',
          'protein_ids',
          'intensity',
          'log2_intensity',
          'is_imputed',
          'normalisation',
        ],
      },
      source,
      joins: [],
      all_rows: MAX_ROWS_PER_RELEASE,
    }),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    return { skipped: `more than ${MAX_ROWS_PER_RELEASE.toLocaleString('en')} rows` };
  const collected = collectRuns(result.rows);
  const sampleRows = await deps.db
    .selectFrom('sample')
    .select(['sample_key', 'raw', 'position'])
    .where('experiment_version_id', '=', exp.version_id)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .orderBy('sample_key')
    .execute();
  // Runs in manifest order (not necessarily acquisition order); runs without a manifest row go last.
  const order = new Map(sampleRows.map((s, i) => [s.sample_key, i]));
  collected.runs.sort(
    (a, b) =>
      (order.get(a.sample_key) ?? Infinity) - (order.get(b.sample_key) ?? Infinity) ||
      (a.instrument_run ?? '').localeCompare(b.instrument_run ?? ''),
  );
  const factors = new Map<string, Record<string, string>>();
  for (const s of sampleRows) {
    const raw = (s.raw ?? {}) as Record<string, unknown>;
    const pick: Record<string, string> = {};
    for (const key of ['plate', 'condition']) {
      const v = raw[key];
      if (typeof v === 'string' && v.trim()) pick[key] = v.trim();
    }
    factors.set(s.sample_key, pick);
  }
  return { release: { ...exp, ...collected, factors } };
}
