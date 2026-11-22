// Target evidence of a compound (Phase 49, EVD-01): per protein, within one program, the compound's dose-response
// curves (tested / regulated / most potent), its TPP comparisons and its target annotation. Each line of evidence has
// its own criterion; nothing is weighted or combined. Data reading is in ./read.ts.
import type { TargetEvidence } from '@tributary/contracts';
import { curvesOf, knownTargets, profilingExperiments } from '../selectivity/read.ts';
import { geneMap, isHuman, speciesOf, thermalReleases, thermalRows, type Deps } from './read.ts';

type Protein = TargetEvidence['proteins'][number];
type Dose = NonNullable<Protein['dose']>;
type DoseItem = Dose['datasets'][number];
type Thermal = NonNullable<Protein['thermal']>;
type MatchedBy = DoseItem['matched_by'];
type Source = TargetEvidence['sources']['dose_response'][number];

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
/** UniProt accession without an isoform suffix, as target annotations key them. */
const base = (a: string) => a.trim().replace(/-\d+$/, '');
const CLASSED = ['up', 'down', 'not'];

interface Entry {
  p: Protein;
  doseByRelease: Map<string, DoseItem>;
  /** The gene symbol came from a human (or unrecorded-species) experiment, so annotations by gene may apply. */
  humanGene: boolean;
}

export interface EvidenceCounts {
  unclear: number;
  regulatedWithoutPec50: number;
  nonHumanSpecies: string[];
}

export async function targetEvidence(
  deps: Deps,
  readable: string[] | null,
  compoundId: string,
  q: { program_id?: string | undefined; pec50_min: number; adj_p_max: number },
): Promise<Omit<TargetEvidence, 'notes'> & { counts: EvidenceCounts }> {
  const dose = await profilingExperiments(deps, readable, compoundId);
  const thermal = await thermalReleases(deps, readable, compoundId);
  const codes = new Map<string, string>();
  for (const r of [...dose, ...thermal]) codes.set(r.program_id, r.program_code);
  const programs = [...codes].map(([program_id, program_code]) => ({ program_id, program_code }));
  const programId =
    programs.find((p) => p.program_id === q.program_id)?.program_id ?? programs[0]?.program_id ?? null;
  const counts: EvidenceCounts = { unclear: 0, regulatedWithoutPec50: 0, nonHumanSpecies: [] };
  const result = {
    compound_id: compoundId,
    program_id: programId,
    programs,
    thresholds: { pec50_min: q.pec50_min, adj_p_max: q.adj_p_max },
    sources: { dose_response: [] as Source[], thermal_shift: [] as Source[] },
    proteins: [] as Protein[],
    counts,
  };
  if (!programId) return result;

  const known = await knownTargets(deps, [programId], compoundId);
  const genes = await geneMap(deps, programId);
  const entries = new Map<string, Entry>();
  const entry = (accession: string | null, gene: string | null, humanGene: boolean): Entry => {
    const key = accession ?? `gene:${gene}`;
    let e = entries.get(key);
    if (!e) {
      e = {
        p: {
          key,
          accession,
          gene: (accession ? genes.toGene.get(accession) : null) ?? gene,
          ambiguous_group: false,
          annotation: null,
          dose: null,
          thermal: null,
          lines: { dose: false, thermal: false, annotation: false },
        },
        doseByRelease: new Map(),
        humanGene,
      };
      entries.set(key, e);
    }
    return e;
  };

  // Dose-response: one curve per protein and dataset; a protein group goes to its annotated member, else its first.
  for (const d of dose.filter((x) => x.program_id === programId)) {
    const curves = await curvesOf(deps, d.release_id, compoundId);
    result.sources.dose_response.push({
      ...src(d),
      features: curves.length,
      species: await speciesOf(deps, d.version_id),
    });
    for (const c of curves) {
      if (!CLASSED.includes(c.regulation)) {
        counts.unclear += 1;
        continue;
      }
      const members = [
        ...new Set((list(c.protein_ids).length ? list(c.protein_ids) : c.feature_id.split(';')).map(base)),
      ];
      const target = members.find((m) => known.accessions.has(m)) ?? members[0]!;
      const e = entry(target, list(c.gene_names)[0] ?? null, false);
      if (members.length > 1) e.p.ambiguous_group = true;
      const item: DoseItem = {
        release_id: d.release_id,
        feature_id: c.feature_id,
        pec50: c.pec50,
        regulation: c.regulation,
        fdr: c.fdr,
        matched_by: 'accession',
      };
      const prev = e.doseByRelease.get(d.release_id);
      const regulated = (x: DoseItem) => x.regulation !== 'not';
      if (
        !prev ||
        (regulated(item) && (!regulated(prev) || (item.pec50 ?? -Infinity) > (prev.pec50 ?? -Infinity)))
      )
        e.doseByRelease.set(d.release_id, item);
    }
  }

  // Thermal shifts: every comparison row of the compound. Gene symbols map to accessions only for human experiments.
  const thermalRowsByKey = new Map<string, Thermal['rows']>();
  for (const r of thermal.filter((x) => x.program_id === programId)) {
    const species = await speciesOf(deps, r.version_id);
    const human = isHuman(species);
    if (!human && species) counts.nonHumanSpecies.push(species);
    const rows = await thermalRows(deps, r.release_id, programId, compoundId);
    result.sources.thermal_shift.push({
      ...src(r),
      features: new Set(rows.map((x) => String(x.feature_id))).size,
      species,
    });
    for (const t of rows) {
      const acc = list(t.protein_ids)[0];
      const gene = list(t.gene_names)[0] ?? (acc ? null : String(t.feature_id));
      const mapped = !acc && gene && human ? (genes.toAcc.get(gene.toUpperCase()) ?? null) : null;
      const matched: MatchedBy = acc
        ? 'accession'
        : mapped
          ? 'gene symbol via target annotations'
          : 'gene symbol only';
      const e = entry(acc ? base(acc) : mapped, gene, human);
      if (!thermalRowsByKey.has(e.p.key)) thermalRowsByKey.set(e.p.key, []);
      thermalRowsByKey.get(e.p.key)!.push({
        release_id: r.release_id,
        feature_id: String(t.feature_id),
        comparison: String(t.comparison),
        delta_tm: num(t.delta_tm),
        adj_p_value: num(t.adj_p_value),
        fulfills_all_requirements:
          typeof t.fulfills_all_requirements === 'boolean' ? t.fulfills_all_requirements : null,
        matched_by: matched,
      });
    }
  }
  for (const [acc] of known.accessions) entry(acc, null, false);

  for (const e of entries.values()) {
    const p = e.p;
    // Annotation: by accession, else by gene symbol (human experiments only).
    const byAcc = p.accession ? known.accessions.get(p.accession) : undefined;
    const byGene =
      !byAcc && !p.accession && e.humanGene && p.gene ? known.genes.get(p.gene.toUpperCase()) : undefined;
    p.annotation = byAcc
      ? { role: byAcc, matched_by: 'accession' }
      : byGene
        ? { role: byGene, matched_by: 'gene symbol only' }
        : null;
    if (e.doseByRelease.size) p.dose = doseSummary([...e.doseByRelease.values()], counts);
    const rows = thermalRowsByKey.get(p.key);
    if (rows?.length) p.thermal = thermalSummary(rows);
    p.lines = {
      dose: !!p.dose?.best && (p.dose.best.pec50 ?? -Infinity) >= q.pec50_min,
      thermal: !!p.thermal && thermalLine(p.thermal, q.adj_p_max),
      annotation: p.annotation !== null,
    };
  }
  const measured = (p: Protein) => Number(p.lines.dose) + Number(p.lines.thermal);
  const minP = (p: Protein) => Math.min(...(p.thermal?.rows ?? []).map((t) => t.adj_p_value ?? Infinity));
  result.proteins = [...entries.values()]
    .map((e) => e.p)
    .filter((p) => measured(p) > 0 || p.lines.annotation)
    .sort(
      (a, b) =>
        measured(b) - measured(a) ||
        Number(b.lines.annotation) - Number(a.lines.annotation) ||
        (b.dose?.best?.pec50 ?? -Infinity) - (a.dose?.best?.pec50 ?? -Infinity) ||
        minP(a) - minP(b) ||
        a.key.localeCompare(b.key),
    );
  return result;
}

const src = (r: {
  release_id: string;
  experiment_id: string;
  version_id: string;
  experiment_name: string;
  dataset_name: string;
}) => ({
  release_id: r.release_id,
  experiment_id: r.experiment_id,
  version_id: r.version_id,
  experiment_name: r.experiment_name,
  dataset_name: r.dataset_name,
});

function doseSummary(items: DoseItem[], counts: EvidenceCounts): Dose {
  const regulated = items.filter((x) => x.regulation !== 'not');
  counts.regulatedWithoutPec50 += regulated.filter((x) => x.pec50 === null).length;
  const best = [...regulated].sort((a, b) => (b.pec50 ?? -Infinity) - (a.pec50 ?? -Infinity))[0] ?? null;
  return { tested: items.length, regulated: regulated.length, best, datasets: items };
}

function thermalSummary(rows: Thermal['rows']): Thermal {
  const checks = rows.map((r) => r.fulfills_all_requirements).filter((x): x is boolean => x !== null);
  const signs = new Set(
    rows
      .map((r) => r.delta_tm)
      .filter((d): d is number => d !== null && d !== 0)
      .map(Math.sign),
  );
  return {
    basis: checks.length ? 'tpp_requirements' : 'all_comparisons',
    replicate_checks: !checks.length ? 'not computed' : checks.some(Boolean) ? 'met' : 'not met',
    direction:
      signs.size === 0
        ? 'none'
        : signs.size > 1
          ? 'inconsistent'
          : signs.has(1)
            ? 'stabilised'
            : 'destabilised',
    rows,
  };
}

/** TPP's replicate checks when present; otherwise every comparison of a dataset passes, with one ΔTm sign. */
function thermalLine(t: Thermal, adjPMax: number): boolean {
  if (t.basis === 'tpp_requirements') return t.rows.some((r) => r.fulfills_all_requirements === true);
  const byRelease = new Map<string, Thermal['rows']>();
  for (const r of t.rows) byRelease.set(r.release_id, [...(byRelease.get(r.release_id) ?? []), r]);
  return [...byRelease.values()].some((rows) => {
    const signs = new Set(rows.map((r) => (r.delta_tm === null ? 0 : Math.sign(r.delta_tm))));
    return (
      rows.every((r) => r.adj_p_value !== null && r.adj_p_value <= adjPMax) &&
      signs.size === 1 &&
      !signs.has(0)
    );
  });
}
