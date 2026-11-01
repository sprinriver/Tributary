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
import { insertAudit, requestActor } from '../audit.ts';
import { importFile, IMPORTABLE } from '../datasets/import-file.ts';
import { authorize } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { loadRelease } from '../datasets/load.ts';
import { parse } from '../errors.ts';
import { loadFile } from '../ingest/files.ts';
import { respond } from '../respond.ts';
import type { Storage } from '../storage.ts';

function importerInfo(key: string): ImporterInfo {
  const i = IMPORTERS[key]!;
  const needs: ImporterInfo['needs'] = [];
  if (key === 'custom_tabular') needs.push('mapping');
  else if (DATASET_CONTRACTS[i.kind].category === 'experiment') needs.push('experiment_version');
  // MSstats tables carry their own comparison labels, matched to every registered contrast.
  if (key === 'msstats_comparison') needs.push('contrasts');
  else if (i.kind === 'differential_abundance' && key !== 'custom_tabular') needs.push('contrast');
  if (key === 'curvecurator') needs.push('doses');
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
    const releaseId = await importFile(
      { db, config, storage, fetch: fetchImpl },
      requestActor(request),
      file,
      body,
    );
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
