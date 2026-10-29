import {
  PublishBodySchema,
  UpdateVersionBodySchema,
  validateManifest,
  VersionDetailSchema,
  VersionDiffSchema,
  type ContractError,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { changeReason, writeAudit } from '../audit.ts';
import { inProgram } from '../auth/abilities.ts';
import { authorize } from '../auth/plugin.ts';
import { forbidden, HttpError, parse } from '../errors.ts';
import { diffVersions } from '../registry/diff.ts';
import {
  contrastsOf,
  customFieldsOf,
  loadVersion,
  samplesOf,
  versionDetail,
  type LoadedVersion,
} from '../registry/load.ts';
import { fieldToRow, pinnedTemplate } from '../registry/templates.ts';
import {
  checkCustomFields,
  MANIFEST_OPTIONS,
  parseCustomValues,
  parseTimePoints,
} from '../registry/values.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const json = (value: unknown) => JSON.stringify(value);

export function requireDraft(version: LoadedVersion): void {
  if (version.status !== 'draft') {
    throw new HttpError(
      409,
      'immutable',
      `Version ${version.version_number} is ${version.status}; create a new version to change it.`,
    );
  }
}

/** Every reason a draft cannot be published yet: manifest errors (re-validated against the pinned template). */
export async function publishBlockers(db: Database, version: LoadedVersion): Promise<HttpError | undefined> {
  const samples = await samplesOf(db, version.id);
  if (!samples.length) return new HttpError(422, 'no_samples', 'Add samples before publishing.', 'samples');
  const template = await pinnedTemplate(db, version.assay_type, version.template_version);
  const customFields = await customFieldsOf(db, version.id);
  const result = validateManifest(
    template,
    customFields.filter((f) => f.scope === 'sample'),
    samples.map((s) => s.raw as Record<string, string>),
    MANIFEST_OPTIONS,
  );
  const errors: ContractError[] = result.ok ? [] : result.errors;
  for (const field of customFields.filter((f) => f.scope === 'experiment' && f.required)) {
    const value = (version.custom as Record<string, unknown>)[field.key];
    if (value === undefined || value === null || value === '') {
      errors.push({ code: 'required', field: `custom.${field.key}`, message: `${field.label} is required.` });
    }
  }
  if (!errors.length) return undefined;
  return new HttpError(
    422,
    'manifest_invalid',
    `${errors.length} problem(s) must be fixed before publishing.`,
    errors[0]?.field,
    errors,
  );
}

export function registerVersionRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/versions/:id', async (request: IdParams) => {
    const detail = await versionDetail(db, request.params.id);
    authorize(request, 'read', 'ExperimentVersion', detail.program_id);
    return respond(VersionDetailSchema, detail);
  });

  app.patch('/v1/versions/:id', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    const principal = authorize(request, 'update', 'ExperimentVersion', version.program_id);
    requireDraft(version);
    const body = parse(UpdateVersionBodySchema, request.body);
    const template = await pinnedTemplate(db, version.assay_type, version.template_version);
    const customFields = body.custom_fields ?? (await customFieldsOf(db, version.id));
    checkCustomFields(customFields, new Set(template.fields.map((f) => f.key)));
    const custom =
      body.custom !== undefined || body.custom_fields
        ? parseCustomValues(customFields, (body.custom ?? version.custom) as Record<string, string>)
        : undefined;
    const before = await versionDetail(db, version.id);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('experiment_version')
        .set({
          ...(body.experiment_date !== undefined ? { experiment_date: body.experiment_date } : {}),
          ...(body.species !== undefined ? { species: body.species ? json(body.species) : null } : {}),
          ...(body.spectral_library !== undefined ? { spectral_library: body.spectral_library } : {}),
          ...(body.time_points ? { time_points: json(parseTimePoints(body.time_points)) } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(custom ? { custom: json(custom) } : {}),
        })
        .where('id', '=', version.id)
        .execute();
      if (body.custom_fields) {
        await trx
          .updateTable('metadata_field_def')
          .set({ deleted_at: new Date() })
          .where('experiment_version_id', '=', version.id)
          .where('deleted_at', 'is', null)
          .execute();
        if (body.custom_fields.length) {
          await trx
            .insertInto('metadata_field_def')
            .values(
              body.custom_fields.map((f, i) => ({
                tenant_id: principal.tenantId,
                created_by: principal.userId,
                experiment_version_id: version.id,
                ...fieldToRow(f, i),
              })),
            )
            .execute();
        }
      }
      await writeAudit(trx, request, {
        action: 'experiment_version.update',
        entityType: 'experiment_version',
        entityId: version.id,
        before,
        after: await versionDetail(trx as unknown as Database, version.id),
      });
    });
    return respond(VersionDetailSchema, await versionDetail(db, version.id));
  });

  app.post('/v1/versions/:id/publish', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    const principal = authorize(request, 'publish', 'ExperimentVersion', version.program_id);
    if (
      version.requires_approval &&
      !principal.ability.can('approve', inProgram('ExperimentVersion', version.program_id))
    ) {
      throw forbidden('This program requires an approver to publish.');
    }
    const body = parse(PublishBodySchema, request.body ?? {});
    const reason = body.reason?.trim() || changeReason(request);
    if (!reason)
      throw new HttpError(400, 'reason_required', 'Say why this version is being published.', 'reason');
    requireDraft(version);
    const blocker = await publishBlockers(db, version);
    if (blocker) throw blocker;

    await db.transaction().execute(async (trx) => {
      const after = await trx
        .updateTable('experiment_version')
        .set({
          status: 'published',
          publish_reason: reason,
          published_by: principal.userId,
          published_at: new Date(),
        })
        .where('id', '=', version.id)
        .where('status', '=', 'draft')
        .returning(['id', 'status', 'publish_reason', 'published_by', 'published_at', 'urn'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, request, {
        action: 'experiment_version.publish',
        entityType: 'experiment_version',
        entityId: version.id,
        before: { status: version.status },
        after,
        reason,
      });
    });
    return respond(VersionDetailSchema, await versionDetail(db, version.id));
  });

  app.post('/v1/versions/:id/archive', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'publish', 'ExperimentVersion', version.program_id);
    if (version.status !== 'published')
      throw new HttpError(409, 'not_published', 'Only published versions can be archived.');
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('experiment_version')
        .set({ status: 'archived' })
        .where('id', '=', version.id)
        .execute();
      await writeAudit(trx, request, {
        action: 'experiment_version.archive',
        entityType: 'experiment_version',
        entityId: version.id,
        before: { status: 'published' },
        after: { status: 'archived' },
      });
    });
    return respond(VersionDetailSchema, await versionDetail(db, version.id));
  });

  app.post('/v1/versions/:id/clone', async (request: IdParams, reply) => {
    const source = await loadVersion(db, request.params.id);
    const principal = authorize(request, 'create', 'ExperimentVersion', source.program_id);
    const base = { tenant_id: principal.tenantId, created_by: principal.userId };
    const id = await db.transaction().execute(async (trx) => {
      const max = await trx
        .selectFrom('experiment_version')
        .select(trx.fn.max('version_number').as('n'))
        .where('experiment_id', '=', source.experiment_id)
        .executeTakeFirstOrThrow();
      const version = await trx
        .insertInto('experiment_version')
        .values({
          ...base,
          experiment_id: source.experiment_id,
          version_number: Number(max.n ?? 0) + 1,
          parent_version_id: source.id,
          template_version: source.template_version,
          experiment_date: source.experiment_date,
          species: source.species === null ? null : json(source.species),
          spectral_library: source.spectral_library,
          time_points: json(source.time_points),
          description: source.description,
          custom: json(source.custom),
          urn: '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const fields = await customFieldsOf(trx as unknown as Database, source.id);
      if (fields.length) {
        await trx
          .insertInto('metadata_field_def')
          .values(fields.map((f, i) => ({ ...base, experiment_version_id: version.id, ...fieldToRow(f, i) })))
          .execute();
      }
      const samples = await samplesOf(trx as unknown as Database, source.id);
      if (samples.length) {
        await trx
          .insertInto('sample')
          .values(
            samples.map(({ id: _id, ...s }) => ({
              ...base,
              ...s,
              experiment_version_id: version.id,
              raw: json(s.raw),
              characteristics: json(s.characteristics),
              factors: json(s.factors),
              technical: json(s.technical),
              custom: json(s.custom),
              validation_errors: json(s.validation_errors),
            })),
          )
          .execute();
      }
      const contrasts = await contrastsOf(trx as unknown as Database, source.id);
      if (contrasts.length) {
        await trx
          .insertInto('contrast')
          .values(
            contrasts.map(({ id: _id, ...c }) => ({ ...base, ...c, experiment_version_id: version.id })),
          )
          .execute();
      }
      await writeAudit(trx, request, {
        action: 'experiment_version.clone',
        entityType: 'experiment_version',
        entityId: version.id,
        after: { parent_version_id: source.id, samples: samples.length, contrasts: contrasts.length },
      });
      return version.id;
    });
    return reply.status(201).send(respond(VersionDetailSchema, await versionDetail(db, id)));
  });

  app.get(
    '/v1/versions/:id/diff/:otherId',
    async (request: FastifyRequest<{ Params: { id: string; otherId: string } }>) => {
      const side = async (id: string) => {
        const detail = await versionDetail(db, id);
        authorize(request, 'read', 'ExperimentVersion', detail.program_id);
        return {
          fields: {
            experiment_date: detail.experiment_date,
            species: detail.species,
            spectral_library: detail.spectral_library,
            time_points: detail.time_points,
            description: detail.description,
            template_version: detail.template_version,
          },
          custom: detail.custom as Record<string, unknown>,
          customFields: detail.custom_fields,
          samples: (await samplesOf(db, id)).map((s) => ({
            sample_key: s.sample_key,
            raw: s.raw as Record<string, string>,
          })),
          contrasts: detail.contrasts,
        };
      };
      const [base, target] = [await side(request.params.id), await side(request.params.otherId)];
      return respond(VersionDiffSchema, diffVersions(base, target));
    },
  );
}
