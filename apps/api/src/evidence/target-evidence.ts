// Target evidence of a compound (Phase 49, EVD-01): per protein, the most potent regulated dose-response curve, the
// thermal shifts of the compound's TPP comparisons and the target annotation, within one program. Each line of
// evidence is judged against its own stated threshold; nothing is weighted or combined.
import { QueryResultSchema, type TargetEvidence } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { latestReleases, type LatestRelease } from '../datasets/latest-releases.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { resolveSource } from '../query/resolve.ts';
import { curvesOf, knownTargets, profilingExperiments } from '../selectivity/read.ts';

type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };
type Row = Record<string, unknown>;
type Protein = TargetEvidence['proteins'][number];
type Source = TargetEvidence['sources']['dose_response'][number];

const MAX_ROWS = 500_000;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
/** UniProt accession without an isoform suffix, as target annotations key them. */
const base = (a: string) => a.trim().replace(/-\d+$/, '');

async function rows(
  deps: Deps,
  releaseIds: string[] | null,
  kind: 'thermal_shift' | 'target_annotation',
  programs: string[],
  select: string[],
  where: Row[],
) {
  const ref = releaseIds ? { releaseIds } : { kind, scope: {} };
  const source = await resolveSource(deps.db, ref as never, programs);
  if (!source || ('releases' in source && source.releases.length === 0)) return [];
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: { source: ref, select, where: { combinator: 'and', rules: where } },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  return result.rows;
}

/** Gene symbol (upper case) → accession from the program's target-annotation datasets; ambiguous symbols are left out. */
async function geneMap(
  deps: Deps,
  programId: string,
): Promise<{ toAcc: Map<string, string>; toGene: Map<string, string> }> {
  const found = await rows(
    deps,
    null,
    'target_annotation',
    [programId],
    ['uniprot_accession', 'gene_symbol'],
    [],
  );
  const byGene = new Map<string, Set<string>>();
  const toGene = new Map<string, string>();
  for (const r of found) {
    const acc = r.uniprot_accession == null ? '' : base(String(r.uniprot_accession));
    const gene = r.gene_symbol == null ? '' : String(r.gene_symbol).trim();
    if (!acc || !gene) continue;
    byGene.set(gene.toUpperCase(), new Set([...(byGene.get(gene.toUpperCase()) ?? []), acc]));
    if (!toGene.has(acc)) toGene.set(acc, gene);
  }
  const toAcc = new Map(
    [...byGene].filter(([, accs]) => accs.size === 1).map(([g, accs]) => [g, [...accs][0]!]),
  );
  return { toAcc, toGene };
}

const source = (r: LatestRelease | (Source & { program_id: string })): Source => ({
  release_id: r.release_id,
  experiment_id: r.experiment_id,
  version_id: r.version_id,
  experiment_name: r.experiment_name,
  dataset_name: r.dataset_name,
});

export async function targetEvidence(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
  q: { program_id?: string | undefined; pec50_min: number; adj_p_max: number },
): Promise<Omit<TargetEvidence, 'notes'>> {
  // Data releases with this compound, by program.
  const dose = (await profilingExperiments(deps, readable, compoundId)).map((e) => ({ ...e }));
  const thermalReleases: LatestRelease[] = [];
  for (const r of await latestReleases(deps.db, 'thermal_shift', readable)) {
    const any = await rows(
      deps,
      [r.release_id],
      'thermal_shift',
      [r.program_id],
      ['feature_id'],
      [{ field: 'compound_id', operator: '=', value: compoundId }],
    );
    if (any.length) thermalReleases.push(r);
  }
  const programCodes = new Map<string, string>();
  for (const r of [...dose, ...thermalReleases]) programCodes.set(r.program_id, r.program_code);
  const programs = [...programCodes].map(([program_id, program_code]) => ({ program_id, program_code }));
  const programId =
    programs.find((p) => p.program_id === q.program_id)?.program_id ?? programs[0]?.program_id ?? null;
  const empty = {
    compound_id: compoundId,
    program_id: programId,
    programs,
    thresholds: { pec50_min: q.pec50_min, adj_p_max: q.adj_p_max },
    sources: { dose_response: [], thermal_shift: [] },
    proteins: [],
  };
  if (!programId) return empty;

  const doseHere = dose.filter((d) => d.program_id === programId);
  const thermalHere = thermalReleases.filter((r) => r.program_id === programId);
  const known = await knownTargets(deps, [programId], compoundId);
  const genes = await geneMap(deps, programId);
  const byKey = new Map<string, Protein>();
  const entry = (accession: string | null, gene: string | null): Protein => {
    const g = gene ? gene.toUpperCase() : null;
    const acc = accession ?? (g ? (genes.toAcc.get(g) ?? null) : null);
    const key = acc ?? `gene:${g}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const p: Protein = {
      key,
      accession: acc,
      gene: (acc ? genes.toGene.get(acc) : null) ?? gene,
      matched_by: accession ? 'accession' : acc ? 'gene symbol via target annotations' : 'gene symbol only',
      annotation:
        (acc ? known.accessions.get(acc) : undefined) ?? (g ? known.genes.get(g) : undefined) ?? null,
      dose: null,
      thermal: [],
      lines: { dose: false, thermal: false, annotation: false },
    };
    byKey.set(key, p);
    return p;
  };

  // Dose-response: the most potent regulated curve per protein (first accession of the group).
  for (const d of doseHere)
    for (const c of await curvesOf(deps, d.release_id, compoundId)) {
      if (!['up', 'down'].includes(c.regulation)) continue;
      const acc = list(c.protein_ids)[0] ?? c.feature_id.split(';')[0]!;
      const p = entry(base(acc), list(c.gene_names)[0] ?? null);
      if (!p.dose || (c.pec50 ?? -Infinity) > (p.dose.pec50 ?? -Infinity))
        p.dose = {
          release_id: d.release_id,
          feature_id: c.feature_id,
          pec50: c.pec50,
          regulation: c.regulation,
          fdr: c.fdr,
        };
    }
  // Thermal shifts: every comparison of the compound.
  for (const r of thermalHere)
    for (const t of await rows(
      deps,
      [r.release_id],
      'thermal_shift',
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
    )) {
      const acc = list(t.protein_ids)[0];
      const p = entry(acc ? base(acc) : null, list(t.gene_names)[0] ?? (acc ? null : String(t.feature_id)));
      p.thermal.push({
        release_id: r.release_id,
        comparison: String(t.comparison),
        delta_tm: num(t.delta_tm),
        adj_p_value: num(t.adj_p_value),
        fulfills_all_requirements:
          typeof t.fulfills_all_requirements === 'boolean' ? t.fulfills_all_requirements : null,
      });
    }
  // Annotated targets without data still count as a line of evidence.
  for (const [acc] of known.accessions) entry(acc, null);

  const proteins = [...byKey.values()]
    .map((p) => ({
      ...p,
      lines: {
        dose: p.dose !== null && (p.dose.pec50 ?? -Infinity) >= q.pec50_min,
        thermal: p.thermal.some((t) => t.adj_p_value !== null && t.adj_p_value <= q.adj_p_max),
        annotation: p.annotation !== null,
      },
    }))
    .filter((p) => p.lines.dose || p.lines.thermal || p.lines.annotation)
    .sort((a, b) => {
      const n = (p: Protein) => Object.values(p.lines).filter(Boolean).length;
      const minP = (p: Protein) => Math.min(...p.thermal.map((t) => t.adj_p_value ?? Infinity));
      return (
        n(b) - n(a) ||
        (b.dose?.pec50 ?? -Infinity) - (a.dose?.pec50 ?? -Infinity) ||
        minP(a) - minP(b) ||
        a.key.localeCompare(b.key)
      );
    });
  return {
    ...empty,
    sources: { dose_response: doseHere.map(source), thermal_shift: thermalHere.map(source) },
    proteins,
  };
}
