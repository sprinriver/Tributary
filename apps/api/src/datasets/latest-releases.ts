// Latest published release of each readable dataset of one kind, in latest published versions, newest first.
// Shared by selectivity (dose_response) and modification sites (ptm_site_quant).
import type { DatasetKind } from '@tributary/contracts';
import type { Database } from '@tributary/db';

export interface LatestRelease {
  version_id: string;
  experiment_id: string;
  experiment_name: string;
  experiment_date: string | null;
  program_code: string;
  release_id: string;
  dataset_name: string;
  program_id: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v));

export async function latestReleases(
  db: Database,
  kind: DatasetKind,
  readable: string[] | null,
  programId?: string,
): Promise<LatestRelease[]> {
  if (readable?.length === 0) return [];
  let q = db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      'r.id as release_id',
      'd.name as dataset_name',
      'v.id as version_id',
      'e.id as experiment_id',
      'e.name as experiment_name',
      'v.experiment_date',
      'p.code as program_code',
      'd.program_id',
      'r.published_at',
      'e.created_at',
    ])
    .distinctOn('d.id')
    .where('d.kind', '=', kind)
    .where('r.status', '=', 'published')
    .where('r.deleted_at', 'is', null)
    .where('d.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .where('v.is_latest_published', '=', true);
  if (readable) q = q.where('d.program_id', 'in', readable);
  if (programId) q = q.where('d.program_id', '=', programId);
  const releases = await q
    .orderBy('d.id')
    .orderBy('r.published_at', 'desc')
    .orderBy('r.id', 'desc')
    .execute();
  // Newest first: experiment date, else creation.
  const when = (r: (typeof releases)[number]) => iso(r.experiment_date) ?? iso(r.created_at) ?? '';
  return releases
    .sort((a, b) => when(b).localeCompare(when(a)) || b.release_id.localeCompare(a.release_id))
    .map((r) => ({
      version_id: r.version_id,
      experiment_id: r.experiment_id,
      experiment_name: r.experiment_name,
      experiment_date: iso(r.experiment_date),
      program_code: r.program_code,
      release_id: r.release_id,
      dataset_name: r.dataset_name,
      program_id: r.program_id,
    }));
}
