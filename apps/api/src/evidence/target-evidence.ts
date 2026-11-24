// Target evidence of a compound (Phase 49, EVD-01): per protein, within one program, the compound's dose-response
// curves (tested / regulated / most potent), its TPP comparisons and its target annotation. Each line of evidence has
// its own criterion; nothing is weighted or combined. Data reading is in ./read.ts.
import type { TargetEvidence } from '@tributary/contracts';
import { curvesOf, knownTargets, profilingExperiments } from '../selectivity/read.ts';
import { buildEvidence, type EvidenceCounts, type EvidenceInput } from './build.ts';
import { geneMap, isHuman, speciesOf, thermalReleases, thermalRows, type Deps } from './read.ts';

type Protein = TargetEvidence['proteins'][number];
type Source = TargetEvidence['sources']['dose_response'][number];

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
  const result = {
    compound_id: compoundId,
    program_id: programId,
    programs,
    thresholds: { pec50_min: q.pec50_min, adj_p_max: q.adj_p_max },
    sources: { dose_response: [] as Source[], thermal_shift: [] as Source[] },
    proteins: [] as Protein[],
    counts: { unclear: 0, regulatedWithoutPec50: 0, nonHumanSpecies: [] } as EvidenceCounts,
  };
  if (!programId) return result;

  const known = await knownTargets(deps, [programId], compoundId);
  const genes = await geneMap(deps, programId);
  const doseIn: EvidenceInput['dose'] = [];
  for (const d of dose.filter((x) => x.program_id === programId)) {
    const curves = await curvesOf(deps, d.release_id, compoundId);
    result.sources.dose_response.push({
      ...src(d),
      features: curves.length,
      species: await speciesOf(deps, d.version_id),
    });
    doseIn.push({ release_id: d.release_id, curves });
  }
  const thermalIn: EvidenceInput['thermal'] = [];
  for (const r of thermal.filter((x) => x.program_id === programId)) {
    const species = await speciesOf(deps, r.version_id);
    const rows = await thermalRows(deps, r.release_id, programId, compoundId);
    result.sources.thermal_shift.push({
      ...src(r),
      features: new Set(rows.map((x) => String(x.feature_id))).size,
      species,
    });
    thermalIn.push({ release_id: r.release_id, human: isHuman(species), species, rows });
  }
  const built = buildEvidence({
    known,
    genes,
    dose: doseIn,
    thermal: thermalIn,
    thresholds: result.thresholds,
  });
  return { ...result, proteins: built.proteins, counts: built.counts };
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
