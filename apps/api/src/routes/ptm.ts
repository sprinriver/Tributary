// Modification sites (Phase 47, PTM-03). Read-only: nothing is stored or audited.
import {
  ProteinSitesQuerySchema,
  ProteinSitesSchema,
  SiteSummaryQuerySchema,
  SiteSummarySchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import {
  ISOFORM_NOTE,
  LOCALISATION_NOTE,
  MAP_NOTE,
  QUANTIFIED_NOTE,
  plotted,
  proteinSites,
  siteFigure,
  siteSummary,
} from '../ptm/sites.ts';
import { resolveSource } from '../query/resolve.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerPtmRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  app.get('/v1/proteins/:id/sites', async (request: IdParams) => {
    const query = parse(ProteinSitesQuerySchema, request.query);
    const principal = requirePrincipal(request);
    const accession = request.params.id;
    const { releases, sites } = await proteinSites(
      deps,
      readablePrograms(principal),
      accession,
      query.loc_min,
    );
    const shared = sites.filter((s) => s.shared_with.length).length;
    return respond(ProteinSitesSchema, {
      protein: accession,
      loc_min: query.loc_min,
      releases,
      sites,
      figure: siteFigure(sites, query.loc_min, releases),
      notes: sites.length
        ? [
            LOCALISATION_NOTE(query.loc_min),
            'Localisation probability: the best for the site over all samples in the table, as the tool reported it.',
            QUANTIFIED_NOTE,
            MAP_NOTE,
            ISOFORM_NOTE,
            ...(sites.some((x) => !plotted(x))
              ? [
                  `${sites.filter((x) => !plotted(x)).length} site(s) are not on the map (no position on this protein or no localisation probability); they are in the table.`,
                ]
              : []),
            ...(shared
              ? [
                  `${shared} site(s) are also reported on other proteins (shared peptides): the position shown is this protein’s.`,
                ]
              : []),
          ]
        : [],
    });
  });

  app.get('/v1/ptm-sites/summary', async (request) => {
    const query = parse(SiteSummaryQuerySchema, request.query);
    const principal = requirePrincipal(request);
    const source = await resolveSource(
      deps.db,
      { releaseIds: [query.release_id] },
      readablePrograms(principal),
    );
    if (!source) throw notFound('Release');
    if (source.kind !== 'ptm_site_quant')
      throw new HttpError(
        422,
        'wrong_kind',
        'A site summary needs a modification-site release.',
        'release_id',
      );
    return respond(SiteSummarySchema, await siteSummary(deps, query.release_id, query.loc_min));
  });
}
