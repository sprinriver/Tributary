// Compound structures and structure search (Phase 28, CHEM-01…03). Read-only: nothing is stored or audited.
import {
  CompoundSearchBodySchema,
  CompoundSearchResponseSchema,
  CompoundStructureQuerySchema,
  CompoundStructureSchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { batchOrder, compoundRows } from '../chem/compounds.ts';
import { describe, rdkit, readable as readableSmiles, withMol } from '../chem/rdkit.ts';
import { searchCompounds } from '../chem/search.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerChemRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/compounds/:id/structure', async (request: IdParams) => {
    const query = parse(CompoundStructureQuerySchema, request.query);
    const readable = readablePrograms(requirePrincipal(request));
    if (readable?.length === 0) throw notFound('Compound');
    if (query.program_id && readable && !readable.includes(query.program_id)) throw notFound('Compound');
    const rows = await compoundRows(db, readable, {
      programId: query.program_id,
      compoundId: request.params.id,
      limit: 1000,
    });
    if (rows.length === 0) throw notFound('Compound');
    // A compound ID is unique within a program only.
    if (new Set(rows.map((r) => r.program_id)).size > 1)
      throw new HttpError(
        422,
        'ambiguous_compound',
        `${request.params.id} exists in more than one of your programs: choose one.`,
        'program_id',
      );
    rows.sort((a, b) => batchOrder(a.batch_id, b.batch_id));
    const row = query.batch_id ? rows.find((r) => r.batch_id === query.batch_id) : rows[0];
    if (!row) throw notFound('Batch');
    const smiles = row.smiles?.trim();
    if (!smiles) throw new HttpError(422, 'no_structure', 'This batch has no registered structure.');
    const unreadable = readableSmiles(smiles);
    const rd = await rdkit();
    const described = unreadable ? null : withMol(rd, smiles, (mol) => (mol ? describe(rd, mol) : null));
    if (!described)
      throw new HttpError(
        422,
        'invalid_structure',
        `RDKit cannot read the registered SMILES${unreadable ? ` (${unreadable})` : ''}: correct it in the compound registry.`,
      );
    const structures = new Set(rows.map((r) => r.smiles?.trim()).filter(Boolean));
    return respond(CompoundStructureSchema, {
      compound_id: row.compound_id,
      program_code: row.program_code,
      batch_id: row.batch_id,
      smiles,
      ...described,
      batches: rows.map((r) => ({ batch_id: r.batch_id, smiles: r.smiles })),
      batches_differ: structures.size > 1,
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
