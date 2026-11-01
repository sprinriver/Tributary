import {
  ItemsSchema,
  ListTemplatesQuerySchema,
  MappingPresetBodySchema,
  MappingPresetSchema,
  ProgramListSchema,
  TemplateListSchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { parse } from '../errors.ts';
import { listTemplates } from '../registry/templates.ts';
import { respond } from '../respond.ts';

export function registerProgramRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/programs', async (request) => {
    const programs = readablePrograms(requirePrincipal(request));
    let query = db
      .selectFrom('program')
      .select(['id', 'code', 'name', 'description', 'requires_approval'])
      .where('deleted_at', 'is', null)
      .orderBy('code');
    if (programs)
      query = programs.length ? query.where('id', 'in', programs) : query.where((eb) => eb.val(false));
    return respond(ProgramListSchema, { items: await query.execute() });
  });

  app.get('/v1/templates', async (request) => {
    const { assay_type } = parse(ListTemplatesQuerySchema, request.query);
    const items = assay_type ? await listTemplates(db, assay_type) : await listTemplates(db);
    return respond(TemplateListSchema, { items });
  });
}

export function registerPresetRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/programs/:id/mapping-presets', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    authorize(request, 'read', 'Program', request.params.id);
    const items = await db
      .selectFrom('mapping_preset')
      .select(['id', 'name', 'mapping', 'created_at'])
      .where('program_id', '=', request.params.id)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
    return respond(ItemsSchema(MappingPresetSchema), { items });
  });

  app.post(
    '/v1/programs/:id/mapping-presets',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const principal = authorize(request, 'update', 'Program', request.params.id);
      const body = parse(MappingPresetBodySchema, request.body);
      // Saving under an existing name updates that preset (the editor's "Save mapping as preset" overwrites).
      const { preset, created } = await db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('mapping_preset')
          .select(['id', 'mapping'])
          .where('program_id', '=', request.params.id)
          .where('name', '=', body.name)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        const row = existing
          ? await trx
              .updateTable('mapping_preset')
              .set({ mapping: JSON.stringify(body.mapping) })
              .where('id', '=', existing.id)
              .returning(['id', 'name', 'mapping', 'created_at'])
              .executeTakeFirstOrThrow()
          : await trx
              .insertInto('mapping_preset')
              .values({
                tenant_id: principal.tenantId,
                created_by: principal.userId,
                program_id: request.params.id,
                name: body.name,
                mapping: JSON.stringify(body.mapping),
              })
              .returning(['id', 'name', 'mapping', 'created_at'])
              .executeTakeFirstOrThrow();
        await writeAudit(trx, request, {
          action: existing ? 'mapping_preset.update' : 'mapping_preset.create',
          entityType: 'mapping_preset',
          entityId: row.id,
          before: existing ?? null,
          after: row,
        });
        return { preset: row, created: !existing };
      });
      return reply.status(created ? 201 : 200).send(respond(MappingPresetSchema, preset));
    },
  );
}
