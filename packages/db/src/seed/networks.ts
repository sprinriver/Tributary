// Demo reference networks: the gene-set collection (Phase 24) and the interaction collection (Phase 45).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transaction } from 'kysely';
import type { DB } from '../generated/db.ts';
import type { Audit, Base } from './index.ts';

export async function seedNetworks(
  trx: Transaction<DB>,
  base: Base,
  dir: string,
  audit: Audit,
): Promise<void> {
  // Demo gene-set collection for pathway enrichment (synthetic modules; see fixtures/README.md).
  const gmt = readFileSync(join(dir, 'reference/gene_sets.gmt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [id = '', name = '', ...members] = line.split('\t');
      return { id, name: name || id, members: [...new Set(members.filter(Boolean))] };
    });
  const collection = await trx
    .insertInto('gene_set_collection')
    .values({
      ...base,
      name: 'Demo modules (synthetic)',
      source: 'synthetic',
      source_release: 'demo-1',
      species: 'NCBITaxon:9606',
      id_type: 'gene_symbol',
      set_count: gmt.length,
      member_count: gmt.reduce((n, g) => n + g.members.length, 0),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('gene_set')
    .values(
      gmt.map((g) => ({
        ...base,
        collection_id: collection.id,
        set_key: g.id,
        name: g.name,
        members: g.members,
      })),
    )
    .execute();
  await audit('gene_sets.import', 'gene_set_collection', collection.id, {
    name: 'Demo modules (synthetic)',
    sets: gmt.length,
  });

  // Demo interaction collection for networks of hits (invented pairs; see fixtures/README.md).
  const pairs = readFileSync(join(dir, 'reference/interactions.tsv'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [a = '', b = '', score = ''] = line.split('\t');
      return { a, b, score: Number(score) };
    });
  const network = await trx
    .insertInto('interaction_collection')
    .values({
      ...base,
      name: 'Demo interactions (synthetic)',
      source: 'synthetic',
      source_release: 'demo-1',
      species: 'NCBITaxon:9606',
      id_type: 'gene_symbol',
      licence: null,
      edge_count: pairs.length,
      node_count: new Set(pairs.flatMap((p) => [p.a, p.b])).size,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('interaction_edge')
    .values(pairs.map((p) => ({ ...base, collection_id: network.id, ...p })))
    .execute();
  await audit('interactions.import', 'interaction_collection', network.id, {
    name: 'Demo interactions (synthetic)',
    edges: pairs.length,
  });
}
