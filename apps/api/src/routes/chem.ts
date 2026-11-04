// Compound structures and structure search (Phase 28, CHEM-01…03). Read-only: nothing is stored or audited.
import {
  CompoundSearchBodySchema,
  CompoundSearchResponseSchema,
  CompoundStructureSchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { describe, rdkit, withMol } from '../chem/rdkit.ts';
import { searchCompounds } from '../chem/search.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerChemRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/compounds/:id/structure', async (request: IdParams) => {
    const readable = readablePrograms(requirePrincipal(request));
    if (readable?.length === 0) throw notFound('Compound');
    let q = db
      .selectFrom('compound')
      .select(['compound_id', 'smiles'])
      .where('compound_id', '=', request.params.id)
      .where('deleted_at', 'is', null);
    if (readable) q = q.where('program_id', 'in', readable);
    const compound = await q.orderBy('batch_id').executeTakeFirst();
    if (!compound) throw notFound('Compound');
    const smiles = compound.smiles?.trim();
    if (!smiles) throw new HttpError(422, 'no_structure', 'This compound has no registered structure.');
    const rd = await rdkit();
    const described = withMol(rd, smiles, (mol) => (mol ? describe(rd, mol) : null));
    if (!described)
      throw new HttpError(
        422,
        'invalid_structure',
        'RDKit cannot read the registered SMILES: correct it in the compound registry.',
      );
    return respond(CompoundStructureSchema, {
      compound_id: compound.compound_id,
      smiles,
      ...described,
      rdkit_version: rd.version(),
    });
  });

  app.post('/v1/compounds/search', async (request) => {
    const body = parse(CompoundSearchBodySchema, request.body);
    if (body.program_id) authorize(request, 'read', 'Dataset', body.program_id);
    const readable = readablePrograms(requirePrincipal(request));
    return respond(CompoundSearchResponseSchema, await searchCompounds(db, readable, body));
  });
}
