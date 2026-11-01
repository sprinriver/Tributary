import {
  CreateProgramBodySchema,
  GroupMappingsSchema,
  OntologySourcesSchema,
  parseQuantity,
  PicklistKindSchema,
  PicklistQuerySchema,
  PicklistSchema,
  ProgramRowSchema,
  PutGroupMappingsBodySchema,
  PutOntologySourcesBodySchema,
  PutPicklistBodySchema,
  SEED_TERMS,
  UpdateProgramBodySchema,
  type GroupMapping,
  type Picklist,
  type PicklistKind,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { getSetting, KNOWN_ONTOLOGIES, putSetting, storedGroupMappings } from '../admin/settings.ts';

/** Picklist defaults until an admin sets a list (species from the seed taxonomy terms). */
const DEFAULTS: Record<PicklistKind, { value: string; label: string }[]> = {
  species: SEED_TERMS.filter((t) => t.ontology === 'NCBITaxon').map((t) => ({ value: t.id, label: t.label })),
  spectral_library: [],
  time_point: ['1 h', '6 h', '24 h', '48 h', '72 h'].map((v) => ({ value: v, label: v })),
};

async function picklist(db: Database, tenantId: string, kind: PicklistKind): Promise<Picklist> {
  const rows = await db
    .selectFrom('picklist_value')
    .select(['value', 'label'])
    .where('tenant_id', '=', tenantId)
    .where('kind', '=', kind)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
  const set = await getSetting<boolean>(db, tenantId, `picklist.${kind}.set`);
  return set ? { kind, built_in: false, values: rows } : { kind, built_in: true, values: DEFAULTS[kind] };
}

/** Each kind's values must make sense where they are used (registry fields). */
function checkValues(kind: PicklistKind, values: { value: string }[]): void {
  values.forEach((v, i) => {
    const bad = (message: string) => new HttpError(422, 'invalid_value', message, `values.${i}.value`);
    if (kind === 'time_point' && !parseQuantity(v.value, 'time').ok)
      throw bad(`"${v.value}" is not a time with a unit, e.g. "24 h".`);
    if (kind === 'species' && !/^NCBITaxon:\d+$/.test(v.value))
      throw bad(`"${v.value}" is not an NCBI Taxonomy id, e.g. NCBITaxon:9606.`);
  });
  if (new Set(values.map((v) => v.value)).size !== values.length)
    throw new HttpError(422, 'duplicate_value', 'Each value may appear once.', 'values');
}

type IdParams = FastifyRequest<{ Params: { id: string } }>;
type KindParams = FastifyRequest<{ Params: { kind: string } }>;

/** Admin settings (SPEC M11): programs, picklists, ontology sources and IdP group mappings. */
export function registerAdminSettingsRoutes(app: FastifyInstance, db: Database, config: ApiConfig): void {
  app.post('/v1/admin/programs', async (request, reply) => {
    const principal = requireSystemAdmin(request);
    const body = parse(CreateProgramBodySchema, request.body);
    const exists = await db
      .selectFrom('program')
      .select('id')
      .where('tenant_id', '=', principal.tenantId)
      .where('code', '=', body.code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (exists) throw new HttpError(409, 'conflict', `A program with code ${body.code} exists.`, 'code');
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('program')
        .values({
          tenant_id: principal.tenantId,
          created_by: principal.userId,
          code: body.code,
          name: body.name,
          description: body.description ?? '',
          requires_approval: body.requires_approval ?? false,
        })
        .returning(['id', 'code', 'name', 'description', 'requires_approval'])
        .executeTakeFirstOrThrow();
      await insertAudit(trx, requestActor(request), {
        action: 'program.create',
        entityType: 'program',
        entityId: created.id,
        after: created,
      });
      return created;
    });
    reply.code(201);
    return respond(ProgramRowSchema, row);
  });

  app.patch('/v1/admin/programs/:id', async (request: IdParams) => {
    requireSystemAdmin(request);
    const body = parse(UpdateProgramBodySchema, request.body);
    const columns = ['id', 'code', 'name', 'description', 'requires_approval'] as const;
    const before = await db
      .selectFrom('program')
      .select(columns)
      .where('id', '=', request.params.id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!before) throw notFound('Program');
    const after = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('program')
        .set(body)
        .where('id', '=', before.id)
        .returning(columns)
        .executeTakeFirstOrThrow();
      await insertAudit(trx, requestActor(request), {
        action: 'program.update',
        entityType: 'program',
        entityId: before.id,
        before,
        after: updated,
      });
      return updated;
    });
    return respond(ProgramRowSchema, after);
  });

  app.get('/v1/picklists', async (request) => {
    const principal = requirePrincipal(request);
    const { kind } = parse(PicklistQuerySchema, request.query);
    return respond(PicklistSchema, await picklist(db, principal.tenantId, kind));
  });

  app.put('/v1/admin/picklists/:kind', async (request: KindParams) => {
    const principal = requireSystemAdmin(request);
    const kind = parse(PicklistKindSchema, request.params.kind, 'kind');
    const body = parse(PutPicklistBodySchema, request.body);
    checkValues(kind, body.values);
    const before = await picklist(db, principal.tenantId, kind);
    await db.transaction().execute(async (trx) => {
      const database = trx as unknown as Database;
      // Replace: soft-delete what is no longer listed, upsert the rest in order.
      await trx
        .updateTable('picklist_value')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', principal.tenantId)
        .where('kind', '=', kind)
        .where('deleted_at', 'is', null)
        .execute();
      if (body.values.length)
        await trx
          .insertInto('picklist_value')
          .values(
            body.values.map((v, position) => ({
              tenant_id: principal.tenantId,
              created_by: principal.userId,
              kind,
              value: v.value,
              label: v.label,
              position,
            })),
          )
          .execute();
      await putSetting(database, principal.tenantId, principal.userId, `picklist.${kind}.set`, true);
      await insertAudit(trx, requestActor(request), {
        action: 'picklist.update',
        entityType: 'picklist',
        entityId: principal.tenantId,
        before,
        after: { kind, values: body.values },
      });
    });
    return respond(PicklistSchema, await picklist(db, principal.tenantId, kind));
  });

  const ontologySources = async (tenantId: string) => {
    const saved = await getSetting<{ enabled: string[] }>(db, tenantId, 'ontology_sources');
    const enabled = new Set(
      (saved?.enabled ?? KNOWN_ONTOLOGIES.map((o) => o.prefix)).map((p) => p.toLowerCase()),
    );
    return {
      ols_url: config.olsUrl,
      sources: KNOWN_ONTOLOGIES.map((o) => ({ ...o, enabled: enabled.has(o.prefix.toLowerCase()) })),
    };
  };
  app.get('/v1/admin/ontology-sources', async (request) => {
    const principal = requireSystemAdmin(request);
    return respond(OntologySourcesSchema, await ontologySources(principal.tenantId));
  });
  app.put('/v1/admin/ontology-sources', async (request) => {
    const principal = requireSystemAdmin(request);
    const body = parse(PutOntologySourcesBodySchema, request.body);
    const known = new Set<string>(KNOWN_ONTOLOGIES.map((o) => o.prefix));
    const unknown = body.enabled.find((p) => !known.has(p));
    if (unknown)
      throw new HttpError(422, 'unknown_ontology', `${unknown} is not a known ontology source.`, 'enabled');
    const before = await ontologySources(principal.tenantId);
    await db.transaction().execute(async (trx) => {
      await putSetting(trx as unknown as Database, principal.tenantId, principal.userId, 'ontology_sources', {
        enabled: body.enabled,
      });
      await insertAudit(trx, requestActor(request), {
        action: 'settings.ontology_sources',
        entityType: 'app_setting',
        entityId: principal.tenantId,
        before: { enabled: before.sources.filter((s) => s.enabled).map((s) => s.prefix) },
        after: body,
      });
    });
    return respond(OntologySourcesSchema, await ontologySources(principal.tenantId));
  });

  const fromConfig = (): GroupMapping[] =>
    config.groupRoleMap.map((m) => ({ group: m.group, role: m.role, programs: m.programs ?? [] }));
  app.get('/v1/admin/group-mappings', async (request) => {
    const principal = requireSystemAdmin(request);
    return respond(GroupMappingsSchema, {
      items: await storedGroupMappings(db, principal.tenantId),
      from_config: fromConfig(),
    });
  });
  app.put('/v1/admin/group-mappings', async (request) => {
    const principal = requireSystemAdmin(request);
    const body = parse(PutGroupMappingsBodySchema, request.body);
    const before = await storedGroupMappings(db, principal.tenantId);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('group_role_mapping')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', principal.tenantId)
        .where('deleted_at', 'is', null)
        .execute();
      if (body.items.length)
        await trx
          .insertInto('group_role_mapping')
          .values(
            body.items.map((m, position) => ({
              tenant_id: principal.tenantId,
              created_by: principal.userId,
              group_name: m.group,
              role: m.role,
              programs: m.programs,
              position,
            })),
          )
          .execute();
      await insertAudit(trx, requestActor(request), {
        action: 'settings.group_mappings',
        entityType: 'app_setting',
        entityId: principal.tenantId,
        before,
        after: body.items,
      });
    });
    return respond(GroupMappingsSchema, {
      items: await storedGroupMappings(db, principal.tenantId),
      from_config: fromConfig(),
    });
  });
}
