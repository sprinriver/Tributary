// Compound × protein evidence matrix (Phase 51, EVD-03): for one program, every compound with dose-response or TPP
// data, built with the compound page's rules (./build.ts). Each dataset is read once, for all its compounds.
import type { EvidenceMatrix } from '@tributary/contracts';
import { latestReleases } from '../datasets/latest-releases.ts';
import { curvesByCompound, knownTargetsByCompound } from '../selectivity/read.ts';
import { buildEvidence, type EvidenceInput } from './build.ts';
import { allThermalRows, geneMap, isHuman, speciesOf, type Deps } from './read.ts';

type Cell = EvidenceMatrix['proteins'][number]['cells'][string];

export async function evidenceMatrix(
  deps: Deps,
  readable: string[] | null,
  q: {
    program_id?: string | undefined;
    pec50_min: number;
    adj_p_max: number;
    max_proteins: number;
    max_compounds: number;
  },
): Promise<Omit<EvidenceMatrix, 'notes'> & { skipped: string[] }> {
  const dose = await latestReleases(deps.db, 'dose_response', readable);
  const thermal = await latestReleases(deps.db, 'thermal_shift', readable);
  const codes = new Map<string, string>();
  for (const r of [...dose, ...thermal]) codes.set(r.program_id, r.program_code);
  const programs = [...codes].map(([program_id, program_code]) => ({ program_id, program_code }));
  const programId =
    programs.find((p) => p.program_id === q.program_id)?.program_id ?? programs[0]?.program_id ?? null;
  const thresholds = { pec50_min: q.pec50_min, adj_p_max: q.adj_p_max };
  const empty = {
    program_id: programId,
    programs,
    thresholds,
    compounds: [],
    proteins: [],
    truncated: { compounds: 0, proteins: 0 },
    skipped: [] as string[],
  };
  if (!programId) return empty;

  // Read each dataset once and split it by compound.
  const skipped: string[] = [];
  const doseBy = new Map<string, EvidenceInput['dose']>();
  for (const r of dose.filter((x) => x.program_id === programId)) {
    const read = await curvesByCompound(deps, r.release_id);
    if ('skipped' in read) {
      skipped.push(`${r.experiment_name} · ${r.dataset_name} (${read.skipped})`);
      continue;
    }
    for (const [compound, { curves }] of read.compounds)
      doseBy.set(compound, [...(doseBy.get(compound) ?? []), { release_id: r.release_id, curves }]);
  }
  const thermalBy = new Map<string, EvidenceInput['thermal']>();
  for (const r of thermal.filter((x) => x.program_id === programId)) {
    const species = await speciesOf(deps, r.version_id);
    const byCompound = new Map<string, Record<string, unknown>[]>();
    for (const row of await allThermalRows(deps, r.release_id, programId)) {
      const c = String(row.compound_id ?? '');
      if (c) byCompound.set(c, [...(byCompound.get(c) ?? []), row]);
    }
    for (const [compound, rows] of byCompound)
      thermalBy.set(compound, [
        ...(thermalBy.get(compound) ?? []),
        { release_id: r.release_id, human: isHuman(species), species, rows },
      ]);
  }
  const knownBy = await knownTargetsByCompound(deps, [programId]);
  const genes = await geneMap(deps, programId);
  const allCompounds = [...new Set([...doseBy.keys(), ...thermalBy.keys()])].sort();
  const compounds = allCompounds.slice(0, q.max_compounds);

  const rows = new Map<string, EvidenceMatrix['proteins'][number]>();
  for (const compound of compounds) {
    const { proteins } = buildEvidence({
      known: knownBy.get(compound) ?? { accessions: new Map(), genes: new Map() },
      genes,
      dose: doseBy.get(compound) ?? [],
      thermal: thermalBy.get(compound) ?? [],
      thresholds,
    });
    for (const p of proteins) {
      const row = rows.get(p.key) ?? {
        key: p.key,
        accession: p.accession,
        gene: p.gene,
        measured_compounds: 0,
        cells: {},
      };
      const cell: Cell = {
        dose: p.lines.dose,
        thermal: p.lines.thermal,
        annotation: p.annotation?.role ?? null,
        pec50: p.dose?.best?.pec50 ?? null,
        direction: p.thermal?.direction ?? null,
      };
      row.cells[compound] = cell;
      if (cell.dose || cell.thermal) row.measured_compounds += 1;
      rows.set(p.key, row);
    }
  }
  // Rows: proteins with a measured line for at least one compound, most compounds first.
  const measured = [...rows.values()]
    .filter((r) => r.measured_compounds > 0)
    .sort((a, b) => b.measured_compounds - a.measured_compounds || a.key.localeCompare(b.key));
  return {
    ...empty,
    compounds: compounds.map((compound_id) => ({
      compound_id,
      dose_datasets: doseBy.get(compound_id)?.length ?? 0,
      thermal_datasets: thermalBy.get(compound_id)?.length ?? 0,
    })),
    proteins: measured.slice(0, q.max_proteins),
    truncated: {
      compounds: allCompounds.length - compounds.length,
      proteins: Math.max(0, measured.length - q.max_proteins),
    },
    skipped,
  };
}
