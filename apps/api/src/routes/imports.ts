import {
  DATASET_CONTRACTS,
  ImporterListSchema,
  ImportPresetBodySchema,
  ImportPresetSchema,
  ItemsSchema,
  ReleaseDetailSchema,
  StartImportBodySchema,
  type DatasetKind,
  type ImporterInfo,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { IMPORTERS } from '@tributary/importers';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { insertAudit, requestActor } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { loadRelease } from '../datasets/load.ts';
import { runImportJob } from '../datasets/query-client.ts';
import { HttpError, parse } from '../errors.ts';
import { loadFile } from '../ingest/files.ts';
import { contrastsOf, samplesOf } from '../registry/load.ts';
import { respond } from '../respond.ts';
import type { Storage } from '../storage.ts';

const IMPORTABLE = (Object.keys(DATASET_CONTRACTS) as DatasetKind[]).filter(
  (k) => DATASET_CONTRACTS[k].category !== 'metadata',
);

function importerInfo(key: string): ImporterInfo {
  const i = IMPORTERS[key]!;
  const needs: ImporterInfo['needs'] = [];
  if (key === 'custom_tabular') needs.push('mapping');
  else if (DATASET_CONTRACTS[i.kind].category === 'experiment') needs.push('experiment_version');
  if (i.kind === 'differential_abundance' && key !== 'custom_tabular') needs.push('contrast');
  if (key === 'reference_id_mapping') needs.push('source_release');
  return {
    key,
    label: i.label,
    kind: i.kind,
    tool: i.tool,
    formats: i.formats,
    kinds: key === 'custom_tabular' ? IMPORTABLE : [i.kind],
    needs,
  };
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function registerImportRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  storage: Storage,
  fetchImpl: typeof fetch,
): void {
  app.get('/v1/importers', async () =>
    respond(ImporterListSchema, { items: Object.keys(IMPORTERS).map(importerInfo) }),
  );

  app.post('/v1/imports', async (request, reply) => {
    const body = parse(StartImportBodySchema, request.body);
    const file = await loadFile(db, body.file_id);
    authorize(request, 'create', 'Dataset', file.program_id);
    if (!['qc_passed', 'published'].includes(file.ingest_status)) {
      throw new HttpError(
        422,
        'file_not_qc_passed',
        `${file.name} is ${file.ingest_status}; only files that passed QC can be imported.`,
        'file_id',
      );
    }
    const importer = IMPORTERS[body.importer];
    if (!importer)
      throw new HttpError(422, 'unknown_importer', `No importer named ${body.importer}.`, 'importer');

    let options = body.options ?? {};
    if (body.preset_id) {
      const preset = await db
        .selectFrom('import_preset')
        .select(['kind', 'columns', 'constants'])
        .where('id', '=', body.preset_id)
        .where('program_id', '=', file.program_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!preset)
        throw new HttpError(422, 'unknown_preset', 'No such import preset in this program.', 'preset_id');
      options = { ...options, kind: preset.kind, columns: preset.columns, constants: preset.constants };
    }
    const kind = (body.importer === 'custom_tabular' ? options.kind : importer.kind) as DatasetKind;
    if (!IMPORTABLE.includes(kind))
      throw new HttpError(422, 'not_importable', `${String(kind)} cannot be imported.`);
    const category = DATASET_CONTRACTS[kind].category;
    const versionId = category === 'experiment' ? file.experiment_version_id : null;

    let contrast: { id: string; label: string } | undefined;
    if (versionId && (body.contrast_id || kind === 'differential_abundance')) {
      const contrasts = await contrastsOf(db, versionId);
      // Always chosen explicitly: the label fixes the sign of log2 fold change (numerator vs denominator).
      const chosen = body.contrast_id ? contrasts.find((c) => c.id === body.contrast_id) : undefined;
      if (!chosen) {
        throw new HttpError(
          422,
          'needs_contrast',
          'Choose the contrast this table belongs to.',
          'contrast_id',
        );
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
          };
        })
      : undefined;

    const datasetName = body.dataset_name ?? file.name;
    const outputKey = `releases/${kind}/${randomUUID()}.parquet`;
    const result = await runImportJob(fetchImpl, config, {
      importer: body.importer,
      source: { bucket: file.bucket, key: file.key, name: file.name },
      context: {
        ...(versionId ? { experiment_version_id: versionId } : {}),
        program_id: file.program_id,
        ...(runs ? { runs } : {}),
        ...(contrast ? { contrast } : {}),
        options,
      },
      output: { bucket: storage.config.warehouseBucket, key: outputKey },
    });

    const actor = requestActor(request);
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
          importer: body.importer,
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
          importer: body.importer,
          file_id: file.id,
          row_count: result.row_count,
          failed_rules: failed,
        },
      });
      return row.id;
    });
    reply.code(201);
    const { requires_approval: _ra, ...detail } = await loadRelease(db, releaseId);
    return respond(ReleaseDetailSchema, detail);
  });

  app.get('/v1/programs/:id/import-presets', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    authorize(request, 'read', 'Dataset', request.params.id);
    const rows = await db
      .selectFrom('import_preset')
      .select(['id', 'name', 'kind', 'columns', 'constants', 'created_at'])
      .where('program_id', '=', request.params.id)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
    return respond(ItemsSchema(ImportPresetSchema), { items: rows.map(presetRow) });
  });

  app.post(
    '/v1/programs/:id/import-presets',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const body = parse(ImportPresetBodySchema, request.body);
      authorize(request, 'update', 'Dataset', request.params.id);
      const actor = requestActor(request);
      const row = await db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('import_preset')
          .select(['id', 'kind', 'columns', 'constants'])
          .where('program_id', '=', request.params.id)
          .where('name', '=', body.name)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        const values = {
          kind: body.kind,
          columns: JSON.stringify(body.columns),
          constants: JSON.stringify(body.constants ?? {}),
        };
        const saved = existing
          ? await trx
              .updateTable('import_preset')
              .set(values)
              .where('id', '=', existing.id)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await trx
              .insertInto('import_preset')
              .values({
                ...values,
                tenant_id: actor.tenantId,
                created_by: actor.userId,
                program_id: request.params.id,
                name: body.name,
              })
              .returningAll()
              .executeTakeFirstOrThrow();
        await insertAudit(trx, actor, {
          action: existing ? 'import_preset.update' : 'import_preset.create',
          entityType: 'import_preset',
          entityId: saved.id,
          before: existing ?? undefined,
          after: body,
        });
        return saved;
      });
      reply.code(201);
      return respond(ImportPresetSchema, presetRow(row));
    },
  );
}

function presetRow(r: {
  id: string;
  name: string;
  kind: string;
  columns: unknown;
  constants: unknown;
  created_at: Date | string;
}) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as DatasetKind,
    columns: r.columns as Record<string, string>,
    constants: r.constants as Record<string, string>,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}
