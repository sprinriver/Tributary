import {
  OntologySearchQuerySchema,
  OntologySearchResultSchema,
  SEED_TERMS,
  type OntologySearchResult,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '../config.ts';
import { disabledOntologies } from '../admin/settings.ts';
import { HttpError, parse } from '../errors.ts';
import { respond } from '../respond.ts';

const CACHE_DAYS = 30;
const OLS_TIMEOUT_MS = 3000;

interface OlsDoc {
  obo_id?: string;
  label?: string;
  ontology_name?: string;
  synonym?: string[];
}

/**
 * Typeahead over OLS4 (`/api/search`, https://www.ebi.ac.uk/ols4/help) with a Postgres cache, so a repeated lookup —
 * and every lookup in an air-gapped install once cached — never leaves the network. Falls back to cached and
 * built-in terms when OLS4 cannot be reached.
 */
export function registerOntologyRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  fetchImpl: typeof fetch,
): void {
  app.get('/v1/ontology/search', async (request) => {
    const { ontology: rawOntology, q: rawQ } = parse(OntologySearchQuerySchema, request.query);
    const ontology = rawOntology.toLowerCase();
    // Admins choose the ontology sources (SPEC M11); a disabled one is not looked up.
    if ((await disabledOntologies(db, config.tenantId)).has(ontology))
      throw new HttpError(
        422,
        'ontology_disabled',
        `Lookups in ${rawOntology} are switched off by an admin.`,
        'ontology',
      );
    const q = rawQ.toLowerCase();
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000);

    const cached = await db
      .selectFrom('ontology_query_cache')
      .select('term_ids')
      .where('ontology', '=', ontology)
      .where('query', '=', q)
      .where('fetched_at', '>', since)
      .executeTakeFirst();
    if (cached)
      return respond(OntologySearchResultSchema, {
        source: 'cache',
        items: await terms(db, cached.term_ids),
      });

    let docs: OlsDoc[] | undefined;
    try {
      const url = new URL(`${config.olsUrl.replace(/\/$/, '')}/api/search`);
      url.search = new URLSearchParams({
        q: rawQ,
        ontology,
        rows: '10',
        fieldList: 'obo_id,label,ontology_name,synonym',
      }).toString();
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(OLS_TIMEOUT_MS) });
      if (res.ok) docs = ((await res.json()) as { response?: { docs?: OlsDoc[] } }).response?.docs ?? [];
    } catch (error) {
      request.log.warn({ err: error }, 'OLS4 lookup failed; using cached and built-in terms');
    }

    if (!docs)
      return respond(OntologySearchResultSchema, {
        source: 'local',
        items: await localTerms(db, ontology, q),
      });

    const found = docs
      .filter((d): d is Required<Pick<OlsDoc, 'obo_id' | 'label'>> & OlsDoc => !!d.obo_id && !!d.label)
      .map((d) => ({ id: d.obo_id, label: d.label, synonyms: d.synonym ?? [] }));
    await db.transaction().execute(async (trx) => {
      for (const term of found) {
        await trx
          .insertInto('ontology_term_cache')
          .values({ ontology, term_id: term.id, label: term.label, synonyms: term.synonyms })
          .onConflict((oc) =>
            oc
              .column('term_id')
              .doUpdateSet({ label: term.label, synonyms: term.synonyms, fetched_at: new Date() }),
          )
          .execute();
      }
      await trx
        .insertInto('ontology_query_cache')
        .values({ ontology, query: q, term_ids: found.map((t) => t.id) })
        .onConflict((oc) =>
          oc
            .columns(['ontology', 'query'])
            .doUpdateSet({ term_ids: found.map((t) => t.id), fetched_at: new Date() }),
        )
        .execute();
    });
    return respond(OntologySearchResultSchema, { source: 'ols', items: found });
  });
}

async function terms(db: Database, ids: string[]): Promise<OntologySearchResult['items']> {
  if (!ids.length) return [];
  const rows = await db
    .selectFrom('ontology_term_cache')
    .select(['term_id', 'label', 'synonyms'])
    .where('term_id', 'in', ids)
    .execute();
  const byId = new Map(rows.map((r) => [r.term_id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.term_id, label: row.label, synonyms: row.synonyms }] : [];
  });
}

/** Cached terms whose label starts with the query, then built-in seed terms containing it. */
async function localTerms(db: Database, ontology: string, q: string): Promise<OntologySearchResult['items']> {
  const cached = await db
    .selectFrom('ontology_term_cache')
    .select(['term_id', 'label', 'synonyms'])
    .where('ontology', '=', ontology)
    .where((eb) => eb(eb.fn('lower', ['label']), 'like', `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`))
    .limit(10)
    .execute();
  const items = cached.map((r) => ({ id: r.term_id, label: r.label, synonyms: r.synonyms }));
  for (const term of SEED_TERMS) {
    const matches =
      term.ontology.toLowerCase() === ontology &&
      (term.label.toLowerCase().includes(q) || term.id.toLowerCase().includes(q));
    if (matches && !items.some((i) => i.id === term.id))
      items.push({ id: term.id, label: term.label, synonyms: [] });
  }
  return items.slice(0, 10);
}
