import type { AssayTypeKey } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { notFound } from '../errors.ts';
import { rowToField } from './templates.ts';

const VERSION_COLUMNS = [
  'v.id',
  'v.experiment_id',
  'v.version_number',
  'v.status',
  'v.parent_version_id',
  'v.experiment_date',
  'v.species',
  'v.spectral_library',
  'v.time_points',
  'v.is_latest_published',
  'v.urn',
  'v.created_at',
  'v.published_at',
  'v.template_version',
  'v.description',
  'v.custom',
  'v.publish_reason',
  'v.published_by',
] as const;

/** A version with the experiment fields every route needs for authorisation and validation. */
export async function loadVersion(db: Database, id: string) {
  const row = await db
    .selectFrom('experiment_version as v')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      ...VERSION_COLUMNS,
      'e.name as experiment_name',
      'e.assay_type',
      'e.program_id',
      'p.requires_approval',
    ])
    .where('v.id', '=', id)
    .where('v.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('Version');
  return { ...row, assay_type: row.assay_type as AssayTypeKey };
}
export type LoadedVersion = Awaited<ReturnType<typeof loadVersion>>;

export async function customFieldsOf(db: Database, versionId: string) {
  const rows = await db
    .selectFrom('metadata_field_def')
    .selectAll()
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
  return rows.map(rowToField);
}

export async function contrastsOf(db: Database, versionId: string) {
  return db
    .selectFrom('contrast')
    .select(['id', 'label', 'numerator', 'denominator', 'method_hint'])
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .orderBy('created_at')
    .orderBy('label')
    .execute();
}

export async function samplesOf(db: Database, versionId: string) {
  return db
    .selectFrom('sample')
    .select([
      'id',
      'sample_key',
      'source_name',
      'raw',
      'characteristics',
      'factors',
      'technical',
      'custom',
      'validation_errors',
    ])
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
}

/** Full version detail (VersionDetailSchema). */
export async function versionDetail(db: Database, id: string) {
  const version = await loadVersion(db, id);
  const [customFields, contrasts, count] = await Promise.all([
    customFieldsOf(db, id),
    contrastsOf(db, id),
    db
      .selectFrom('sample')
      .select(db.fn.countAll<string>().as('n'))
      .where('experiment_version_id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ]);
  return { ...version, custom_fields: customFields, contrasts, sample_count: Number(count.n) };
}

export async function versionSummaries(db: Database, experimentId: string) {
  return db
    .selectFrom('experiment_version as v')
    .select(VERSION_COLUMNS)
    .where('v.experiment_id', '=', experimentId)
    .where('v.deleted_at', 'is', null)
    .orderBy('v.version_number')
    .execute();
}

export async function experimentDetail(db: Database, id: string) {
  const experiment = await db
    .selectFrom('experiment as e')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      'e.id',
      'e.name',
      'e.urn',
      'e.assay_type',
      'e.program_id',
      'p.code as program_code',
      'e.created_at',
      'e.archived_at',
    ])
    .where('e.id', '=', id)
    .where('e.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!experiment) throw notFound('Experiment');
  return { ...experiment, versions: await versionSummaries(db, id) };
}
