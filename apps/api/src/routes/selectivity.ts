// Compound selectivity profile (Phase 42, SEL-02). Read-only: nothing is stored or audited.
import {
  SelectivityQuerySchema,
  SelectivityResponseSchema,
  SelectivityTableQuerySchema,
  SelectivityTableSchema,
  type SelectivityTable,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { selectivityFigure } from '../selectivity/figure.ts';
import { selectivityProfile } from '../selectivity/profile.ts';
import { methodLabel, orderRows, rowStatus } from '../selectivity/table.ts';
import {
  curvesByCompound,
  curvesOf,
  doseResponseReleases,
  knownTargets,
  knownTargetsByCompound,
  profilingExperiments,
} from '../selectivity/read.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerSelectivityRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  app.get('/v1/compounds/:id/selectivity', async (request: IdParams) => {
    const query = parse(SelectivityQuerySchema, request.query);
    const principal = requirePrincipal(request);
    const compoundId = request.params.id;
    const experiments = await profilingExperiments(deps, readablePrograms(principal), compoundId);
    const chosen = experiments.find((e) => e.release_id === query.release_id) ?? experiments[0];
    if (!chosen)
      return respond(SelectivityResponseSchema, {
        compound_id: compoundId,
        experiments,
        version_id: null,
        profile: null,
        figure: null,
        provenance: { release_id: null, notes: [] },
      });
    const profile = selectivityProfile(
      await curvesOf(deps, chosen.release_id, compoundId),
      // The dataset's own program: compound IDs are unique within a program only.
      await knownTargets(deps, [chosen.program_id], compoundId),
      { pec50Min: query.pec50_min, direction: query.direction },
    );
    const notes = [
      `pEC50 (−log10 EC50 in M) is ${chosen.method ?? 'the source tool'}'s apparent potency in this assay, not a binding constant (Kd): S(x) here is not comparable with Kd-based panel scores.`,
      'Tested: proteins whose curve the tool classed (up, down or not) in this dataset. Regulated: the tool’s call. Potencies are never pooled across experiments.',
      'Whether a regulated curve means target engagement depends on the assay: in competition binding (e.g. affinity beads) binding shows as a decrease, so count "down" only; in thermal profiling both directions can mean engagement; in expression proteomics most calls are downstream effects.',
      `S(x) = proteins regulated (${query.direction === 'both' ? 'up or down' : `${query.direction} only`}) with pEC50 ≥ x / proteins tested (after Karaman et al. 2008, Nat Biotechnol 26:127, doi:10.1038/nbt1358).`,
      'Selectivity window = pEC50 of the most potent regulated annotated primary target − pEC50 of the most potent other regulated protein (annotated off-targets included); negative means another protein is more potent. Annotations: the target-annotation datasets of this experiment’s program.',
      ...(profile.regulated_without_pec50
        ? [
            `${profile.regulated_without_pec50} regulated protein(s) have no pEC50: they do not count towards S(x).`,
          ]
        : []),
    ];

    return respond(SelectivityResponseSchema, {
      compound_id: compoundId,
      experiments,
      version_id: chosen.version_id,
      profile,
      figure: profile.proteins.some((p) => p.pec50 !== null) ? selectivityFigure(profile) : null,
      provenance: { release_id: chosen.release_id, notes },
    });
  });

  /** Datasets read for one table (newest first; the rest are listed as skipped). */
  const MAX_DATASETS = 50;

  app.get('/v1/selectivity', async (request) => {
    const query = parse(SelectivityTableQuerySchema, request.query);
    const readable = readablePrograms(requirePrincipal(request));
    const releases = await doseResponseReleases(deps, readable, query.program_id);
    // Annotations per program: compound IDs are unique within a program only.
    const knownByProgram = new Map<string, Awaited<ReturnType<typeof knownTargetsByCompound>>>();
    const none = { accessions: new Map(), genes: new Map() };
    const rows: (SelectivityTable['items'][number] & { dataset: number })[] = [];
    const skipped: SelectivityTable['skipped'] = [];
    let withoutCompound = 0;
    for (const [i, r] of releases.entries()) {
      const read =
        i < MAX_DATASETS
          ? await curvesByCompound(deps, r.release_id)
          : { skipped: `only the ${MAX_DATASETS} newest datasets are read: choose a program` };
      if ('skipped' in read) {
        skipped.push({
          experiment_name: r.experiment_name,
          dataset_name: r.dataset_name,
          reason: read.skipped,
        });
        continue;
      }
      withoutCompound += read.withoutCompound;
      if (!knownByProgram.has(r.program_id))
        knownByProgram.set(r.program_id, await knownTargetsByCompound(deps, [r.program_id]));
      const known = knownByProgram.get(r.program_id)!;
      for (const [compoundId, c] of read.compounds) {
        const p = selectivityProfile(c.curves, known.get(compoundId) ?? none, {
          pec50Min: query.pec50_min,
          direction: query.direction,
        });
        const score = { s_regulated: p.s_score.regulated, s_score: p.s_score.score };
        rows.push({
          dataset: i,
          compound_id: compoundId,
          program_id: r.program_id,
          release_id: r.release_id,
          dataset_name: r.dataset_name,
          experiment_id: r.experiment_id,
          experiment_name: r.experiment_name,
          experiment_date: r.experiment_date,
          program_code: r.program_code,
          method: methodLabel(c.methods),
          tested: p.tested,
          unclassified: p.unclassified,
          regulated: p.regulated,
          regulated_down: p.regulated_down,
          regulated_up: p.regulated_up,
          regulated_without_pec50: p.regulated_without_pec50,
          ...score,
          status: rowStatus(score),
          primary: p.window.primary,
          window_delta: p.window.delta,
          window_note: p.window.note,
          flags: p.notes,
        });
      }
    }
    return respond(SelectivityTableSchema, {
      items: orderRows(rows),
      thresholds: {
        pec50_min: query.pec50_min,
        ec50_max_molar: Number((10 ** -query.pec50_min).toPrecision(12)),
        direction: query.direction,
      },
      skipped,
      notes: [
        'pEC50 is the source tool’s apparent potency in each assay, not a binding constant (Kd).',
        'Rows are grouped by profiling dataset, newest first. Compare S(x) only within a dataset: it depends on the assay, the doses and how many proteins were tested.',
        'Within a dataset: lowest S first. A compound with nothing regulated at the threshold is inactive there, not selective, and is listed after the ranked ones.',
        'S(x) = proteins regulated in the chosen direction with pEC50 ≥ x / proteins tested (after Karaman et al. 2008, doi:10.1038/nbt1358). Whether regulation means target engagement depends on the assay design.',
        ...(withoutCompound ? [`${withoutCompound} curve(s) without a compound ID are not listed.`] : []),
      ],
    });
  });
}
