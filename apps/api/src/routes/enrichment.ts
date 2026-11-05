// Gene-set collections and pathway enrichment (Phase 24, ENR-02/03).
import {
  EnrichmentBodySchema,
  EnrichmentResponseSchema,
  GeneSetCollectionListSchema,
  GeneSetCollectionSchema,
  ImportGeneSetsBodySchema,
  type GeneSetCollection,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parseGmt } from '../enrichment/gmt.ts';
import { runEnrichment } from '../enrichment/run.ts';
import { HttpError, parse } from '../errors.ts';
import { respond } from '../respond.ts';

const COLUMNS = [
  'id',
  'name',
  'source',
  'source_release',
  'species',
  'id_type',
  'set_count',
  'member_count',
  'created_at',
] as const;

const toCollection = (
  r: Omit<GeneSetCollection, 'created_at' | 'id_type'> & { id_type: string; created_at: Date },
) =>
  ({
    ...r,
    id_type: r.id_type as GeneSetCollection['id_type'],
    created_at: r.created_at.toISOString(),
  }) as GeneSetCollection;

export function registerEnrichmentRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  const { db } = deps;

  app.get('/v1/gene-set-collections', async (request) => {
    const principal = requirePrincipal(request);
    const rows = await db
      .selectFrom('gene_set_collection')
      .select(COLUMNS)
      .where('tenant_id', '=', principal.tenantId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .orderBy('created_at', 'desc')
      .execute();
    return respond(GeneSetCollectionListSchema, { items: rows.map(toCollection) });
  });

  // Whole GMT files (GO, Reactome) are a few MB of text.
  app.post('/v1/gene-set-collections', { bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
    requireSystemAdmin(request);
    const body = parse(ImportGeneSetsBodySchema, request.body);
    const { sets, errors } = parseGmt(body.gmt);
    const [first] = errors;
    if (first)
      throw new HttpError(
        400,
        'invalid_gmt',
        `GMT line ${first.line}: ${first.message}${errors.length > 1 ? ` (${errors.length} problems in all)` : ''}`,
        'gmt',
      );
    if (sets.length === 0) throw new HttpError(400, 'invalid_gmt', 'The GMT text has no gene sets.', 'gmt');
    const actor = requestActor(request);
    const base = { tenant_id: actor.tenantId, created_by: actor.userId };
    const created = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('gene_set_collection')
        .values({
          ...base,
          name: body.name,
          source: body.source,
          source_release: body.source_release,
          species: body.species,
          id_type: body.id_type,
          set_count: sets.length,
          member_count: sets.reduce((n, s) => n + s.members.length, 0),
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      for (let i = 0; i < sets.length; i += 1000) {
        await trx
          .insertInto('gene_set')
          .values(
            sets.slice(i, i + 1000).map((s) => ({
              ...base,
              collection_id: row.id,
              set_key: s.id,
              name: s.name,
              members: s.members,
            })),
          )
          .execute();
      }
      await insertAudit(trx, actor, {
        action: 'gene_sets.import',
        entityType: 'gene_set_collection',
        entityId: row.id,
        after: { ...row, created_at: row.created_at.toISOString() },
      });
      return row;
    });
    reply.code(201);
    return respond(GeneSetCollectionSchema, toCollection(created));
  });

  app.post('/v1/enrichment', async (request) => {
    const body = parse(EnrichmentBodySchema, request.body);
    return respond(EnrichmentResponseSchema, await runEnrichment(deps, request, body));
  });
}
