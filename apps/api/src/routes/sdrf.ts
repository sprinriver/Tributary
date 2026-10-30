import { SampleValidationSchema, SdrfImportBodySchema, type ContractError } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, parse } from '../errors.ts';
import { loadVersion, samplesOf } from '../registry/load.ts';
import { respond } from '../respond.ts';
import { upsertSamples } from './samples.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

/** Calls apps/compute (internal); its structured errors pass through as 422. */
async function compute<T>(
  fetchImpl: typeof fetch,
  config: ApiConfig,
  path: string,
  body: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.computeUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(503, 'compute_unavailable', 'The compute service is not reachable.');
  }
  if (!res.ok) throw new HttpError(502, 'compute_failed', `The compute service answered HTTP ${res.status}.`);
  return (await res.json()) as T;
}

const fileName = (name: string, version: number) =>
  `${name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)}-v${version}.sdrf.tsv`;

export function registerSdrfRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  fetchImpl: typeof fetch,
): void {
  app.get('/v1/versions/:id/sdrf', async (request: IdParams, reply) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'read', 'Sample', version.program_id);
    const rows = (await samplesOf(db, version.id)).map((s) => s.raw as Record<string, string>);
    const instrument = (version.custom as Record<string, unknown>).instrument;
    const result = await compute<{ sdrf: string; errors: ContractError[] }>(
      fetchImpl,
      config,
      '/sdrf/export',
      {
        assay_type: version.assay_type,
        rows,
        ...(typeof instrument === 'string' && instrument ? { instrument } : {}),
      },
    );
    if (result.errors.length) {
      const first = result.errors[0]!;
      throw new HttpError(422, 'sdrf_invalid', first.message, first.field ?? undefined, result.errors);
    }
    await writeAudit(db, request, {
      action: 'sdrf.export',
      entityType: 'experiment_version',
      entityId: version.id,
      after: { rows: rows.length },
    });
    return reply
      .type('text/tab-separated-values; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="${fileName(version.experiment_name, version.version_number)}"`,
      )
      .send(result.sdrf);
  });

  app.post('/v1/versions/:id/sdrf', async (request: IdParams) => {
    const body = parse(SdrfImportBodySchema, request.body);
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'update', 'Sample', version.program_id);
    const imported = await compute<{ rows: Record<string, string>[]; errors: ContractError[] }>(
      fetchImpl,
      config,
      '/sdrf/import',
      {
        sdrf: body.sdrf,
      },
    );
    if (imported.errors.length) {
      const first = imported.errors[0]!;
      throw new HttpError(422, first.code, first.message, first.field ?? undefined, imported.errors);
    }
    if (!imported.rows.length) throw new HttpError(422, 'no_rows', 'The SDRF file has no sample rows.');
    return respond(SampleValidationSchema, await upsertSamples(db, request, version.id, imported.rows));
  });
}
