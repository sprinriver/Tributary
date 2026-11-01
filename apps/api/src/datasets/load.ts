import {
  DATASET_CONTRACTS,
  ReleaseSourceSchema,
  ReleaseStorageSchema,
  type DatasetKind,
  type DatasetSummary,
  type ReleaseDetail,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { notFound } from '../errors.ts';

const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : v);

const RELEASE_COLUMNS = [
  'r.id',
  'r.dataset_id',
  'r.release_number',
  'r.status',
  'r.row_count',
  'r.importer',
  'r.created_at',
  'r.published_at',
] as const;

type ReleaseRow = {
  id: string;
  dataset_id: string;
  release_number: number;
  status: string;
  row_count: number | string;
  importer: string | null;
  created_at: Date | string;
  published_at: Date | string | null;
};

export const releaseSummary = (r: ReleaseRow) => ({
  id: r.id,
  dataset_id: r.dataset_id,
  release_number: r.release_number,
  status: r.status as 'staged' | 'published' | 'rejected',
  row_count: Number(r.row_count),
  importer: r.importer,
  created_at: iso(r.created_at)!,
  published_at: iso(r.published_at),
});

function datasetBase(db: Database) {
  return db
    .selectFrom('dataset as d')
    .innerJoin('program as p', 'p.id', 'd.program_id')
    .leftJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .leftJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select([
      'd.id',
      'd.name',
      'd.kind',
      'd.program_id',
      'p.code as program_code',
      'd.experiment_version_id',
      'v.experiment_id',
      'e.name as experiment_name',
      'v.version_number',
      'd.created_at',
    ])
    .where('d.deleted_at', 'is', null);
}

export interface DatasetFilter {
  kind?: string | undefined;
  program_id?: string | undefined;
  experiment_version_id?: string | undefined;
  q?: string | undefined;
}

/** Catalog rows with their latest release, scoped to `programs` (null = every program). */
export async function listDatasets(
  db: Database,
  filter: DatasetFilter,
  programs: string[] | null,
): Promise<DatasetSummary[]> {
  if (programs && !programs.length) return [];
  let query = datasetBase(db);
  if (programs) query = query.where('d.program_id', 'in', programs);
  if (filter.kind) query = query.where('d.kind', '=', filter.kind);
  if (filter.program_id) query = query.where('d.program_id', '=', filter.program_id);
  if (filter.experiment_version_id)
    query = query.where('d.experiment_version_id', '=', filter.experiment_version_id);
  if (filter.q) {
    const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    query = query.where((eb) => eb.or([eb('d.name', 'ilike', like), eb('e.name', 'ilike', like)]));
  }
  const datasets = await query.orderBy('d.created_at', 'desc').orderBy('d.id', 'desc').limit(500).execute();
  if (!datasets.length) return [];
  const releases = await db
    .selectFrom('dataset_release as r')
    .select(RELEASE_COLUMNS)
    .where(
      'r.dataset_id',
      'in',
      datasets.map((d) => d.id),
    )
    .where('r.deleted_at', 'is', null)
    .orderBy('r.release_number', 'desc')
    .execute();
  return datasets.map((d) => {
    const own = releases.filter((r) => r.dataset_id === d.id);
    return datasetSummary(d, own);
  });
}

function datasetSummary(
  d: Awaited<ReturnType<ReturnType<typeof datasetBase>['executeTakeFirstOrThrow']>>,
  releases: ReleaseRow[],
): DatasetSummary {
  const kind = d.kind as DatasetKind;
  return {
    id: d.id,
    name: d.name,
    kind,
    category: DATASET_CONTRACTS[kind].category,
    program_id: d.program_id,
    program_code: d.program_code,
    experiment_version_id: d.experiment_version_id,
    experiment_id: d.experiment_id,
    experiment_name: d.experiment_name,
    version_number: d.version_number,
    release_count: releases.length,
    latest_release: releases[0] ? releaseSummary(releases[0]) : null,
    created_at: iso(d.created_at)!,
  };
}

export async function loadDataset(db: Database, id: string) {
  const d = await datasetBase(db).where('d.id', '=', id).executeTakeFirst();
  if (!d) throw notFound('Dataset');
  const releases = await db
    .selectFrom('dataset_release as r')
    .select(RELEASE_COLUMNS)
    .where('r.dataset_id', '=', id)
    .where('r.deleted_at', 'is', null)
    .orderBy('r.release_number', 'desc')
    .execute();
  return { ...datasetSummary(d, releases), releases: releases.map(releaseSummary) };
}

export async function loadRelease(
  db: Database,
  id: string,
): Promise<ReleaseDetail & { requires_approval: boolean }> {
  const r = await db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('program as p', 'p.id', 'd.program_id')
    .leftJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .leftJoin('experiment as e', 'e.id', 'v.experiment_id')
    .leftJoin('file_object as f', 'f.id', 'r.file_id')
    .select([
      ...RELEASE_COLUMNS,
      'r.contract_version',
      'r.column_stats',
      'r.transformations',
      'r.source',
      'r.storage',
      'r.validation',
      'r.status_reason',
      'r.file_id',
      'f.name as file_name',
      'd.kind',
      'd.name as dataset_name',
      'd.program_id',
      'p.code as program_code',
      'p.requires_approval',
      'd.experiment_version_id',
      'v.experiment_id',
      'e.name as experiment_name',
    ])
    .where('r.id', '=', id)
    .where('r.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!r) throw notFound('Release');
  const kind = r.kind as DatasetKind;
  const storage = ReleaseStorageSchema.safeParse(r.storage);
  return {
    ...releaseSummary(r),
    kind,
    dataset_name: r.dataset_name,
    program_id: r.program_id,
    program_code: r.program_code,
    requires_approval: r.requires_approval,
    experiment_version_id: r.experiment_version_id,
    experiment_id: r.experiment_id,
    experiment_name: r.experiment_name,
    contract_version: r.contract_version,
    contract: DATASET_CONTRACTS[kind],
    column_stats: r.column_stats as ReleaseDetail['column_stats'],
    transformations: r.transformations as ReleaseDetail['transformations'],
    source: ReleaseSourceSchema.parse(r.source),
    storage: storage.success ? storage.data : null,
    validation: r.validation as ReleaseDetail['validation'],
    status_reason: r.status_reason,
    lineage: {
      inputs: r.file_id ? [{ type: 'file' as const, id: r.file_id, name: r.file_name ?? r.file_id }] : [],
    },
  };
}
