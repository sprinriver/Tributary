import { AssayTypeKeySchema, ProgramListSchema, TemplateListSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
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
    const { assay_type } = parse(
      z.strictObject({ assay_type: AssayTypeKeySchema.optional() }),
      request.query,
    );
    const items = assay_type ? await listTemplates(db, assay_type) : await listTemplates(db);
    return respond(TemplateListSchema, { items });
  });
}
