import type { VersionResults } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql } from 'kysely';
import { notFound } from '../errors.ts';
import { methodsParagraph } from './methods.ts';

const THRESHOLDS = { fc: 1, p: 0.05 };
const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : v);
type Json = Record<string, unknown>;

/** Everything the results page shows for one version (SPEC M8), plus its deterministic methods paragraph. */
export async function versionResults(
  db: Database,
  versionId: string,
): Promise<VersionResults & { program_id: string }> {
  const v = await db
    .selectFrom('experiment_version as v')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select([
      'v.id',
      'v.version_number',
      'v.species',
      'e.id as experiment_id',
      'e.name',
      'e.assay_type',
      'e.program_id',
    ])
    .where('v.id', '=', versionId)
    .where('v.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!v) throw notFound('Version');
  // Latest published release of each dataset of this version.
  const releases = await db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .select([
      'r.id',
      'd.kind',
      'd.name as dataset_name',
      'r.importer',
      'r.source',
      'r.column_stats',
      'r.row_count',
    ])
    .distinctOn('r.dataset_id')
    .where('d.experiment_version_id', '=', versionId)
    .where('r.status', '=', 'published')
    .where('r.deleted_at', 'is', null)
    .where('d.deleted_at', 'is', null)
    .orderBy('r.dataset_id')
    .orderBy('r.release_number', 'desc')
    .execute();
  const contrasts = await db
    .selectFrom('contrast')
    .select(['id', 'label', 'numerator', 'denominator'])
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .orderBy('label')
    .execute();
  const run = await db
    .selectFrom('pipeline_run as r')
    .innerJoin('pipeline_definition as d', 'd.id', 'r.pipeline_definition_id')
    .select(['r.id', 'd.name', 'd.repo', 'd.revision', 'r.runner', 'r.params', 'r.finished_at'])
    .where('r.experiment_version_id', '=', versionId)
    .where('r.status', '=', 'succeeded')
    .where('r.deleted_at', 'is', null)
    .orderBy('r.finished_at', 'desc')
    .executeTakeFirst();
  const files = await db
    .selectFrom('file_object')
    .select(['id', 'name', 'role', 'ingest_status'])
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .orderBy('name')
    .execute();
  const { n } = await db
    .selectFrom('sample')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();

  const rel = releases.map((r) => {
    const source = (r.source ?? {}) as Json;
    const stats = (r.column_stats ?? {}) as Record<string, Json>;
    const adj = stats.adj_method;
    return {
      id: r.id,
      kind: r.kind as VersionResults['releases'][number]['kind'],
      dataset_name: r.dataset_name,
      importer: r.importer,
      tool: typeof source.tool === 'string' ? source.tool : null,
      tool_version: typeof source.tool_version === 'string' ? source.tool_version : null,
      row_count: Number(r.row_count),
      // One adjustment method across the release (min = max of the text column); else not stated.
      adj_method: adj && adj.min === adj.max && typeof adj.min === 'string' ? adj.min : null,
    };
  });
  const species = v.species as { label?: string } | null;
  const runOut = run
    ? {
        id: run.id,
        pipeline_name: run.name,
        pipeline_repo: run.repo,
        revision: run.revision,
        runner: run.runner,
        params: run.params as Record<string, unknown>,
        finished_at: iso(run.finished_at),
      }
    : null;
  const methods = methodsParagraph({
    experiment: { name: v.name, assay_type: v.assay_type, species: species?.label ?? null, sample_count: n },
    run: runOut,
    releases: rel.map((r) => ({
      kind: r.kind,
      importer: r.importer,
      tool: r.tool,
      tool_version: r.tool_version,
      method: null,
      adj_method: r.adj_method,
    })),
    // Written from the stored sides, not the free-text label.
    contrasts: contrasts.map((c) => `${c.numerator} vs ${c.denominator}`),
    thresholds: THRESHOLDS,
  });
  return {
    program_id: v.program_id,
    experiment_id: v.experiment_id,
    experiment_name: v.name,
    version_id: v.id,
    version_number: v.version_number,
    releases: rel.map(({ adj_method: _a, ...r }) => r),
    contrasts,
    run: runOut,
    files,
    thresholds: THRESHOLDS,
    methods,
  };
}
