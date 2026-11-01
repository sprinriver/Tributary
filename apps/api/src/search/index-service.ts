import { reindexAll, reindexExperiment, type Database } from '@tributary/db';
import { sql } from 'kysely';
import { toStored, type EmbeddingProvider } from './embeddings.ts';

const BATCH = 32;
const MAX_CHARS = 8000;

/** The text an embedding represents; its hash is the document's content_hash. */
const embeddingText = (d: { title: string; subtitle: string; body: string; expansions: string }) =>
  [d.title, d.subtitle, d.body, d.expansions].join('\n').slice(0, MAX_CHARS);

/** Embeds live documents whose embedding (for this provider/model) is missing or stale; returns how many. */
export async function embedPending(
  db: Database,
  provider: EmbeddingProvider,
  actor: string,
): Promise<number> {
  let done = 0;
  for (;;) {
    const pending = await db
      .selectFrom('search_document as d')
      .leftJoin('search_embedding as e', (j) =>
        j
          .onRef('e.document_id', '=', 'd.id')
          .on('e.provider', '=', provider.kind)
          .on('e.model', '=', provider.model),
      )
      .select(['d.id', 'd.tenant_id', 'd.title', 'd.subtitle', 'd.body', 'd.expansions', 'd.content_hash'])
      .where('d.deleted_at', 'is', null)
      .where((eb) => eb.or([eb('e.id', 'is', null), eb('e.content_hash', '<>', eb.ref('d.content_hash'))]))
      .orderBy('d.id')
      .limit(BATCH)
      .execute();
    if (!pending.length) return done;
    const vectors = await provider.embed(pending.map(embeddingText), 'document');
    await db
      .insertInto('search_embedding')
      .values(
        pending.map((d, i) => ({
          tenant_id: d.tenant_id,
          created_by: actor,
          document_id: d.id,
          provider: provider.kind,
          model: provider.model,
          content_hash: d.content_hash,
          embedding: sql`${toStored(vectors[i]!, provider.dims)}::vector`,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['document_id', 'provider', 'model']).doUpdateSet((eb) => ({
          content_hash: eb.ref('excluded.content_hash'),
          embedding: eb.ref('excluded.embedding'),
          deleted_at: null,
        })),
      )
      .execute();
    done += pending.length;
  }
}

export interface SearchIndex {
  /** Full-text documents of one experiment; call inside the transaction that changed it. */
  experiment(trx: Database, experimentId: string, actor: string): Promise<void>;
  /** After commit: embeddings for changed documents (best effort; the admin reindex backfills). */
  afterCommit(actor: string): void;
  rebuild(actor: string): Promise<{ documents: number; embedded: number }>;
}

export function searchIndex(
  db: Database,
  provider: EmbeddingProvider | null,
  log: { warn(o: object, m: string): void },
): SearchIndex {
  return {
    async experiment(trx, experimentId, actor) {
      await reindexExperiment(trx, experimentId, actor);
    },
    afterCommit(actor) {
      if (!provider) return;
      void embedPending(db, provider, actor).catch((error: unknown) =>
        log.warn({ err: error }, 'search embeddings failed; documents stay full-text only until reindexed'),
      );
    },
    async rebuild(actor) {
      const documents = await reindexAll(db, actor);
      const embedded = provider ? await embedPending(db, provider, actor) : 0;
      return { documents, embedded };
    },
  };
}
