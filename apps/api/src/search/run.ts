import {
  SEARCH_FACETS,
  type FacetValue,
  type SearchFacet,
  type SearchHit,
  type SearchResponse,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql, type RawBuilder } from 'kysely';
import { toStored, type EmbeddingProvider } from './embeddings.ts';
import { expandQuery } from './expand.ts';
import { reciprocalRankFusion } from './fusion.ts';
import { queryTerms } from './terms.ts';

const FULLTEXT_CANDIDATES = 500;
const VECTOR_CANDIDATES = 100;
const MARK = { start: '\u0001', stop: '\u0002' };

export interface SearchRequest {
  q: string;
  type?: 'experiment' | 'sample' | undefined;
  filters: Partial<Record<SearchFacet, string[]>>;
  limit: number;
  offset: number;
}

interface Candidate {
  id: string;
  program_id: string;
  assay_type: string;
  status: string;
  species: string[];
  compounds: string[];
}

/** Values of a candidate for one facet. */
const facetValues = (c: Candidate, f: SearchFacet): string[] =>
  f === 'program'
    ? [c.program_id]
    : f === 'assay_type'
      ? [c.assay_type]
      : f === 'status'
        ? [c.status]
        : f === 'species'
          ? c.species
          : c.compounds;

/** The tsquery for the query terms: each term bound as a parameter, OR-ed so unmatched words don't empty the result. */
function tsqueries(terms: string[], prefixLast: string | undefined): RawBuilder<unknown>[] {
  const parts = terms.map((t) => sql`plainto_tsquery('simple', ${t})`);
  // Typing in the palette: the last word also matches as a prefix (alphanumerics only, so the syntax is safe).
  if (prefixLast && /^[\p{L}\p{N}]{2,}$/u.test(prefixLast))
    parts.push(sql`to_tsquery('simple', ${`${prefixLast}:*`})`);
  return parts;
}

/**
 * Hybrid search (SPEC M9). Both sub-queries filter by the caller's programs in SQL (`programs` null = all, for
 * system admins), so nothing outside them is ranked, counted or faceted. Facets describe the matching set before
 * facet filters; filters then narrow the hits.
 */
export async function runSearch(
  db: Database,
  programs: string[] | null,
  request: SearchRequest,
  provider: EmbeddingProvider | null,
  minSimilarity: number,
  log?: { warn(o: object, m: string): void },
): Promise<SearchResponse> {
  const empty = (): SearchResponse => ({
    items: [],
    facets: Object.fromEntries(SEARCH_FACETS.map((f) => [f, []])) as unknown as SearchResponse['facets'],
    total: 0,
    mode: 'fulltext',
    capped: false,
    expansions: [],
    next_cursor: null,
  });
  if (programs !== null && programs.length === 0) return empty();

  const expansions = await expandQuery(db, request.q);
  const original = queryTerms(request.q);
  const terms = [...new Set([...original, ...expansions.flatMap((e) => queryTerms(e.label))])];
  if (!terms.length) return { ...empty(), expansions };
  const words = request.q.trim().toLowerCase().split(/\s+/);
  const parts = tsqueries(terms, request.q.endsWith(' ') ? undefined : words.at(-1));
  const tsq = parts.length ? sql`(${sql.join(parts, sql` || `)})` : sql`''::tsquery`;
  const scoped = (alias: string) =>
    sql.join(
      [
        sql`${sql.ref(`${alias}.deleted_at`)} is null`,
        ...(programs === null ? [] : [sql`${sql.ref(`${alias}.program_id`)} = any(${programs}::uuid[])`]),
        ...(request.type ? [sql`${sql.ref(`${alias}.entity_type`)} = ${request.type}`] : []),
      ],
      sql` and `,
    );

  const fulltext = parts.length
    ? (
        await sql<{ id: string }>`
          select d.id from search_document d
          where ${scoped('d')} and d.tsv @@ ${tsq}
          order by (${sql.join(
            parts.map((p) => sql`(d.tsv @@ ${p})::int`),
            sql` + `,
          )}) desc, ts_rank_cd(d.tsv, ${tsq}) desc, d.title, d.id
          limit ${FULLTEXT_CANDIDATES}`.execute(db)
      ).rows.map((r) => r.id)
    : [];

  let vector: string[] = [];
  let mode: SearchResponse['mode'] = 'fulltext';
  if (provider) {
    try {
      vector = await vectorCandidates(db, provider, request.q, scoped, minSimilarity);
      mode = 'hybrid';
    } catch (error) {
      // The embedding service is optional: answer with full-text and say so (`mode`), never fail the search.
      log?.warn({ err: error }, 'search embeddings unavailable; answering with full-text only');
    }
  }

  const fused = reciprocalRankFusion({ fulltext, vector });
  if (!fused.length) return { ...empty(), mode, expansions };
  const candidates = await db
    .selectFrom('search_document')
    .select(['id', 'program_id', 'assay_type', 'status', 'species', 'compounds'])
    .where(
      'id',
      'in',
      fused.map((f) => f.id),
    )
    .execute();
  const byId = new Map<string, Candidate>(candidates.map((c) => [c.id, c]));
  const facets = await facetCounts(db, candidates);
  const passes = (c: Candidate) =>
    SEARCH_FACETS.every((f) => {
      const wanted = request.filters[f];
      return !wanted?.length || facetValues(c, f).some((v) => wanted.includes(v));
    });
  const filtered = fused.filter((f) => byId.has(f.id) && passes(byId.get(f.id)!));
  const page = filtered.slice(request.offset, request.offset + request.limit);
  const items = await hydrate(db, page, tsq);
  const nextOffset = request.offset + request.limit;
  return {
    items,
    facets,
    total: filtered.length,
    mode,
    capped: fulltext.length >= FULLTEXT_CANDIDATES,
    expansions,
    next_cursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
  };
}

async function facetCounts(db: Database, candidates: Candidate[]): Promise<SearchResponse['facets']> {
  const programCodes = new Map(
    (
      await db
        .selectFrom('program')
        .select(['id', 'code'])
        .where('id', 'in', [
          ...new Set(candidates.map((c) => c.program_id)),
          '00000000-0000-0000-0000-000000000000',
        ])
        .execute()
    ).map((p) => [p.id, p.code]),
  );
  const assayLabels = new Map(
    (
      await db.selectFrom('assay_type').select(['key', 'label']).where('deleted_at', 'is', null).execute()
    ).map((a) => [String(a.key), a.label]),
  );
  const label = (f: SearchFacet, v: string) =>
    f === 'program' ? (programCodes.get(v) ?? v) : f === 'assay_type' ? (assayLabels.get(v) ?? v) : v;
  const out = {} as Record<SearchFacet, FacetValue[]>;
  for (const f of SEARCH_FACETS) {
    const counts = new Map<string, number>();
    for (const c of candidates)
      for (const v of new Set(facetValues(c, f))) counts.set(v, (counts.get(v) ?? 0) + 1);
    out[f] = [...counts]
      .map(([value, count]) => ({ value, label: label(f, value), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  return out;
}

async function hydrate(
  db: Database,
  page: ReturnType<typeof reciprocalRankFusion>,
  tsq: RawBuilder<unknown>,
): Promise<SearchHit[]> {
  if (!page.length) return [];
  const options = `StartSel=${MARK.start}, StopSel=${MARK.stop}, MaxWords=24, MinWords=8, MaxFragments=2, FragmentDelimiter=" … "`;
  const rows = await db
    .selectFrom('search_document as d')
    .innerJoin('experiment as e', 'e.id', 'd.experiment_id')
    .innerJoin('program as p', 'p.id', 'd.program_id')
    .select([
      'd.id',
      'd.entity_type',
      'd.entity_id',
      'd.experiment_id',
      'd.experiment_version_id',
      'd.program_id',
      'd.assay_type',
      'd.status',
      'd.title',
      'd.subtitle',
      'e.name as experiment_name',
      'p.code as program_code',
      sql<string>`ts_headline('simple', d.body, ${tsq}, ${options})`.as('snippet'),
    ])
    .where(
      'd.id',
      'in',
      page.map((p) => p.id),
    )
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return page.flatMap((f) => {
    const r = byId.get(f.id);
    if (!r) return [];
    return [
      {
        type: r.entity_type as SearchHit['type'],
        id: r.entity_id,
        experiment_id: r.experiment_id,
        experiment_version_id: r.experiment_version_id,
        experiment_name: r.experiment_name,
        program_id: r.program_id,
        program_code: r.program_code,
        assay_type: r.assay_type,
        status: r.status,
        title: r.title,
        subtitle: r.subtitle,
        snippet: r.snippet,
        score: f.score,
        ranks: f.ranks,
      },
    ];
  });
}

export const encodeCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: unknown };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0 && o <= 10_000) return o;
  } catch {
    // fall through
  }
  return -1;
}

type Scoped = (alias: string) => RawBuilder<unknown>;

/** Nearest documents to the query's embedding, scoped like the full-text sub-query. */
async function vectorCandidates(
  db: Database,
  provider: EmbeddingProvider,
  q: string,
  scoped: Scoped,
  minSimilarity: number,
): Promise<string[]> {
  const [embedding] = await provider.embed([q], 'query');
  const v = toStored(embedding!, provider.dims);
  return db.transaction().execute(async (trx) => {
    // pgvector ≥ 0.8: keep scanning the HNSW graph until enough rows pass the program filter.
    await sql`set local hnsw.iterative_scan = relaxed_order`.execute(trx);
    const rows = (
      await sql<{ id: string; similarity: number }>`
        select d.id, 1 - (e.embedding <=> ${v}::vector) as similarity
        from search_embedding e join search_document d on d.id = e.document_id
        where ${scoped('d')} and e.deleted_at is null and e.provider = ${provider.kind}
          and e.model = ${provider.model} and e.content_hash = d.content_hash
        order by e.embedding <=> ${v}::vector
        limit ${VECTOR_CANDIDATES}`.execute(trx)
    ).rows;
    // relaxed_order may return neighbours slightly out of order: re-sort by similarity.
    return rows
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .map((r) => r.id);
  });
}
