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
    const result = await targetEvidence(deps, readablePrograms(principal), request.params.id, query);
    const mappedByGene = result.proteins.filter((p) => p.matched_by !== 'accession').length;
    return respond(TargetEvidenceSchema, {
      ...result,
      notes: result.program_id
        ? [
            'No combined score: each line of evidence is judged against its own threshold, and proteins are ordered by how many lines they have, then by potency. Agreement between lines is a reason to look closer, not a measure of confidence.',
            `Dose-response: the most potent curve the tool called regulated in any of this program’s profiling datasets (the experiment is named on each row), counted at pEC50 ≥ ${result.thresholds.pec50_min}. pEC50 is apparent potency in that assay, not a binding constant; a regulated curve can be a downstream effect.`,
            `Thermal shift: counted when a comparison of the compound has adjusted p ≤ ${result.thresholds.adj_p_max}. Each comparison is one replicate pair; the tool's own replicate hit call is shown. Stabilisation (ΔTm > 0) and destabilisation both count.`,
            'Annotation: primary targets and off-targets from this program’s target-annotation datasets.',
            'Only this program’s data and annotations are used: compound IDs are unique within a program.',
            ...(mappedByGene
              ? [
                  `${mappedByGene} protein(s) were matched by gene symbol (through this program’s target annotations, or not at all); a gene symbol can stand for several proteins.`,
                ]
              : []),
          ]
        : [],
    });
  });
}
