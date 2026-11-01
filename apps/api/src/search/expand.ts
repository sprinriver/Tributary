import { SEED_TERMS, type SearchResponse } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql } from 'kysely';
import { phrases } from './terms.ts';

type Expansion = SearchResponse['expansions'][number];
interface Synonym {
  term_id: string;
  label: string;
  synonym: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const SEED: Synonym[] = SEED_TERMS.flatMap((t) =>
  (t.synonyms ?? []).map((synonym) => ({ term_id: t.id, label: t.label, synonym: norm(synonym) })),
);

/** A query phrase names a synonym when it is the whole synonym, or (2+ words) its leading words. */
const matches = (phrase: string, synonym: string) =>
  synonym === phrase || (phrase.includes(' ') && synonym.startsWith(`${phrase} `));

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Ontology synonyms in the query (SPEC M9): "K562" → K-562, "human embryonic kidney" → HEK293. Sources are the
 * seed terms and the OLS4 term cache. The longest matching phrase wins per term.
 */
export async function expandQuery(db: Database, q: string): Promise<Expansion[]> {
  const candidates = phrases(q);
  if (!candidates.length) return [];
  const multi = candidates.filter((p) => p.includes(' '));
  const cached = await db
    .selectFrom('ontology_term_cache')
    .select(['term_id', 'label', sql<string[]>`synonyms`.as('synonyms')])
    .where(
      sql<boolean>`exists (select 1 from unnest(synonyms) s where lower(s) = any(${candidates}::text[])${
        multi.length ? sql` or lower(s) like any(${multi.map((p) => `${likeEscape(p)} %`)}::text[])` : sql``
      })`,
    )
    .limit(50)
    .execute();
  const synonyms: Synonym[] = [
    ...SEED,
    ...cached.flatMap((c) =>
      c.synonyms.map((s) => ({ term_id: c.term_id, label: c.label, synonym: norm(s) })),
    ),
  ];
  const best = new Map<string, Expansion>();
  for (const phrase of candidates) {
    for (const s of synonyms) {
      if (!matches(phrase, s.synonym) || norm(s.label) === phrase) continue;
      const current = best.get(s.term_id);
      if (!current || phrase.length > current.matched.length)
        best.set(s.term_id, { term_id: s.term_id, label: s.label, matched: phrase });
    }
  }
  return [...best.values()];
}
