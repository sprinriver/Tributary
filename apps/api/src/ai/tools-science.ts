// Science tools (Phase 50, AI-06): read-only summaries of the target-evidence, selectivity and modification-site pages
// for the assistant and MCP clients. They call the API as the user and pass its notes on unchanged; nothing is computed
// here beyond trimming the answer to what a model can read.
import type { ProteinSites, SelectivityResponse, TargetEvidence } from '@tributary/contracts';
import { z } from 'zod';
import type { AiTool } from './tools.ts';

const MAX_ITEMS = 25;
const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();
const enc = encodeURIComponent;

type Protein = TargetEvidence['proteins'][number];
const doseText = (p: Protein, name: (id: string) => string) =>
  !p.dose
    ? 'not measured'
    : p.dose.best
      ? `pEC50 ${p.dose.best.pec50 ?? 'none'}, ${p.dose.best.regulation} (${name(p.dose.best.release_id)}); regulated in ${p.dose.regulated} of ${p.dose.tested} dataset(s)`
      : `tested, not regulated (${p.dose.tested} dataset${p.dose.tested === 1 ? '' : 's'})`;
const thermalText = (p: Protein) =>
  !p.thermal
    ? 'not measured'
    : `${p.thermal.direction}; TPP replicate checks ${p.thermal.replicate_checks}; ${p.thermal.rows.length} comparison(s)`;

export const SCIENCE_TOOLS: AiTool[] = [
  {
    name: 'get_target_evidence',
    description:
      'Target evidence of a compound within one program: per protein, dose-response (tested/regulated/most potent), TPP thermal shift (replicate checks, direction) and annotation, each against its own criterion. No combined score. Returns at most 25 proteins, the notes to quote, and the page link.',
    risk: 'read',
    input: z.object({
      compound_id: z.string().min(1),
      program_id: z.uuid().optional(),
      pec50_min: z.number().min(3).max(12).optional(),
      adj_p_max: z.number().gt(0).max(1).optional(),
    }),
    async run(
      ctx,
      input: { compound_id: string; program_id?: string; pec50_min?: number; adj_p_max?: number },
    ) {
      const { compound_id, ...rest } = input;
      const e = (await ctx.call(
        'GET',
        `/v1/compounds/${enc(compound_id)}/target-evidence?${qs(rest)}`,
      )) as TargetEvidence;
      const sources = [...e.sources.dose_response, ...e.sources.thermal_shift];
      const name = (id: string) => sources.find((s) => s.release_id === id)?.experiment_name ?? 'unknown';
      return {
        compound_id,
        program_id: e.program_id,
        programs: e.programs.map((p) => p.program_code),
        thresholds: e.thresholds,
        sources: sources.map((s) => `${s.experiment_name} · ${s.dataset_name} (${s.features} features)`),
        total_proteins: e.proteins.length,
        proteins: e.proteins.slice(0, MAX_ITEMS).map((p) => ({
          accession: p.accession,
          gene: p.gene,
          lines: p.lines,
          annotation: p.annotation?.role ?? null,
          dose: doseText(p, name),
          thermal: thermalText(p),
          ...(p.ambiguous_group ? { from_protein_group: true } : {}),
        })),
        notes: e.notes,
        page: `/compounds/${enc(compound_id)}`,
      };
    },
  },
  {
    name: 'get_compound_selectivity',
    description:
      'Selectivity of a compound in one profiling (dose-response) experiment: proteins tested and regulated, S(x) at a pEC50 threshold, the selectivity window and the 10 most potent regulated proteins, with the page notes and link.',
    risk: 'read',
    input: z.object({
      compound_id: z.string().min(1),
      release_id: z.uuid().optional(),
      pec50_min: z.number().min(3).max(12).optional(),
      direction: z.enum(['both', 'down', 'up']).optional(),
    }),
    async run(
      ctx,
      input: { compound_id: string; release_id?: string; pec50_min?: number; direction?: string },
    ) {
      const { compound_id, ...rest } = input;
      const r = (await ctx.call(
        'GET',
        `/v1/compounds/${enc(compound_id)}/selectivity?${qs(rest)}`,
      )) as SelectivityResponse;
      const p = r.profile;
      const chosen = r.experiments.find((x) => x.release_id === r.provenance.release_id);
      return {
        compound_id,
        experiment: chosen ? `${chosen.experiment_name} · ${chosen.dataset_name}` : null,
        other_experiments: r.experiments.length - (chosen ? 1 : 0),
        tested: p?.tested ?? 0,
        regulated: p?.regulated ?? 0,
        s_score: p?.s_score.score ?? null,
        s_regulated: p?.s_score.regulated ?? null,
        s_threshold: p ? { pec50_min: p.s_score.pec50_min, direction: p.s_score.direction } : null,
        window: p ? (p.window.delta ?? p.window.note) : null,
        top: (p?.proteins ?? []).slice(0, 10).map((x) => ({
          feature_id: x.feature_id,
          genes: x.genes,
          pec50: x.pec50,
          regulation: x.regulation,
          annotation: x.known,
        })),
        notes: [...(p?.notes ?? []), ...r.provenance.notes],
        page: `/compounds/${enc(compound_id)}`,
      };
    },
  },
  {
    name: 'get_protein_sites',
    description:
      'Modification sites of a protein (UniProt accession) across the site datasets the user can read: residue, position, best localisation probability against a display threshold, samples quantified. At most 25 sites, with the notes and page link.',
    risk: 'read',
    input: z.object({ accession: z.string().min(1), loc_min: z.number().gt(0).max(1).optional() }),
    async run(ctx, input: { accession: string; loc_min?: number }) {
      const r = (await ctx.call(
        'GET',
        `/v1/proteins/${enc(input.accession)}/sites?${qs({ loc_min: input.loc_min })}`,
      )) as ProteinSites;
      const name = (id: string) => r.releases.find((x) => x.release_id === id)?.experiment_name ?? 'unknown';
      return {
        accession: input.accession,
        loc_min: r.loc_min,
        total_sites: r.sites.length,
        sites: r.sites.slice(0, MAX_ITEMS).map((s) => ({
          site_id: s.site_id,
          residue: `${s.amino_acid}${s.position ?? ''}`,
          modification: s.modification,
          localization_prob: s.localization_prob,
          meets_threshold: s.meets_threshold,
          samples_quantified: `${s.samples_quantified} / ${s.samples_total}`,
          also_on: s.shared_with,
          experiment: name(s.release_id),
        })),
        notes: r.notes,
        page: `/proteins/${enc(input.accession)}`,
      };
    },
  },
];
