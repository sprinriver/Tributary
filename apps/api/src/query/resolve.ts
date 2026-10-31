import {
  DATASET_CONTRACTS,
  ReleaseStorageSchema,
  type DatasetKind,
  type ResolvedSource,
  type SourceRef,
} from '@tributary/contracts';
import { HttpError } from '../errors.ts';
import { METADATA_KINDS, type Database, type MetadataKind } from '@tributary/db';

/** Program ids the caller may read (null = every program), narrowed by an explicit scope. */
function narrow(readable: string[] | null, requested: readonly string[] | undefined): string[] | null {
  if (!requested) return readable;
  return readable ? requested.filter((id) => readable.includes(id)) : [...requested];
}

const isMetadata = (kind: DatasetKind): kind is MetadataKind =>
  (METADATA_KINDS as readonly string[]).includes(kind);

async function latestPublishedVersions(db: Database, programs: string[] | null): Promise<string[]> {
  let q = db
    .selectFrom('experiment_version as v')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select('v.id')
    .where('v.is_latest_published', '=', true)
    .where('v.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null);
  if (programs?.length === 0) return [];
  if (programs) q = q.where('e.program_id', 'in', programs);
  return (await q.execute()).map((r) => r.id);
}

function intersect(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] | undefined {
  if (!a) return b ? [...b] : undefined;
  return b ? a.filter((x) => b.includes(x)) : [...a];
}

/**
 * Program scoping (ARCHITECTURE §6), applied before compilation: a SourceRef becomes concrete published
 * releases, or a metadata scope, inside the caller's programs. Returns null for a source the caller cannot see.
 * Kind sources use each dataset's latest published release; `latestPublishedOnly` keeps only datasets of the
 * latest published experiment versions.
 */
export async function resolveSource(
  db: Database,
  ref: SourceRef,
  readable: string[] | null,
): Promise<ResolvedSource | null> {
  if ('releaseIds' in ref) {
    if (readable?.length === 0) return null;
    let q = db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .select(['r.id', 'r.storage', 'r.dataset_id', 'd.kind'])
      .where('r.id', 'in', ref.releaseIds)
      .where('r.status', '=', 'published')
      .where('r.deleted_at', 'is', null)
      .where('d.deleted_at', 'is', null);
    if (readable) q = q.where('d.program_id', 'in', readable);
    const rows = await q.execute();
    const kinds = new Set(rows.map((r) => r.kind));
    if (rows.length !== new Set(ref.releaseIds).size || kinds.size !== 1) return null;
    // Two releases of one dataset would duplicate its rows.
    if (new Set(rows.map((r) => r.dataset_id)).size !== rows.length)
      throw new HttpError(400, 'duplicate_dataset', 'Pick one release per dataset.', 'source.releaseIds');
    return {
      kind: rows[0]!.kind as DatasetKind,
      releases: rows.map((r) => ({ release_id: r.id, storage: ReleaseStorageSchema.parse(r.storage) })),
    };
  }

  const programs = narrow(readable, ref.scope.programIds);
  let versions = ref.scope.experimentVersionIds;
  if (ref.scope.latestPublishedOnly)
    versions = intersect(versions, await latestPublishedVersions(db, programs));

  if (isMetadata(ref.kind)) {
    return {
      kind: ref.kind,
      metadata: { program_ids: programs, ...(versions ? { experiment_version_ids: versions } : {}) },
    };
  }
  if (programs?.length === 0 || versions?.length === 0) return { kind: ref.kind, releases: [] };
  let q = db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .select(['r.id', 'r.storage'])
    .distinctOn('r.dataset_id')
    .where('d.kind', '=', ref.kind)
    .where('r.status', '=', 'published')
    .where('r.deleted_at', 'is', null)
    .where('d.deleted_at', 'is', null);
  if (programs) q = q.where('d.program_id', 'in', programs);
  // Version scoping only applies to experiment data; reference data has no version.
  if (versions && DATASET_CONTRACTS[ref.kind].category === 'experiment')
    q = q.where('d.experiment_version_id', 'in', versions);
  const rows = await q.orderBy('r.dataset_id').orderBy('r.release_number', 'desc').execute();
  return {
    kind: ref.kind,
    releases: rows.map((r) => ({ release_id: r.id, storage: ReleaseStorageSchema.parse(r.storage) })),
  };
}
