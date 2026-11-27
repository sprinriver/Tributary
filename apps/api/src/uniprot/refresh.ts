// Public annotation plan, stage 1 (UNI-01): protein facts from UniProt for the accessions in published results,
// stored as reference rows (target_annotation) with the UniProt release and retrieval time. A refresh soft-deletes
// the previous UniProt rows of the accessions it asked about, so earlier releases stay readable; it never edits.
// Only UniProt-format accessions leave the installation; synthetic or in-house identifiers are never sent.
import { DATASET_CONTRACTS, QueryResultSchema, type UniprotRefreshResult } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import { requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { latestReleases } from '../datasets/latest-releases.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';
import { fetchUniprotEntries, UNIPROT_ACCESSION, type UniprotEntry } from './client.ts';

export type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };

const SOURCE = 'UniProt';
/** Rows read per release; more is refused, never truncated. */
const MAX_ROWS = 500_000;
/** Experiment dataset kinds whose contract carries protein accessions. */
const KINDS = Object.values(DATASET_CONTRACTS)
  .filter((c) => c.category === 'experiment' && c.columns.some((col) => col.name === 'protein_ids'))
  .map((c) => c.kind);

/** Distinct identifiers in the protein_ids of the latest published release of every experiment (all programs). */
async function identifiersInResults(deps: Deps): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const kind of KINDS) {
    for (const release of await latestReleases(deps.db, kind, null)) {
      const ref = { releaseIds: [release.release_id] };
      const source = await resolveSource(deps.db, ref, [release.program_id]);
      if (!source || ('releases' in source && source.releases.length === 0)) continue;
      const result = QueryResultSchema.parse(
        await callQueryService(deps.fetch, deps.config, '/internal/query', {
          spec: { source: ref, select: ['protein_ids'] },
          source,
          joins: [],
          all_rows: MAX_ROWS,
        }),
      );
      if (result.totalRows > result.rows.length || result.nextCursor)
        throw new HttpError(
          422,
          'too_many_rows',
          `${release.dataset_name} has more than ${MAX_ROWS.toLocaleString('en')} rows; it cannot be read whole.`,
        );
      for (const row of result.rows) {
        const value = row.protein_ids;
        for (const id of Array.isArray(value) ? value : [])
          if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }
  }
  return ids;
}

function rowsOf(entry: UniprotEntry): { key: string; value: string }[] {
  const facts: [string, string | null][] = [
    ['protein_name', entry.proteinName],
    ['function', entry.function],
    ['subcellular_location', entry.locations.length ? entry.locations.join('; ') : null],
    ['organism', entry.organism],
  ];
  return facts.flatMap(([key, value]) => (value === null ? [] : [{ key, value }]));
}

export async function refreshUniprot(deps: Deps, request: FastifyRequest): Promise<UniprotRefreshResult> {
  const principal = requirePrincipal(request);
  const found = await identifiersInResults(deps);
  const curated = await deps.db
    .selectFrom('target_annotation')
    .select('uniprot_accession')
    .distinct()
    .where('tenant_id', '=', principal.tenantId)
    .where('deleted_at', 'is', null)
    .execute();
  for (const r of curated) found.add(r.uniprot_accession);

  const accessions = [...found].filter((id) => UNIPROT_ACCESSION.test(id)).sort();
  const skipped = found.size - accessions.length;
  const batch = await fetchUniprotEntries(deps.fetch, deps.config.uniprotUrl, accessions);
  const returned = new Map(batch.entries.map((e) => [e.accession, e]));
  const stored = accessions.filter((a) => returned.has(a));
  const result: UniprotRefreshResult = {
    source: SOURCE,
    release: batch.release,
    release_date: batch.releaseDate,
    requested: accessions.length,
    updated: stored.length,
    not_found: accessions.filter((a) => !returned.has(a)),
    skipped,
  };

  const now = new Date();
  const base = { tenant_id: principal.tenantId, created_by: principal.userId };
  await deps.db.transaction().execute(async (trx) => {
    if (accessions.length)
      await trx
        .updateTable('target_annotation')
        .set({ deleted_at: now })
        .where('tenant_id', '=', principal.tenantId)
        .where('source', '=', SOURCE)
        .where('uniprot_accession', 'in', accessions)
        .where('deleted_at', 'is', null)
        .execute();
    const rows = stored.flatMap((accession) => {
      const entry = returned.get(accession)!;
      return rowsOf(entry).map(({ key, value }) => ({
        ...base,
        uniprot_accession: accession,
        gene_symbol: entry.gene,
        family: null,
        key,
        value,
        source: SOURCE,
        source_release: batch.release,
        retrieved_at: now,
      }));
    });
    for (let i = 0; i < rows.length; i += 500)
      await trx
        .insertInto('target_annotation')
        .values(rows.slice(i, i + 500))
        .execute();
    await writeAudit(trx, request, {
      action: 'reference.uniprot_refresh',
      entityType: 'reference',
      entityId: principal.tenantId,
      after: { ...result, not_found: result.not_found.length },
    });
  });
  return result;
}
