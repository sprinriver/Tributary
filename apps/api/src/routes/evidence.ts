// Compound target evidence (Phase 49, EVD-01). Read-only: nothing is stored or audited.
import { TargetEvidenceQuerySchema, TargetEvidenceSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parse } from '../errors.ts';
import { targetEvidence } from '../evidence/target-evidence.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerEvidenceRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  app.get('/v1/compounds/:id/target-evidence', async (request: IdParams) => {
    const query = parse(TargetEvidenceQuerySchema, request.query);
    const principal = requirePrincipal(request);
    const { counts, ...result } = await targetEvidence(
      deps,
      readablePrograms(principal),
      request.params.id,
      query,
    );
    const t = result.thresholds;
    const items = result.proteins.flatMap((p) => [
      ...(p.thermal?.rows ?? []).map((r) => r.matched_by),
      ...(p.annotation ? [p.annotation.matched_by] : []),
    ]);
    const byGene = items.filter((m) => m !== 'accession').length;
    const unmatched = items.filter((m) => m === 'gene symbol only').length;
    const noSpecies = [...result.sources.thermal_shift].filter((s) => s.species === null).length;
    const groups = result.proteins.filter((p) => p.ambiguous_group).length;
    return respond(TargetEvidenceSchema, {
      ...result,
      notes: result.program_id
        ? [
            'No combined score: each line of evidence has its own criterion. Proteins are ordered by measured lines (dose-response, thermal shift), then annotation, then potency; agreement is a reason to look closer, not a measure of confidence. Annotations are prior knowledge, not a measurement.',
            `Dose-response: counted when the tool called a curve regulated with pEC50 ≥ ${t.pec50_min}. Each row says in how many datasets the protein was tested and regulated, and names the experiment of the most potent curve; potencies are not pooled. pEC50 is apparent potency in that assay, not a binding constant.`,
            `Thermal shift: when TPP's replicate checks exist (two treatment and two vehicle experiments), they decide; otherwise every comparison of a dataset must have adjusted p ≤ ${t.adj_p_max} with the same ΔTm sign. Stabilisation and destabilisation both count; "inconsistent" means the signs differ. A comparison without p did not pass TPP's curve filter.`,
            'Annotation: primary targets and off-targets from this program’s target-annotation datasets. Only this program’s data and annotations are used: compound IDs are unique within a program.',
            ...(byGene
              ? [
                  `${byGene} evidence item(s) were matched by gene symbol${unmatched ? ` (${unmatched} could not be matched to an accession)` : ''}. The annotations record no species, so symbols are matched only for human experiments${noSpecies ? ' or experiments without a recorded species (assumed human)' : ''}.`,
                ]
              : []),
            ...(counts.nonHumanSpecies.length
              ? [
                  `Gene symbols from ${[...new Set(counts.nonHumanSpecies)].join(', ')} experiments are not matched to the annotations.`,
                ]
              : []),
            ...(groups
              ? [
                  `${groups} protein(s) carry evidence from a protein group of several accessions, attached to the annotated member (else the first); the group is named on each curve.`,
                ]
              : []),
            ...(counts.unclear
              ? [`${counts.unclear} curve(s) the tool left unclassified are not counted.`]
              : []),
            ...(counts.regulatedWithoutPec50
              ? [
                  `${counts.regulatedWithoutPec50} regulated curve(s) have no pEC50 and cannot meet the threshold.`,
                ]
              : []),
          ]
        : [],
    });
  });
}
