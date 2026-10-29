import {
  DeleteSamplesBodySchema,
  ItemsSchema,
  ContrastRowSchema,
  manifestRowToSample,
  ReplaceContrastsBodySchema,
  SampleListSchema,
  SampleValidationSchema,
  UpsertSamplesBodySchema,
  validateManifest,
  type ContractError,
  type MetadataTemplateDefinition,
  type MetadataFieldDef,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import { parse } from '../errors.ts';
import { contrastsOf, customFieldsOf, loadVersion, samplesOf } from '../registry/load.ts';
import { pinnedTemplate } from '../registry/templates.ts';
import { MANIFEST_OPTIONS } from '../registry/values.ts';
import { respond } from '../respond.ts';
import { requireDraft } from './versions.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const json = (value: unknown) => JSON.stringify(value);

/**
 * Validates a batch of raw rows (errors indexed by batch position, `rows.<i>.<column>`) and the typed columns of
 * each row that is valid on its own. Invalid rows are still stored, with their errors per cell (SPEC §4 Sample).
 */
function validateBatch(
  template: MetadataTemplateDefinition,
  sampleFields: MetadataFieldDef[],
  rows: Record<string, string>[],
) {
  const batch = validateManifest(template, sampleFields, rows, MANIFEST_OPTIONS);
  const errors: ContractError[] = batch.ok ? [] : batch.errors;
  const prepared = rows.map((raw, i) => {
    const prefix = `rows.${i}.`;
    const cellErrors = Object.fromEntries(
      errors
        .filter((e) => e.field?.startsWith(prefix))
        .map((e) => [e.field!.slice(prefix.length), e.message]),
    );
    const single = validateManifest(template, sampleFields, [raw], MANIFEST_OPTIONS);
    const typed = single.ok ? manifestRowToSample(single.rows[0]!) : undefined;
    return { raw, cellErrors, typed, key: (raw[template.key_field] ?? '').trim() };
  });
  return { errors, prepared };
}

export function registerSampleRoutes(app: FastifyInstance, db: Database): void {
  const context = async (id: string) => {
    const version = await loadVersion(db, id);
    const template = await pinnedTemplate(db, version.assay_type, version.template_version);
    const sampleFields = (await customFieldsOf(db, id)).filter((f) => f.scope === 'sample');
    return { version, template, sampleFields };
  };

  app.get('/v1/versions/:id/samples', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'read', 'Sample', version.program_id);
    return respond(SampleListSchema, { items: await samplesOf(db, version.id) });
  });

  app.post('/v1/versions/:id/samples/validate', async (request: IdParams) => {
    const { version, template, sampleFields } = await context(request.params.id);
    authorize(request, 'read', 'Sample', version.program_id);
    const body = parse(UpsertSamplesBodySchema, request.body);
    return respond(SampleValidationSchema, {
      saved: 0,
      errors: validateBatch(template, sampleFields, body.rows).errors,
    });
  });

  app.put('/v1/versions/:id/samples', async (request: IdParams) => {
    const { version, template, sampleFields } = await context(request.params.id);
    const principal = authorize(request, 'update', 'Sample', version.program_id);
    requireDraft(version);
    const body = parse(UpsertSamplesBodySchema, request.body);
    const { errors, prepared } = validateBatch(template, sampleFields, body.rows);
    const existing = new Map((await samplesOf(db, version.id)).map((s) => [s.sample_key, s.id]));

    const saved = await db.transaction().execute(async (trx) => {
      let count = 0;
      const seen = new Set<string>();
      for (const row of prepared) {
        if (!row.key || seen.has(row.key)) continue; // unkeyed or duplicate rows are reported, not stored
        seen.add(row.key);
        const values = {
          source_name: row.typed?.source_name ?? (row.raw.source_name?.trim() || null),
          raw: json(row.raw),
          characteristics: json(row.typed?.characteristics ?? {}),
          factors: json(row.typed?.factors ?? {}),
          technical: json(row.typed?.technical ?? {}),
          custom: json(row.typed?.custom ?? {}),
          validation_errors: json(row.cellErrors),
        };
        const id = existing.get(row.key);
        if (id) await trx.updateTable('sample').set(values).where('id', '=', id).execute();
        else {
          await trx
            .insertInto('sample')
            .values({
              ...values,
              tenant_id: principal.tenantId,
              created_by: principal.userId,
              experiment_version_id: version.id,
              sample_key: row.key,
            })
            .execute();
        }
        count += 1;
      }
      await writeAudit(trx, request, {
        action: 'samples.upsert',
        entityType: 'experiment_version',
        entityId: version.id,
        after: { sample_keys: [...seen], errors: errors.length },
      });
      return count;
    });
    return respond(SampleValidationSchema, { saved, errors });
  });

  app.delete('/v1/versions/:id/samples', async (request: IdParams, reply) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'update', 'Sample', version.program_id);
    requireDraft(version);
    const body = parse(DeleteSamplesBodySchema, request.body);
    await db.transaction().execute(async (trx) => {
      const removed = await trx
        .updateTable('sample')
        .set({ deleted_at: new Date() })
        .where('experiment_version_id', '=', version.id)
        .where('sample_key', 'in', body.sample_keys)
        .where('deleted_at', 'is', null)
        .returning('sample_key')
        .execute();
      await writeAudit(trx, request, {
        action: 'samples.delete',
        entityType: 'experiment_version',
        entityId: version.id,
        before: { sample_keys: removed.map((r) => r.sample_key) },
      });
    });
    return reply.status(204).send();
  });

  app.get('/v1/versions/:id/contrasts', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'read', 'ExperimentVersion', version.program_id);
    return respond(ItemsSchema(ContrastRowSchema), { items: await contrastsOf(db, version.id) });
  });

  app.put('/v1/versions/:id/contrasts', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    const principal = authorize(request, 'update', 'ExperimentVersion', version.program_id);
    requireDraft(version);
    const body = parse(ReplaceContrastsBodySchema, request.body);
    const before = await contrastsOf(db, version.id);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('contrast')
        .set({ deleted_at: new Date() })
        .where('experiment_version_id', '=', version.id)
        .where('deleted_at', 'is', null)
        .execute();
      if (body.contrasts.length) {
        await trx
          .insertInto('contrast')
          .values(
            body.contrasts.map((c) => ({
              tenant_id: principal.tenantId,
              created_by: principal.userId,
              experiment_version_id: version.id,
              // Contrast labels read "numerator vs denominator" (CLAUDE.md science conventions).
              label: c.label ?? `${c.numerator} vs ${c.denominator}`,
              numerator: c.numerator,
              denominator: c.denominator,
              method_hint: c.method_hint ?? null,
            })),
          )
          .execute();
      }
      await writeAudit(trx, request, {
        action: 'contrasts.replace',
        entityType: 'experiment_version',
        entityId: version.id,
        before,
        after: body.contrasts,
      });
    });
    return respond(ItemsSchema(ContrastRowSchema), { items: await contrastsOf(db, version.id) });
  });
}
