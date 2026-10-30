import { manifestRowToSample, SEED_PROTEOMICS_TEMPLATE, type ManifestRow } from '@tributary/contracts';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../client.ts';
import type { DB } from '../generated/db.ts';
import {
  describeFile,
  readExperiments,
  readManifest,
  readPrograms,
  readTsv,
  type FixtureExperiment,
} from './fixtures.ts';
import { ensureBucket, stageFile, type StagingTarget } from './s3.ts';

export { localStagingTarget, type StagingTarget } from './s3.ts';

/** Single-tenant deployments use one tenant id; this is the local-development one. */
export const DEV_TENANT_ID = '00000000-0000-7000-8000-000000000001';
const SEED_SUB = 'service:db-seed';
const REQUEST_ID = 'db-seed';
const PUBLISH_REASON = 'Synthetic demo corpus (pnpm db:seed)';

export interface SeedOptions {
  fixturesDir: string;
  /** Upload fixture files to object storage as well; without it, file rows stay `registered`. */
  staging?: StagingTarget;
  tenantId?: string;
}

export const COUNTED_TABLES = [
  'app_user',
  'assay_type',
  'metadata_template',
  'metadata_field_def',
  'program',
  'experiment',
  'experiment_version',
  'sample',
  'contrast',
  'file_object',
  'compound',
  'compound_property',
  'target_annotation',
  'audit_log',
] as const satisfies readonly (keyof DB)[];
export type SeedCounts = Record<(typeof COUNTED_TABLES)[number], number>;

const json = (value: unknown) => JSON.stringify(value);
const ASSAY_TYPES = [
  ['proteomics_dia', 'Proteomics (DIA)', 'proteomics'],
  ['proteomics_dda', 'Proteomics (DDA)', 'proteomics'],
  ['proteomics_tmt', 'Proteomics (TMT)', 'proteomics'],
  ['rnaseq', 'RNA-seq', 'genomics'],
  ['crispr_screen', 'CRISPR screen', 'genomics'],
  ['ngs_raw', 'NGS raw data', 'genomics'],
] as const;

/**
 * Loads the synthetic corpus: assay types, the seed template, programs, published experiment versions with their
 * samples and contrasts, file records (optionally staged to S3), compounds, ADME properties and target annotations.
 * Runs in one transaction and only when the fixture programs don't exist yet, so running it again changes nothing.
 * Returns row counts per table.
 */
export async function seedDatabase(db: Database, options: SeedOptions): Promise<SeedCounts> {
  const tenant = options.tenantId ?? DEV_TENANT_ID;
  const dir = options.fixturesDir;
  const programs = readPrograms(dir);
  const experiments = readExperiments(dir);
  const manifests = new Map(experiments.map((e) => [e.key, readManifest(dir, e)]));
  const rawManifests = new Map(
    experiments.map((e) => [e.key, readTsv(dir, `experiments/${e.key}/${e.manifest}`)]),
  );

  const existing = await db
    .selectFrom('program')
    .select('code')
    .where(
      'code',
      'in',
      programs.map((p) => p.code),
    )
    .where('deleted_at', 'is', null)
    .execute();
  if (existing.length === 0) {
    if (options.staging) await ensureBucket(options.staging);
    await db.transaction().execute(async (trx) => {
      const actor = await seedActor(trx, tenant);
      const base = { tenant_id: tenant, created_by: actor };
      const audit = (action: string, entityType: string, entityId: string, after: unknown, reason?: string) =>
        trx
          .insertInto('audit_log')
          .values({
            tenant_id: tenant,
            actor_id: actor,
            actor_type: 'service',
            action,
            entity_type: entityType,
            entity_id: entityId,
            after: json(after),
            reason: reason ?? null,
            request_id: REQUEST_ID,
          })
          .execute();

      await trx
        .insertInto('assay_type')
        .values(ASSAY_TYPES.map(([key, label, family]) => ({ ...base, key, label, family })))
        .execute();
      const template = await trx
        .insertInto('metadata_template')
        .values({
          ...base,
          assay_type: SEED_PROTEOMICS_TEMPLATE.assay_type,
          version: SEED_PROTEOMICS_TEMPLATE.version,
          status: SEED_PROTEOMICS_TEMPLATE.status,
          key_field: SEED_PROTEOMICS_TEMPLATE.key_field,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('metadata_field_def')
        .values(
          SEED_PROTEOMICS_TEMPLATE.fields.map((f, position) => ({
            ...base,
            template_id: template.id,
            position,
            scope: f.scope,
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            searchable: f.searchable,
            unit: f.unit ?? null,
            ontology: f.ontology ?? null,
            enum_values: f.enumValues ?? null,
            quantity_kind: f.quantityKind ?? null,
            validator: f.validator ?? null,
          })),
        )
        .execute();

      const programIds = new Map<string, string>();
      for (const program of programs) {
        const { id } = await trx
          .insertInto('program')
          .values({ ...base, ...program })
          .returning('id')
          .executeTakeFirstOrThrow();
        programIds.set(program.code, id);
        await audit('program.create', 'program', id, program);
      }

      for (const experiment of experiments) {
        await seedExperiment(
          trx,
          base,
          experiment,
          manifests.get(experiment.key) ?? [],
          rawManifests.get(experiment.key) ?? [],
          programIds,
          audit,
        );
        await seedFiles(trx, base, dir, experiment, options.staging);
      }
      await seedReference(trx, base, dir, programIds, audit);
    });
  }
  return countRows(db);
}

type Base = { tenant_id: string; created_by: string };
type Audit = (
  action: string,
  entityType: string,
  entityId: string,
  after: unknown,
  reason?: string,
) => Promise<unknown>;

async function seedActor(trx: Transaction<DB>, tenant: string): Promise<string> {
  const found = await trx.selectFrom('app_user').select('id').where('sub', '=', SEED_SUB).executeTakeFirst();
  if (found) return found.id;
  const { id } = await sql<{ id: string }>`select uuidv7() as id`.execute(trx).then((r) => r.rows[0]!);
  await trx
    .insertInto('app_user')
    .values({
      id,
      tenant_id: tenant,
      created_by: id,
      sub: SEED_SUB,
      email: 'db-seed@tributary.invalid',
      name: 'Seed service',
    })
    .execute();
  return id;
}

async function seedExperiment(
  trx: Transaction<DB>,
  base: Base,
  experiment: FixtureExperiment,
  rows: ManifestRow[],
  rawRows: Record<string, string>[],
  programIds: Map<string, string>,
  audit: Audit,
): Promise<void> {
  const programId = programIds.get(experiment.program_code);
  if (!programId) throw new Error(`Unknown program ${experiment.program_code} in ${experiment.key}`);
  const created = await trx
    .insertInto('experiment')
    .values({
      ...base,
      program_id: programId,
      assay_type: experiment.assay_type,
      name: experiment.name,
      urn: '',
    })
    .returning(['id', 'urn'])
    .executeTakeFirstOrThrow();
  await audit('experiment.create', 'experiment', created.id, { name: experiment.name, key: experiment.key });

  const version = await trx
    .insertInto('experiment_version')
    .values({
      ...base,
      experiment_id: created.id,
      version_number: 1,
      template_version: experiment.template_version,
      experiment_date: experiment.experiment_date,
      species: json(experiment.species),
      description: experiment.description,
      custom: json({ key: experiment.key }),
      urn: '',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  if (rows.length) {
    await trx
      .insertInto('sample')
      .values(
        rows.map((row, i) => ({
          ...base,
          experiment_version_id: version.id,
          ...sampleColumns(row, rawRows[i] ?? {}),
        })),
      )
      .execute();
  }
  if (experiment.contrasts.length) {
    await trx
      .insertInto('contrast')
      .values(
        experiment.contrasts.map((c) => ({
          ...base,
          experiment_version_id: version.id,
          label: c.label,
          numerator: c.numerator,
          denominator: c.denominator,
        })),
      )
      .execute();
  }
  const published = await trx
    .updateTable('experiment_version')
    .set({
      status: 'published',
      publish_reason: PUBLISH_REASON,
      published_by: base.created_by,
      published_at: new Date(),
    })
    .where('id', '=', version.id)
    .returning(['urn', 'published_at'])
    .executeTakeFirstOrThrow();
  await audit(
    'experiment_version.publish',
    'experiment_version',
    version.id,
    { status: 'published', urn: published.urn, samples: rows.length },
    PUBLISH_REASON,
  );
}

function sampleColumns(row: ManifestRow, raw: Record<string, string>) {
  const sample = manifestRowToSample(row);
  return {
    sample_key: sample.sample_key,
    source_name: sample.source_name,
    characteristics: json(sample.characteristics),
    factors: json(sample.factors),
    technical: json(sample.technical),
    custom: json(sample.custom),
    raw: json(raw),
  };
}

async function seedFiles(
  trx: Transaction<DB>,
  base: Base,
  dir: string,
  experiment: FixtureExperiment,
  staging: StagingTarget | undefined,
): Promise<void> {
  for (const name of [experiment.manifest, ...experiment.outputs]) {
    const file = describeFile(dir, `experiments/${experiment.key}/${name}`);
    const key = `programs/${experiment.program_code}/experiments/${experiment.key}/v1/raw/${name}`;
    const versionId = staging ? await stageFile(staging, dir, file.relativePath, key, file.sha256) : null;
    await trx
      .insertInto('file_object')
      .values({
        ...base,
        name,
        role: name === experiment.manifest ? 'metadata' : 'processed',
        bucket: staging?.bucket ?? 'tributary-raw',
        key,
        s3_version_id: versionId,
        sha256: file.sha256,
        size_bytes: file.sizeBytes,
        declared_format: name,
        ingest_status: staging ? 'uploaded' : 'registered',
      })
      .execute();
  }
}

async function seedReference(
  trx: Transaction<DB>,
  base: Base,
  dir: string,
  programIds: Map<string, string>,
  audit: Audit,
): Promise<void> {
  const program = (code: string | undefined) => {
    const id = programIds.get(code ?? '');
    if (!id) throw new Error(`Unknown program ${code} in reference data`);
    return id;
  };
  const value = (text: string | undefined) => (text ? text : null);

  const compounds = readTsv(dir, 'reference/compounds.tsv');
  await trx
    .insertInto('compound')
    .values(
      compounds.map((c) => ({
        ...base,
        program_id: program(c.program_code),
        compound_id: c.compound_id ?? '',
        batch_id: value(c.batch_id),
        name: value(c.name),
        smiles: value(c.smiles),
        inchikey: value(c.inchikey),
      })),
    )
    .execute();

  const properties = readTsv(dir, 'reference/compound_properties.tsv');
  await trx
    .insertInto('compound_property')
    .values(
      properties.map((p) => ({
        ...base,
        program_id: program(p.program_code),
        compound_id: p.compound_id ?? '',
        batch_id: value(p.batch_id),
        property: p.property ?? '',
        value: p.value ? Number(p.value) : null,
        unit: value(p.unit),
        qualifier: p.qualifier ?? '=',
        assay_category: p.assay_category ?? '',
        assay_name: value(p.assay_name),
      })),
    )
    .execute();

  const targets = readTsv(dir, 'reference/target_annotations.tsv');
  await trx
    .insertInto('target_annotation')
    .values(
      targets.map((t) => ({
        ...base,
        uniprot_accession: t.uniprot_accession ?? '',
        gene_symbol: value(t.gene_symbol),
        family: value(t.family),
        key: t.key ?? '',
        value: value(t.value),
      })),
    )
    .execute();

  for (const [code, id] of programIds) {
    await audit('reference.import', 'program', id, {
      compounds: compounds.filter((c) => c.program_code === code).length,
      compound_properties: properties.filter((p) => p.program_code === code).length,
    });
  }
}

async function countRows(db: Database): Promise<SeedCounts> {
  const counts = {} as SeedCounts;
  for (const table of COUNTED_TABLES) {
    const { count } = await db
      .selectFrom(table)
      .select(db.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    counts[table] = Number(count);
  }
  return counts;
}
