// Reads for target evidence (Phase 49): TPP releases and rows of a compound, the program's gene-symbol map, species.
import { QueryResultSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { latestReleases, type LatestRelease } from '../datasets/latest-releases.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';

export type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };
type Row = Record<string, unknown>;

/** Rows read per dataset; more is refused, never truncated. */
const MAX_ROWS = 500_000;
const HUMAN = 'NCBITaxon:9606';

async function rows(
  deps: Deps,
  ref: { releaseIds: string[] } | { kind: 'target_annotation'; scope: Record<string, never> },
  programs: string[],
  select: string[],
  where: Row[],
): Promise<Row[]> {
  const source = await resolveSource(deps.db, ref, programs);
  if (!source || ('releases' in source && source.releases.length === 0)) return [];
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: { source: ref, select, where: { combinator: 'and', rules: where } },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    throw new HttpError(
      422,
      'too_many_rows',
      `More than ${MAX_ROWS.toLocaleString('en')} rows in one dataset; target evidence cannot read it whole.`,
      'program_id',
    );
  return result.rows;
}

/** Readable TPP releases with rows for the compound. */
export async function thermalReleases(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
): Promise<LatestRelease[]> {
  const out: LatestRelease[] = [];
  for (const r of await latestReleases(deps.db, 'thermal_shift', readable)) {
    const any = await rows(
      deps,
      { releaseIds: [r.release_id] },
      [r.program_id],
      ['feature_id'],
      [{ field: 'compound_id', operator: '=', value: compoundId }],
    );
    if (any.length) out.push(r);
  }
  return out;
}

export const thermalRows = (deps: Deps, releaseId: string, programId: string, compoundId: string) =>
  rows(
    deps,
    { releaseIds: [releaseId] },
    [programId],
    [
      'feature_id',
      'protein_ids',
      'gene_names',
      'comparison',
      'delta_tm',
      'adj_p_value',
      'fulfills_all_requirements',
    ],
    [{ field: 'compound_id', operator: '=', value: compoundId }],
  );

/** Every TPP row of a release, with its compound (for the matrix). */
export const allThermalRows = (deps: Deps, releaseId: string, programId: string) =>
  rows(
    deps,
    { releaseIds: [releaseId] },
    [programId],
    [
      'compound_id',
      'feature_id',
      'protein_ids',
      'gene_names',
      'comparison',
      'delta_tm',
      'adj_p_value',
      'fulfills_all_requirements',
    ],
    [],
  );

/**
 * Gene symbol (upper case) → accession, and accession → gene symbol, from the program's target-annotation datasets.
 * The annotations record no species: callers use the map for human experiments only. Ambiguous symbols are left out.
 */
export async function geneMap(
  deps: Deps,
  programId: string,
): Promise<{ toAcc: Map<string, string>; toGene: Map<string, string> }> {
  const found = await rows(
    deps,
    { kind: 'target_annotation', scope: {} },
    [programId],
    ['uniprot_accession', 'gene_symbol'],
    [],
  );
  const byGene = new Map<string, Set<string>>();
  const toGene = new Map<string, string>();
  for (const r of found) {
    const acc = r.uniprot_accession == null ? '' : String(r.uniprot_accession).trim().replace(/-\d+$/, '');
    const gene = r.gene_symbol == null ? '' : String(r.gene_symbol).trim();
    if (!acc || !gene) continue;
    const g = gene.toUpperCase();
    byGene.set(g, new Set([...(byGene.get(g) ?? []), acc]));
    if (!toGene.has(acc)) toGene.set(acc, gene);
  }
  const toAcc = new Map([...byGene].filter(([, a]) => a.size === 1).map(([g, a]) => [g, [...a][0]!]));
  return { toAcc, toGene };
}

/** The experiment version's species (NCBITaxon id), or null when not recorded. */
export async function speciesOf(deps: Deps, versionId: string): Promise<string | null> {
  const row = await deps.db
    .selectFrom('experiment_version')
    .select('species')
    .where('id', '=', versionId)
    .executeTakeFirst();
  const species = row?.species as { id?: unknown } | null | undefined;
  return typeof species?.id === 'string' ? species.id : null;
}

/** Human, or not recorded (then the annotations' human gene symbols are assumed, and the notes say so). */
export const isHuman = (species: string | null) => species === null || species === HUMAN;
