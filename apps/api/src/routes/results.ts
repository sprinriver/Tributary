import {
  CompareBodySchema,
  CompareOptionsSchema,
  CompareResultSchema,
  CompoundPageSchema,
  ProteinPageSchema,
  VersionResultsSchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { compareContrasts } from '../results/compare.ts';
import { versionResults } from '../results/load.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

/** Program filter for list queries (null = every program, system admin). */
const inPrograms = (request: FastifyRequest) => readablePrograms(requirePrincipal(request));

export function registerResultRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  const { db } = deps;

  app.get('/v1/versions/:id/results', async (request: IdParams) => {
    const { program_id, ...results } = await versionResults(db, request.params.id);
    authorize(request, 'read', 'Dataset', program_id);
    return respond(VersionResultsSchema, results);
  });

  app.get('/v1/compounds/:id', async (request: IdParams) => {
    const programs = inPrograms(request);
    if (programs?.length === 0) throw notFound('Compound');
    let q = db
      .selectFrom('compound as c')
      .innerJoin('program as p', 'p.id', 'c.program_id')
      .select([
        'c.compound_id',
        'c.batch_id',
        'c.name',
        'c.smiles',
        'c.inchikey',
        'p.code as program_code',
        'c.program_id',
      ])
      .where('c.compound_id', '=', request.params.id)
      .where('c.deleted_at', 'is', null);
    if (programs) q = q.where('c.program_id', 'in', programs);
    const compound = await q.orderBy('c.batch_id').executeTakeFirst();
    if (!compound) throw notFound('Compound');
    const properties = await db
      .selectFrom('compound_property')
      .select(['property', 'value', 'unit', 'qualifier', 'assay_category', 'assay_name', 'batch_id'])
      .where('compound_id', '=', compound.compound_id)
      .where('program_id', '=', compound.program_id)
      .where('deleted_at', 'is', null)
      .orderBy('assay_category')
      .orderBy('property')
      .execute();
    // Contrasts whose numerator condition was treated with this compound (sample factors), in readable programs.
    let cq = db
      .selectFrom('contrast as k')
      .innerJoin('experiment_version as v', 'v.id', 'k.experiment_version_id')
      .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
      .select([
        'k.id as contrast_id',
        'k.label',
        'e.id as experiment_id',
        'e.name as experiment_name',
        'v.id as experiment_version_id',
        'v.version_number',
        'v.published_at',
      ])
      .where('k.deleted_at', 'is', null)
      .where('v.deleted_at', 'is', null)
      .where('v.status', '=', 'published')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('sample as s')
            .select('s.id')
            .whereRef('s.experiment_version_id', '=', 'k.experiment_version_id')
            .where('s.deleted_at', 'is', null)
            .where(({ ref }) =>
              eb(
                eb.fn('jsonb_extract_path_text', [ref('s.factors'), eb.val('compound_id')]),
                '=',
                compound.compound_id,
              ),
            )
            .where(({ ref }) =>
              eb(
                eb.fn('jsonb_extract_path_text', [ref('s.factors'), eb.val('condition')]),
                '=',
                ref('k.numerator'),
              ),
            ),
        ),
      );
    if (programs) cq = cq.where('e.program_id', 'in', programs);
    // Newest results first.
    const contrasts = await cq.orderBy('v.published_at', 'desc').orderBy('k.label').limit(200).execute();
    const withReleases = await Promise.all(
      contrasts.map(async (c) => {
        const rel = await db
          .selectFrom('dataset_release as r')
          .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
          .select('r.id')
          .where('d.experiment_version_id', '=', c.experiment_version_id)
          .where('d.kind', '=', 'differential_abundance')
          .where('r.status', '=', 'published')
          .where('r.deleted_at', 'is', null)
          .orderBy('r.published_at', 'desc')
          .executeTakeFirst();
        const { published_at: _p, ...rest } = c;
        return { ...rest, release_id: rel?.id ?? null };
      }),
    );
    const { program_id: _p, ...out } = compound;
    return respond(CompoundPageSchema, { compound: out, properties, contrasts: withReleases });
  });

  app.get('/v1/proteins/:id', async (request: IdParams) => {
    requirePrincipal(request);
    // Reference annotations are tenant-wide (not program data).
    const rows = await db
      .selectFrom('target_annotation')
      .select(['gene_symbol', 'key', 'value', 'family'])
      .where('uniprot_accession', '=', request.params.id)
      .where('deleted_at', 'is', null)
      .orderBy('key')
      .execute();
    return respond(ProteinPageSchema, {
      accession: request.params.id,
      gene_symbol: rows.find((r) => r.gene_symbol)?.gene_symbol ?? null,
      annotations: rows.map(({ key, value, family }) => ({ key, value, family })),
    });
  });

  app.get('/v1/compare/options', async (request) => {
    const programs = inPrograms(request);
    if (programs?.length === 0) return respond(CompareOptionsSchema, { items: [] });
    let q = db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .innerJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
      .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
      .innerJoin('program as p', 'p.id', 'e.program_id')
      .innerJoin('contrast as k', 'k.experiment_version_id', 'v.id')
      .select([
        'r.id as release_id',
        'k.id as contrast_id',
        'k.label',
        'e.name as experiment_name',
        'p.code as program_code',
      ])
      .where('d.kind', '=', 'differential_abundance')
      .where('r.status', '=', 'published')
      .where('r.deleted_at', 'is', null)
      .where('k.deleted_at', 'is', null);
    if (programs) q = q.where('e.program_id', 'in', programs);
    return respond(CompareOptionsSchema, {
      items: await q.orderBy('e.name').orderBy('k.label').limit(500).execute(),
    });
  });

  app.post('/v1/compare', async (request) => {
    requirePrincipal(request);
    const body = parse(CompareBodySchema, request.body);
    return respond(CompareResultSchema, await compareContrasts(deps, request, body));
  });
}
