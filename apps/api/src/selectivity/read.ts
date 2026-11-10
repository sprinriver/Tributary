// Compound selectivity (Phase 42, SEL-02): which readable profiling experiments have curves for a compound, and the
// curves of the chosen one. A partial read is refused, never profiled.
import { QueryResultSchema, type SelectivityResponse } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';
import type { CurveRow, KnownRole } from './profile.ts';

/** Curves read for the experiments list (all releases) and for one experiment. */
const MAX_ROWS = 500_000;

type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };
type Experiment = SelectivityResponse['experiments'][number];

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v));

async function query(deps: Deps, releaseIds: string[], compoundId: string, select: string[]) {
  const source = await resolveSource(deps.db, { releaseIds }, null);
  if (!source) return null;
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { releaseIds },
        select,
        where: { combinator: 'and', rules: [{ field: 'compound_id', operator: '=', value: compoundId }] },
      },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    throw new HttpError(
      422,
      'too_many_rows',
      `More than ${MAX_ROWS.toLocaleString('en')} curves for this compound: choose one experiment.`,
      'version_id',
    );
  return result.rows;
}

/** Readable experiments (latest published version, latest published dose-response release) profiling the compound. */
export async function profilingExperiments(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
): Promise<Experiment[]> {
  if (readable?.length === 0) return [];
  let q = deps.db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      'r.id as release_id',
      'v.id as version_id',
      'e.id as experiment_id',
      'e.name as experiment_name',
      'v.experiment_date',
      'p.code as program_code',
      'r.published_at',
      'e.created_at',
    ])
    .distinctOn('d.id')
    .where('d.kind', '=', 'dose_response')
    .where('r.status', '=', 'published')
    .where('r.deleted_at', 'is', null)
    .where('d.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .where('v.is_latest_published', '=', true);
  if (readable) q = q.where('d.program_id', 'in', readable);
  const releases = await q
    .orderBy('d.id')
    .orderBy('r.published_at', 'desc')
    .orderBy('r.id', 'desc')
    .execute();
  if (releases.length === 0) return [];
  const rows =
    (await query(
      deps,
      releases.map((r) => r.release_id),
      compoundId,
      ['experiment_version_id', 'method'],
    )) ?? [];
  const methods = new Map<string, string | null>();
  for (const r of rows)
    methods.set(String(r.experiment_version_id), r.method == null ? null : String(r.method));
  // Newest first: experiment date, else creation.
  const when = (r: (typeof releases)[number]) => iso(r.experiment_date) ?? iso(r.created_at) ?? '';
  return releases
    .filter((r) => methods.has(r.version_id))
    .sort((a, b) => when(b).localeCompare(when(a)) || b.version_id.localeCompare(a.version_id))
    .map((r) => ({
      version_id: r.version_id,
      experiment_id: r.experiment_id,
      experiment_name: r.experiment_name,
      experiment_date: iso(r.experiment_date),
      program_code: r.program_code,
      release_id: r.release_id,
      method: methods.get(r.version_id) ?? null,
    }));
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** The compound's curves in one release. */
export async function curvesOf(deps: Deps, releaseId: string, compoundId: string): Promise<CurveRow[]> {
  const rows =
    (await query(deps, [releaseId], compoundId, [
      'feature_id',
      'protein_ids',
      'gene_names',
      'pec50',
      'regulation',
      'fdr',
    ])) ?? [];
  return rows.map((r) => ({
    feature_id: String(r.feature_id),
    protein_ids: r.protein_ids,
    gene_names: r.gene_names,
    pec50: num(r.pec50),
    regulation: String(r.regulation ?? ''),
    fdr: num(r.fdr),
  }));
}

/**
 * Annotated targets of the compound, by UniProt accession without isoform suffix: the readable target-annotation
 * reference datasets (primary_target / off_target rows whose value is the compound), as the compound page's Targets
 * table and the volcano's known-target overlay read them.
 */
export async function knownTargets(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
): Promise<Map<string, KnownRole>> {
  const out = new Map<string, KnownRole>();
  const source = await resolveSource(deps.db, { kind: 'target_annotation', scope: {} }, readable);
  if (!source || ('releases' in source && source.releases.length === 0)) return out;
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { kind: 'target_annotation', scope: {} },
        select: ['uniprot_accession', 'key'],
        where: {
          combinator: 'and',
          rules: [
            { field: 'key', operator: 'in', value: ['primary_target', 'off_target'] },
            { field: 'value', operator: '=', value: compoundId },
          ],
        },
      },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  for (const r of result.rows) {
    const id = String(r.uniprot_accession ?? '')
      .trim()
      .replace(/-\d+$/, '');
    if (!id) continue;
    // A protein annotated both ways counts as a primary target.
    if (out.get(id) !== 'primary_target') out.set(id, r.key as KnownRole);
  }
  return out;
}
