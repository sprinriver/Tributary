import { DATASET_CONTRACTS, type DatasetKind } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { IMPORTERS } from '@tributary/importers';
import { randomUUID } from 'node:crypto';
import { insertAudit, type AuditActor } from '../audit.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError } from '../errors.ts';
import type { LoadedFile } from '../ingest/files.ts';
import { contrastsOf, samplesOf } from '../registry/load.ts';
import type { Storage } from '../storage.ts';
import { runImportJob } from './query-client.ts';

export interface ImportDeps {
  db: Database;
  config: ApiConfig;
  storage: Storage;
  fetch: typeof fetch;
}

export interface ImportRequest {
  importer: string;
  dataset_name?: string | undefined;
  contrast_id?: string | undefined;
  preset_id?: string | undefined;
  options?: Record<string, unknown> | undefined;
}

export const IMPORTABLE = (Object.keys(DATASET_CONTRACTS) as DatasetKind[]).filter(
  (k) => DATASET_CONTRACTS[k].category !== 'metadata',
);

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Imports one QC-passed file with an importer (apps/query) into a new release of its dataset: staged when every
 * error rule passes, rejected otherwise. Shared by the import API and pipeline outputs. Returns the release id.
 */
export async function importFile(
  { db, config, storage, fetch: fetchImpl }: ImportDeps,
  actor: AuditActor,
  file: LoadedFile,
  request: ImportRequest,
): Promise<string> {
  if (!['qc_passed', 'published'].includes(file.ingest_status)) {
    throw new HttpError(
      422,
      'file_not_qc_passed',
      `${file.name} is ${file.ingest_status}; only files that passed QC can be imported.`,
      'file_id',
    );
  }
  const importer = IMPORTERS[request.importer];
  if (!importer)
    throw new HttpError(422, 'unknown_importer', `No importer named ${request.importer}.`, 'importer');

  let options = request.options ?? {};
  if (request.preset_id) {
    const preset = await db
      .selectFrom('import_preset')
      .select(['kind', 'columns', 'constants'])
      .where('id', '=', request.preset_id)
      .where('program_id', '=', file.program_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!preset)
      throw new HttpError(422, 'unknown_preset', 'No such import preset in this program.', 'preset_id');
    options = { ...options, kind: preset.kind, columns: preset.columns, constants: preset.constants };
  }
  const kind = (request.importer === 'custom_tabular' ? options.kind : importer.kind) as DatasetKind;
  if (!IMPORTABLE.includes(kind))
    throw new HttpError(422, 'not_importable', `${String(kind)} cannot be imported.`);
  const category = DATASET_CONTRACTS[kind].category;
  const versionId = category === 'experiment' ? file.experiment_version_id : null;

  let contrast: { id: string; label: string } | undefined;
  const allContrasts = versionId
    ? (await contrastsOf(db, versionId)).map((c) => ({ id: c.id, label: c.label }))
    : [];
  if (
    versionId &&
    request.importer !== 'msstats_comparison' &&
    (request.contrast_id || kind === 'differential_abundance')
  ) {
    const contrasts = await contrastsOf(db, versionId);
    // Always chosen explicitly: the label fixes the sign of log2 fold change (numerator vs denominator).
    const chosen = request.contrast_id ? contrasts.find((c) => c.id === request.contrast_id) : undefined;
    if (!chosen) {
      throw new HttpError(422, 'needs_contrast', 'Choose the contrast this table belongs to.', 'contrast_id');
    }
    contrast = { id: chosen.id, label: chosen.label };
  }
  const runs = versionId
    ? (await samplesOf(db, versionId)).map((s) => {
        const raw = (s.raw ?? {}) as Record<string, unknown>;
        return {
          sample_key: s.sample_key,
          instrument_run: text(raw.instrument_run),
          raw_file: text(raw.raw_file),
          condition: text(raw.condition),
        };
      })
    : undefined;

  const datasetName = request.dataset_name ?? file.name;
  const outputKey = `releases/${kind}/${randomUUID()}.parquet`;
  const result = await runImportJob(fetchImpl, config, {
    importer: request.importer,
    source: { bucket: file.bucket, key: file.key, name: file.name },
    context: {
      ...(versionId ? { experiment_version_id: versionId } : {}),
      program_id: file.program_id,
      ...(runs ? { runs } : {}),
      ...(contrast ? { contrast } : {}),
      ...(allContrasts.length ? { contrasts: allContrasts } : {}),
      options,
    },
    output: { bucket: storage.config.warehouseBucket, key: outputKey },
  });

  const releaseId = await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('dataset')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        kind,
        experiment_version_id: versionId,
        program_id: file.program_id,
        name: datasetName,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    let datasetQuery = trx
      .selectFrom('dataset')
      .select('id')
      .where('program_id', '=', file.program_id)
      .where('kind', '=', kind)
      .where('name', '=', datasetName)
      .where('deleted_at', 'is', null);
    datasetQuery = versionId
      ? datasetQuery.where('experiment_version_id', '=', versionId)
      : datasetQuery.where('experiment_version_id', 'is', null);
    const dataset = await datasetQuery.forUpdate().executeTakeFirstOrThrow();
    const last = await trx
      .selectFrom('dataset_release')
      .select((eb) => eb.fn.max('release_number').as('n'))
      .where('dataset_id', '=', dataset.id)
      .executeTakeFirst();
    const failed = result.failures.filter((f) => f.severity === 'error').map((f) => f.rule_id);
    const status = result.passed ? 'staged' : 'rejected';
    const row = await trx
      .insertInto('dataset_release')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        dataset_id: dataset.id,
        release_number: Number(last?.n ?? 0) + 1,
        contract_version: result.contract_version,
        storage: JSON.stringify(result.output ?? {}),
        row_count: result.row_count,
        column_stats: JSON.stringify(result.column_stats),
        source: JSON.stringify({
          ...result.source,
          file: { id: file.id, name: file.name, sha256: file.sha256, bucket: file.bucket, key: file.key },
        }),
        transformations: JSON.stringify(result.transformations),
        status,
        importer: request.importer,
        file_id: file.id,
        validation: JSON.stringify({ passed: result.passed, failures: result.failures }),
        status_reason: result.passed ? null : `Quality rules failed: ${failed.join(', ')}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await insertAudit(trx, actor, {
      action: result.passed ? 'release.stage' : 'release.reject',
      entityType: 'dataset_release',
      entityId: row.id,
      after: {
        status,
        importer: request.importer,
        file_id: file.id,
        row_count: result.row_count,
        failed_rules: failed,
      },
    });
    return row.id;
  });
  return releaseId;
}
