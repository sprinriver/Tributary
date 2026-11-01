import {
  AdminTemplateListQuerySchema,
  AdminTemplateListSchema,
  AdminTemplateSchema,
  AssayTypeKeySchema,
  CreateTemplateBodySchema,
  PublishTemplateBodySchema,
  TemplatePreviewSchema,
  type AdminTemplate,
  type AssayTypeKey,
  type MetadataFieldDef,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { insertAudit, requestActor } from '../audit.ts';
import { requireRecentAuth, requireSystemAdmin } from '../auth/plugin.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import {
  builtIn,
  currentTemplate,
  fieldToRow,
  listTemplates,
  semverKey,
  type ResolvedTemplate,
} from '../registry/templates.ts';
import { respond } from '../respond.ts';

type Pinned = Record<string, { draft: number; published: number; archived: number }>;
const ParamsSchema = z.object({
  assay_type: AssayTypeKeySchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});
type VersionParams = FastifyRequest<{ Params: { assay_type: string; version: string } }>;

/** Experiment versions per pinned template version and status, for one assay type. */
async function pinnedCounts(db: Database, assayType: AssayTypeKey): Promise<Pinned> {
  const rows = await db
    .selectFrom('experiment_version as v')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select(['v.template_version', 'v.status', db.fn.countAll<string>().as('n')])
    .where('e.assay_type', '=', assayType)
    .where('v.deleted_at', 'is', null)
    .where('e.deleted_at', 'is', null)
    .groupBy(['v.template_version', 'v.status'])
    .execute();
  const out: Pinned = {};
  for (const r of rows) {
    const entry = (out[r.template_version] ??= { draft: 0, published: 0, archived: 0 });
    entry[r.status as 'draft' | 'published' | 'archived'] += Number(r.n);
  }
  return out;
}

/** Stored versions plus the built-in one while no stored version replaces it. */
async function allVersions(db: Database, assayType: AssayTypeKey): Promise<ResolvedTemplate[]> {
  const stored = (await listTemplates(db, assayType)).filter((t) => !t.built_in);
  const fallback = builtIn(assayType);
  const hasPublished = stored.some((t) => t.status === 'published');
  const list = [...stored];
  if (!stored.some((t) => t.version === fallback.version))
    list.push({ ...fallback, status: hasPublished ? 'retired' : 'published' });
  return list.sort((a, b) => semverKey(b.version).localeCompare(semverKey(a.version)));
}

const withCounts = (t: ResolvedTemplate, pinned: Pinned): AdminTemplate => ({
  ...t,
  pinned: pinned[t.version] ?? { draft: 0, published: 0, archived: 0 },
});

function nextVersion(latest: string, bump: 'major' | 'minor' | 'patch'): string {
  const [major, minor, patch] = latest.split('.').map(Number) as [number, number, number];
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const fieldId = (f: MetadataFieldDef) => `${f.scope}.${f.key}`;
const same = (a: MetadataFieldDef, b: MetadataFieldDef) => JSON.stringify(a) === JSON.stringify(b);

async function loadOne(db: Database, assayType: AssayTypeKey, version: string): Promise<ResolvedTemplate> {
  const found = (await allVersions(db, assayType)).find((t) => t.version === version);
  if (!found) throw notFound('Template version');
  return found;
}

/** Template versioning with migration preview (SPEC M11, ADM-01). */
export function registerAdminTemplateRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/admin/templates', async (request) => {
    requireSystemAdmin(request);
    const { assay_type } = parse(AdminTemplateListQuerySchema, request.query);
    const pinned = await pinnedCounts(db, assay_type);
    const items = (await allVersions(db, assay_type)).map((t) => withCounts(t, pinned));
    return respond(AdminTemplateListSchema, { items });
  });

  app.post('/v1/admin/templates', async (request, reply) => {
    const principal = requireSystemAdmin(request);
    const body = parse(CreateTemplateBodySchema, request.body);
    const keyField = body.key_field ?? 'sample_key';
    if (!body.fields.some((f) => f.scope === 'sample' && f.key === keyField))
      throw new HttpError(
        422,
        'key_field_missing',
        `The key field "${keyField}" must stay in the template.`,
        'fields',
      );
    const seen = new Set<string>();
    for (const f of body.fields) {
      if (seen.has(fieldId(f)))
        throw new HttpError(
          422,
          'duplicate_field',
          `"${f.key}" appears twice in ${f.scope} fields.`,
          'fields',
        );
      seen.add(fieldId(f));
    }
    const latest = (await allVersions(db, body.assay_type))[0]!;
    const version = nextVersion(latest.version, body.bump);
    await db.transaction().execute(async (trx) => {
      const { id } = await trx
        .insertInto('metadata_template')
        .values({
          tenant_id: principal.tenantId,
          created_by: principal.userId,
          assay_type: body.assay_type,
          version,
          status: 'draft',
          key_field: keyField,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('metadata_field_def')
        .values(
          body.fields.map((f, i) => ({
            tenant_id: principal.tenantId,
            created_by: principal.userId,
            template_id: id,
            ...fieldToRow(f, i),
          })),
        )
        .execute();
      await insertAudit(trx, requestActor(request), {
        action: 'template.create',
        entityType: 'metadata_template',
        entityId: id,
        after: {
          assay_type: body.assay_type,
          version,
          base_version: latest.version,
          fields: body.fields.length,
        },
      });
    });
    reply.code(201);
    const created = await loadOne(db, body.assay_type, version);
    return respond(AdminTemplateSchema, withCounts(created, {}));
  });

  app.get('/v1/admin/templates/:assay_type/:version/preview', async (request: VersionParams) => {
    requireSystemAdmin(request);
    const params = parse(ParamsSchema, request.params);
    const target = await loadOne(db, params.assay_type, params.version);
    const base = await currentTemplate(db, params.assay_type);
    const before = new Map(base.fields.map((f) => [fieldId(f), f]));
    const after = new Map(target.fields.map((f) => [fieldId(f), f]));
    const key = (id: string) => id.split('.').slice(1).join('.');
    const pinned = await pinnedCounts(db, params.assay_type);
    return respond(TemplatePreviewSchema, {
      assay_type: params.assay_type,
      version: target.version,
      base_version: base.version,
      added: [...after.keys()].filter((k) => !before.has(k)).map(key),
      removed: [...before.keys()].filter((k) => !after.has(k)).map(key),
      changed: [...after.keys()]
        .filter((k) => before.has(k) && !same(before.get(k)!, after.get(k)!))
        .map(key),
      newly_required: [...after.values()]
        .filter((f) => f.required && !before.get(fieldId(f))?.required)
        .map((f) => f.key),
      pinned: Object.entries(pinned)
        .sort(([a], [b]) => semverKey(b).localeCompare(semverKey(a)))
        .map(([version, counts]) => ({ version, ...counts })),
    });
  });

  app.post('/v1/admin/templates/:assay_type/:version/publish', async (request: VersionParams) => {
    const principal = requireSystemAdmin(request);
    requireRecentAuth(request);
    const params = parse(ParamsSchema, request.params);
    const body = parse(PublishTemplateBodySchema, request.body);
    const row = await db
      .selectFrom('metadata_template')
      .select(['id', 'status'])
      .where('tenant_id', '=', principal.tenantId)
      .where('assay_type', '=', params.assay_type)
      .where('version', '=', params.version)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('Template version');
    if (row.status !== 'draft')
      throw new HttpError(409, 'immutable', `Template ${params.version} is ${row.status}; it cannot change.`);
    await db.transaction().execute(async (trx) => {
      // The previous published version is retired: experiment versions that pin it keep it.
      await trx
        .updateTable('metadata_template')
        .set({ status: 'retired' })
        .where('tenant_id', '=', principal.tenantId)
        .where('assay_type', '=', params.assay_type)
        .where('status', '=', 'published')
        .execute();
      await trx
        .updateTable('metadata_template')
        .set({ status: 'published' })
        .where('id', '=', row.id)
        .execute();
      await insertAudit(trx, requestActor(request), {
        action: 'template.publish',
        entityType: 'metadata_template',
        entityId: row.id,
        before: { status: 'draft' },
        after: { status: 'published', assay_type: params.assay_type, version: params.version },
        reason: body.reason,
      });
    });
    const pinned = await pinnedCounts(db, params.assay_type);
    return respond(
      AdminTemplateSchema,
      withCounts(await loadOne(db, params.assay_type, params.version), pinned),
    );
  });
}
