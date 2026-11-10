// Compound selectivity profile (Phase 42, SEL-02). Read-only: nothing is stored or audited.
import { SelectivityQuerySchema, SelectivityResponseSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { selectivityFigure } from '../selectivity/figure.ts';
import { selectivityProfile } from '../selectivity/profile.ts';
import { curvesOf, knownTargets, profilingExperiments } from '../selectivity/read.ts';

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
      await knownTargets(deps, readablePrograms(principal), compoundId),
      { pec50Min: query.pec50_min, direction: query.direction },
    );
    const notes = [
      `pEC50 (−log10 EC50 in M) is ${chosen.method ?? 'the source tool'}'s apparent potency in this assay, not a binding constant (Kd): S(x) here is not comparable with Kd-based panel scores.`,
      'Tested: proteins whose curve the tool classed (up, down or not) in this dataset. Regulated: the tool’s call. Potencies are never pooled across experiments.',
      'Whether a regulated curve means target engagement depends on the assay: in competition binding (e.g. affinity beads) binding shows as a decrease, so count "down" only; in thermal profiling both directions can mean engagement; in expression proteomics most calls are downstream effects.',
      `S(x) = proteins regulated (${query.direction === 'both' ? 'up or down' : `${query.direction} only`}) with pEC50 ≥ x / proteins tested (after Karaman et al. 2008, Nat Biotechnol 26:127, doi:10.1038/nbt1358).`,
      'Selectivity window = pEC50 of the most potent regulated annotated primary target − pEC50 of the most potent other regulated protein (annotated off-targets included); negative means another protein is more potent. Annotations: the target-annotation datasets you can read, as in the Targets table.',
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
}
