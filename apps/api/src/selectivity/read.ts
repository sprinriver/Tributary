// Compound selectivity (Phase 42, SEL-02): which readable profiling experiments have curves for a compound, and the
// curves of the chosen one. A partial read is refused, never profiled.
import { QueryResultSchema, type SelectivityResponse } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';
import type { CurveRow, Known, KnownRole } from './profile.ts';

/** Curves read for the experiments list (all releases) and for one experiment. */
const MAX_ROWS = 500_000;

type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };
type Experiment = SelectivityResponse['experiments'][number];

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v));

async function query(deps: Deps, releaseIds: string[], compoundId: string, select: string[]) {
  const source = await resolveSource(deps.db, { releaseIds }, null);
  if (!source) return null;
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { releaseIds },
        select,
        where: { combinator: 'and', rules: [{ field: 'compound_id', operator: '=', value: compoundId }] },
      },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    throw new HttpError(
      422,
      'too_many_rows',
      `More than ${MAX_ROWS.toLocaleString('en')} curves for this compound: choose one experiment.`,
      'version_id',
    );
  return result.rows;
}

/** One curve of the compound in a release (to know whether it profiles the compound), or null. */
async function firstCurve(deps: Deps, releaseId: string, compoundId: string) {
  const source = await resolveSource(deps.db, { releaseIds: [releaseId] }, null);
  if (!source) return null;
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { releaseIds: [releaseId] },
        select: ['method'],
        where: { combinator: 'and', rules: [{ field: 'compound_id', operator: '=', value: compoundId }] },
      },
      source,
      joins: [],
      all_rows: 1,
    }),
  );
  return result.rows[0] ?? null;
}

/** Readable dose-response datasets (latest published release of each, in latest published versions), newest first. */
export async function doseResponseReleases(
  deps: Deps,
  readable: string[] | null,
  programId?: string,
): Promise<(Omit<Experiment, 'method'> & { program_id: string })[]> {
  if (readable?.length === 0) return [];
  let q = deps.db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      'r.id as release_id',
      'd.name as dataset_name',
      'v.id as version_id',
      'e.id as experiment_id',
      'e.name as experiment_name',
      'v.experiment_date',
      'p.code as program_code',
      'd.program_id',
      'r.published_at',
      'e.created_at',
    ])
    .distinctOn('d.id')
    .where('d.kind', '=', 'dose_response')
    .where('r.status', '=', 'published')
    .where('r.deleted_at', 'is', null)
    .where('d.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .where('v.is_latest_published', '=', true);
  if (readable) q = q.where('d.program_id', 'in', readable);
  if (programId) q = q.where('d.program_id', '=', programId);
  const releases = await q
    .orderBy('d.id')
    .orderBy('r.published_at', 'desc')
    .orderBy('r.id', 'desc')
    .execute();
  // Newest first: experiment date, else creation.
  const when = (r: (typeof releases)[number]) => iso(r.experiment_date) ?? iso(r.created_at) ?? '';
  return releases
    .sort((a, b) => when(b).localeCompare(when(a)) || b.release_id.localeCompare(a.release_id))
    .map((r) => ({
      version_id: r.version_id,
      experiment_id: r.experiment_id,
      experiment_name: r.experiment_name,
      experiment_date: iso(r.experiment_date),
      program_code: r.program_code,
      release_id: r.release_id,
      dataset_name: r.dataset_name,
      program_id: r.program_id,
    }));
}

/** The readable datasets that profile the compound (per release: one version can hold a dataset per compound). */
export async function profilingExperiments(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
): Promise<(Experiment & { program_id: string })[]> {
  const out: (Experiment & { program_id: string })[] = [];
  for (const r of await doseResponseReleases(deps, readable)) {
    const first = await firstCurve(deps, r.release_id, compoundId);
    if (first) out.push({ ...r, method: first.method == null ? null : String(first.method) });
  }
  return out;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

const toCurve = (r: Record<string, unknown>): CurveRow => ({
  feature_id: String(r.feature_id),
  protein_ids: r.protein_ids,
  gene_names: r.gene_names,
  pec50: num(r.pec50),
  regulation: String(r.regulation ?? ''),
  fdr: num(r.fdr),
  doses_molar: r.doses_molar,
});

/** Every compound's curves in one release (and the tool that fitted them), or why it was not read. */
export async function curvesByCompound(
  deps: Deps,
  releaseId: string,
): Promise<
  | { compounds: Map<string, { methods: Set<string>; curves: CurveRow[] }>; withoutCompound: number }
  | { skipped: string }
> {
  const source = await resolveSource(deps.db, { releaseIds: [releaseId] }, null);
  if (!source) return { skipped: 'release not readable' };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { releaseIds: [releaseId] },
        select: [
          'compound_id',
          'method',
          'feature_id',
          'protein_ids',
          'gene_names',
          'pec50',
          'regulation',
          'fdr',
          'doses_molar',
        ],
      },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    return { skipped: `more than ${MAX_ROWS.toLocaleString('en')} curves` };
  const compounds = new Map<string, { methods: Set<string>; curves: CurveRow[] }>();
  let withoutCompound = 0;
  for (const r of result.rows) {
    const id = String(r.compound_id ?? '');
    if (!id) {
      withoutCompound += 1;
      continue;
    }
    const entry = compounds.get(id) ?? { methods: new Set<string>(), curves: [] };
    if (r.method != null && String(r.method) !== '') entry.methods.add(String(r.method));
    entry.curves.push(toCurve(r));
    compounds.set(id, entry);
  }
  return { compounds, withoutCompound };
}

/** The compound's curves in one release. */
export async function curvesOf(deps: Deps, releaseId: string, compoundId: string): Promise<CurveRow[]> {
  const rows =
    (await query(deps, [releaseId], compoundId, [
      'feature_id',
      'protein_ids',
      'gene_names',
      'pec50',
      'regulation',
      'fdr',
      'doses_molar',
    ])) ?? [];
  return rows.map((r) => ({
    feature_id: String(r.feature_id),
    protein_ids: r.protein_ids,
    gene_names: r.gene_names,
    pec50: num(r.pec50),
    regulation: String(r.regulation ?? ''),
    fdr: num(r.fdr),
    doses_molar: r.doses_molar,
  }));
}

/**
 * Annotated targets of the compound, by UniProt accession without isoform suffix: the readable target-annotation
 * reference datasets (primary_target / off_target rows whose value is the compound), as the compound page's Targets
 * table and the volcano's known-target overlay read them.
 */
export async function knownTargets(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
): Promise<Known> {
  return (
    (await knownTargetsByCompound(deps, readable, compoundId)).get(compoundId) ?? {
      accessions: new Map(),
      genes: new Map(),
    }
  );
}

/**
 * The same for every compound (or one), keyed by compound ID. Pass the programs whose annotations apply: compound
 * IDs are unique within a program only, so callers pass the dataset's own program.
 */
export async function knownTargetsByCompound(
  deps: Deps,
  readable: string[] | null,
  compoundId?: string,
): Promise<Map<string, Known>> {
  const out = new Map<string, Known>();
  const source = await resolveSource(deps.db, { kind: 'target_annotation', scope: {} }, readable);
  if (!source || ('releases' in source && source.releases.length === 0)) return out;
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: {
        source: { kind: 'target_annotation', scope: {} },
        select: ['uniprot_accession', 'gene_symbol', 'key', 'value'],
        where: {
          combinator: 'and',
          rules: [
            { field: 'key', operator: 'in', value: ['primary_target', 'off_target'] },
            ...(compoundId ? [{ field: 'value', operator: '=', value: compoundId }] : []),
          ],
        },
      },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  // A protein annotated both ways counts as a primary target.
  const put = (map: Map<string, KnownRole>, key: string, role: KnownRole) => {
    if (key && map.get(key) !== 'primary_target') map.set(key, role);
  };
  for (const r of result.rows) {
    const compound = String(r.value ?? '');
    if (!compound) continue;
    const known = out.get(compound) ?? { accessions: new Map(), genes: new Map() };
    const role = r.key as KnownRole;
    put(
      known.accessions,
      String(r.uniprot_accession ?? '')
        .trim()
        .replace(/-\d+$/, ''),
      role,
    );
    put(
      known.genes,
      String(r.gene_symbol ?? '')
        .trim()
        .toUpperCase(),
      role,
    );
    out.set(compound, known);
  }
  return out;
}
