// Interaction collections and the network of a contrast's hits (Phase 45, PPI-02/03).
import {
  ImportInteractionsBodySchema,
  InteractionCollectionListSchema,
  InteractionCollectionSchema,
  InteractionNetworkBodySchema,
  InteractionNetworkSchema,
  type InteractionCollection,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { readablePrograms, requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { normaliseId, type IdType } from '../enrichment/ids.ts';
import { readContrastRows } from '../enrichment/rows.ts';
import { selectIds } from '../enrichment/select.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { hitNetwork, parseInteractions, type Edge } from '../interactions/network.ts';
import { resolveSource } from '../query/resolve.ts';
import { respond } from '../respond.ts';

const COLUMNS = [
  'id',
  'name',
  'source',
  'source_release',
  'species',
  'id_type',
  'licence',
  'edge_count',
  'node_count',
  'created_at',
] as const;
/** Rows per insert. */
const BATCH = 5000;
/** Hit identifiers per lookup. */
const IDS_PER_QUERY = 2000;

const toCollection = (
  r: Omit<InteractionCollection, 'created_at' | 'id_type'> & { id_type: string; created_at: Date },
) =>
  ({
    ...r,
    id_type: r.id_type as InteractionCollection['id_type'],
    created_at: r.created_at.toISOString(),
  }) as InteractionCollection;

export function registerInteractionRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  const { db } = deps;

  app.get('/v1/interaction-collections', async (request) => {
    const principal = requirePrincipal(request);
    const rows = await db
      .selectFrom('interaction_collection')
      .select(COLUMNS)
      .where('tenant_id', '=', principal.tenantId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .orderBy('created_at', 'desc')
      .execute();
    return respond(InteractionCollectionListSchema, { items: rows.map(toCollection) });
  });

  // A thresholded STRING species file is a few MB of text (scripts/string-prepare.mjs).
  app.post('/v1/interaction-collections', { bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
    requireSystemAdmin(request);
    const body = parse(ImportInteractionsBodySchema, request.body);
    const parsed = parseInteractions(body.interactions);
    const [first] = parsed.errors;
    if (first)
      throw new HttpError(
        400,
        'invalid_interactions',
        `Line ${first.line}: ${first.message}${parsed.errors.length > 1 ? ` (${parsed.errors.length} problems in all)` : ''}`,
        'interactions',
      );
    const idType = body.id_type as IdType;
    // Identifiers as releases are matched (isoform suffixes removed for accessions), pairs once more after that.
    const edges = parseInteractions(
      parsed.edges
        .map((e) => `${normaliseId(e.a, idType)}\t${normaliseId(e.b, idType)}\t${e.score}`)
        .join('\n'),
    ).edges;
    if (edges.length === 0)
      throw new HttpError(400, 'invalid_interactions', 'The text has no interactions.', 'interactions');
    const actor = requestActor(request);
    const base = { tenant_id: actor.tenantId, created_by: actor.userId };
    const created = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('interaction_collection')
        .values({
          ...base,
          name: body.name,
          source: body.source,
          source_release: body.source_release,
          species: body.species,
          id_type: body.id_type,
          licence: body.licence ?? null,
          edge_count: edges.length,
          node_count: new Set(edges.flatMap((e) => [e.a, e.b])).size,
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      for (let i = 0; i < edges.length; i += BATCH)
        await trx
          .insertInto('interaction_edge')
          .values(edges.slice(i, i + BATCH).map((e) => ({ ...base, collection_id: row.id, ...e })))
          .execute();
      await insertAudit(trx, actor, {
        action: 'interactions.import',
        entityType: 'interaction_collection',
        entityId: row.id,
        after: {
          ...row,
          created_at: row.created_at.toISOString(),
          self_pairs_dropped: parsed.selfPairs,
          duplicate_pairs_merged: parsed.duplicates,
        },
      });
      return row;
    });
    reply.code(201);
    return respond(InteractionCollectionSchema, toCollection(created));
  });

  app.post('/v1/interactions/network', async (request) => {
    const body = parse(InteractionNetworkBodySchema, request.body);
    const principal = requirePrincipal(request);
    const source = await resolveSource(db, { releaseIds: [body.release_id] }, readablePrograms(principal));
    if (!source) throw notFound('Release');
    if (source.kind !== 'differential_abundance')
      throw new HttpError(
        422,
        'wrong_kind',
        'An interaction network needs a differential-abundance release.',
        'release_id',
      );
    const collection = await db
      .selectFrom('interaction_collection')
      .select(COLUMNS)
      .where('id', '=', body.collection_id)
      .where('tenant_id', '=', principal.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!collection) throw notFound('Interaction collection');
    const idType = collection.id_type as IdType;
    const { rows, label } = await readContrastRows(deps, source, body.release_id, body.contrast_label);
    const sel = selectIds(rows, idType, body);
    const hits = [...sel.hits];

    // Edges with both ends among the hits; and which hits the collection knows at all (at any score).
    const edges: Edge[] = [];
    const inCollection = new Set<string>();
    for (let i = 0; i < hits.length; i += IDS_PER_QUERY) {
      const part = hits.slice(i, i + IDS_PER_QUERY);
      const inPart = new Set(part);
      const touching = await db
        .selectFrom('interaction_edge')
        .select(['a', 'b', 'score'])
        .where('collection_id', '=', collection.id)
        .where('deleted_at', 'is', null)
        .where((eb) => eb.or([eb('a', 'in', part), eb('b', 'in', part)]))
        .execute();
      for (const e of touching) {
        if (sel.hits.has(e.a)) inCollection.add(e.a);
        if (sel.hits.has(e.b)) inCollection.add(e.b);
        // Each edge is seen once per part that holds one of its ends: keep it from the part holding `a`.
        if (e.score >= body.min_score && sel.hits.has(e.a) && sel.hits.has(e.b) && inPart.has(e.a))
          edges.push({ a: e.a, b: e.b, score: e.score });
      }
    }
    const net = hitNetwork(sel.hitGenes, edges, { inCollection, maxEdges: body.max_edges });
    const unit = idType === 'gene_symbol' ? 'gene symbol' : 'UniProt accession';
    return respond(InteractionNetworkSchema, {
      nodes: net.nodes,
      edges: net.edges,
      provenance: {
        release_id: body.release_id,
        contrast_label: label,
        collection: {
          id: collection.id,
          name: collection.name,
          source: collection.source,
          source_release: collection.source_release,
          id_type: idType,
          licence: collection.licence,
        },
        thresholds: {
          direction: body.direction,
          adj_p_max: body.adj_p_max,
          abs_log2fc_min: body.abs_log2fc_min,
        },
        min_score: body.min_score,
        counts: net.counts,
        notes: [
          `Edges are known or predicted associations from ${collection.source} (${collection.source_release}); they were not measured in this experiment.`,
          `Hits: source adjusted p ≤ ${body.adj_p_max} and |log2 fold change| ≥ ${body.abs_log2fc_min} (${body.direction}); protein groups are expanded to each ${unit} they contain, matched exactly to the collection's identifiers.`,
          `Shown: edges between two hits with score ≥ ${body.min_score} (of 1000)${net.counts.edges > net.counts.edges_shown ? `; the strongest ${net.counts.edges_shown} of ${net.counts.edges}` : ''}. Hits without such an edge are counted, not drawn.`,
          'No network statistic is computed: whether hits interact more than expected by chance is not tested here.',
          `"In this collection" means the identifier has at least one pair in the collection as imported (${collection.source_release}): a score threshold applied before import also decides this.`,
          'A protein group with several identifiers contributes each of them as a hit, so a line can join two identifiers of one group.',
          ...(/string/i.test(collection.source)
            ? [
                'STRING scores combine several kinds of evidence for a functional association; an association is not necessarily physical binding.',
              ]
            : []),
          ...(collection.licence ? [`${collection.source} data: ${collection.licence}.`] : []),
        ],
      },
    });
  });
}
