// SCIM 2.0 endpoints (Phase 35, RFC 7644) at /scim/v2. A standard protocol rather than a /v1 API: requests and
// responses follow SCIM (application/scim+json, SCIM errors); every change is audited like any other mutation.
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { insertAudit, type AuditActor } from '../audit.ts';
import type { ApiConfig } from '../config.ts';
import {
  createGroup,
  groupColumns,
  patchGroup,
  replaceGroup,
  toScimGroup,
  type GroupRow,
} from '../scim/groups.ts';
import { listResponse, paging, parseFilter, ScimError, SCHEMA, scimPrincipal } from '../scim/protocol.ts';
import {
  createUser,
  patchToFields,
  toScimUser,
  updateUser,
  userColumns,
  userFields,
  type UserRow,
} from '../scim/users.ts';

type Json = Record<string, unknown>;
type IdRequest = FastifyRequest<{ Params: { id: string } }>;
const SCIM_TYPE = 'application/scim+json; charset=utf-8';
const route = { config: { public: true, selfAuth: true } };

export function registerScimRoutes(app: FastifyInstance, deps: { db: Database; config: ApiConfig }): void {
  const { db, config } = deps;
  const base = config.publicUrl.replace(/\/$/, '');

  void app.register(
    async (scim) => {
      scim.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
        try {
          done(null, body === '' ? {} : JSON.parse(String(body)));
        } catch {
          done(new ScimError(400, 'The body is not valid JSON.', 'invalidSyntax'), undefined);
        }
      });
      scim.setErrorHandler((error, request, reply) => {
        const e = error instanceof ScimError ? error : new ScimError(500, 'Internal error.');
        if (!(error instanceof ScimError)) request.log.error({ err: error }, 'SCIM request failed');
        return reply.code(e.status).type(SCIM_TYPE).send(e.body());
      });
      /** The identity provider acts through a system admin's SCIM token: audited as that admin. */
      const actorOf = (p: { tenantId: string; userId: string }, request: FastifyRequest): AuditActor => ({
        tenantId: p.tenantId,
        userId: p.userId,
        kind: 'user',
        requestId: request.id,
        ip: request.ip,
        reason: 'SCIM provisioning',
      });
      const send = (reply: FastifyReply, body: unknown, status = 200) =>
        reply.code(status).type(SCIM_TYPE).send(body);
      const audit = (actor: AuditActor, action: string, entityType: string, entityId: string, after?: Json) =>
        insertAudit(db, actor, {
          action,
          entityType,
          entityId,
          ...(after ? { after } : {}),
        });

      // Discovery (RFC 7644 §4).
      scim.get('/ServiceProviderConfig', route, async (request, reply) => {
        await scimPrincipal(db, config, request);
        return send(reply, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
          patch: { supported: true },
          bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
          filter: { supported: true, maxResults: 200 },
          changePassword: { supported: false },
          sort: { supported: false },
          etag: { supported: false },
          authenticationSchemes: [
            {
              type: 'oauthbearertoken',
              name: 'Bearer token',
              description: 'A system admin token with the scim scope.',
            },
          ],
        });
      });
      scim.get('/ResourceTypes', route, async (request, reply) => {
        await scimPrincipal(db, config, request);
        const types = [
          { id: 'User', name: 'User', endpoint: '/Users', schema: SCHEMA.user },
          { id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCHEMA.group },
        ].map((t) => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], ...t }));
        return send(reply, listResponse(types, types.length, 1));
      });
      scim.get('/Schemas', route, async (request, reply) => {
        await scimPrincipal(db, config, request);
        const schemas = [
          {
            id: SCHEMA.user,
            name: 'User',
            attributes: ['userName', 'externalId', 'displayName', 'name', 'emails', 'active'],
          },
          { id: SCHEMA.group, name: 'Group', attributes: ['displayName', 'externalId', 'members'] },
        ];
        return send(reply, listResponse(schemas, schemas.length, 1));
      });

      // Users.
      const users = (tenantId: string) =>
        db
          .selectFrom('app_user')
          .select([...userColumns])
          .where('tenant_id', '=', tenantId)
          .where('deleted_at', 'is', null)
          .where('kind', '=', 'human');
      const oneUser = async (tenantId: string, id: string) => {
        const row = /^[0-9a-f-]{36}$/i.test(id)
          ? await users(tenantId).where('id', '=', id).executeTakeFirst()
          : undefined;
        if (!row) throw new ScimError(404, `User ${id} not found.`);
        return row as UserRow;
      };

      scim.get('/Users', route, async (request, reply) => {
        const p = await scimPrincipal(db, config, request);
        const query = request.query as Json;
        const f = parseFilter(query.filter as string | undefined, ['userName', 'externalId', 'emails.value']);
        const { startIndex, count, offset } = paging(query);
        let q = users(p.tenantId);
        if (f?.attr === 'userName')
          q = q.where((eb) =>
            eb.or([
              eb(eb.fn('lower', ['scim_user_name']), '=', f.value.toLowerCase()),
              eb.and([
                eb('scim_user_name', 'is', null),
                eb(eb.fn('lower', ['email']), '=', f.value.toLowerCase()),
              ]),
            ]),
          );
        if (f?.attr === 'externalId') q = q.where('scim_external_id', '=', f.value);
        if (f?.attr === 'emails.value')
          q = q.where((eb) => eb(eb.fn('lower', ['email']), '=', f.value.toLowerCase()));
        const all = (await q.orderBy('id').execute()) as UserRow[];
        const page = all.slice(offset, offset + count).map((u) => toScimUser(u, base));
        return send(reply, listResponse(page, all.length, startIndex));
      });
      scim.get('/Users/:id', route, async (request: IdRequest, reply) => {
        const p = await scimPrincipal(db, config, request);
        return send(reply, toScimUser(await oneUser(p.tenantId, request.params.id), base));
      });
      scim.post('/Users', route, async (request, reply) => {
        const p = await scimPrincipal(db, config, request);
        const row = (await createUser(db, p.tenantId, p.userId, (request.body ?? {}) as Json)) as UserRow;
        await audit(actorOf(p, request), 'scim.user.create', 'app_user', row.id, toScimUser(row, base));
        return send(reply, toScimUser(row, base), 201);
      });
      const change = async (
        request: IdRequest,
        reply: FastifyReply,
        fields: ReturnType<typeof userFields>,
      ) => {
        const p = await scimPrincipal(db, config, request);
        const before = await oneUser(p.tenantId, request.params.id);
        const after = await updateUser(db, p.tenantId, before, fields);
        await insertAudit(db, actorOf(p, request), {
          action: 'scim.user.update',
          entityType: 'app_user',
          entityId: before.id,
          before: toScimUser(before, base),
          after: toScimUser(after, base),
        });
        return send(reply, toScimUser(after, base));
      };
      scim.put('/Users/:id', route, async (request: IdRequest, reply) =>
        change(request, reply, userFields((request.body ?? {}) as Json)),
      );
      scim.patch('/Users/:id', route, async (request: IdRequest, reply) =>
        change(request, reply, patchToFields(((request.body ?? {}) as Json).Operations)),
      );
      scim.delete('/Users/:id', route, async (request: IdRequest, reply) => {
        const p = await scimPrincipal(db, config, request);
        const user = await oneUser(p.tenantId, request.params.id);
        await db
          .updateTable('app_user')
          .set({ deleted_at: new Date(), deactivated_at: user.deactivated_at ?? new Date() })
          .where('id', '=', user.id)
          .execute();
        await db
          .updateTable('group_member')
          .set({ deleted_at: new Date() })
          .where('user_id', '=', user.id)
          .where('deleted_at', 'is', null)
          .execute();
        await audit(actorOf(p, request), 'scim.user.delete', 'app_user', user.id);
        return reply.code(204).send();
      });

      // Groups.
      const groups = (tenantId: string) =>
        db
          .selectFrom('app_group')
          .select([...groupColumns])
          .where('tenant_id', '=', tenantId)
          .where('deleted_at', 'is', null);
      const oneGroup = async (tenantId: string, id: string) => {
        const row = /^[0-9a-f-]{36}$/i.test(id)
          ? await groups(tenantId).where('id', '=', id).executeTakeFirst()
          : undefined;
        if (!row) throw new ScimError(404, `Group ${id} not found.`);
        return row as GroupRow;
      };
      scim.get('/Groups', route, async (request, reply) => {
        const p = await scimPrincipal(db, config, request);
        const query = request.query as Json;
        const f = parseFilter(query.filter as string | undefined, ['displayName', 'externalId']);
        const { startIndex, count, offset } = paging(query);
        let q = groups(p.tenantId);
        if (f?.attr === 'displayName') q = q.where('name', '=', f.value);
        if (f?.attr === 'externalId') q = q.where('scim_external_id', '=', f.value);
        const all = (await q.orderBy('id').execute()) as GroupRow[];
        const page = await Promise.all(
          all.slice(offset, offset + count).map((g) => toScimGroup(db, g, base)),
        );
        return send(reply, listResponse(page, all.length, startIndex));
      });
      scim.get('/Groups/:id', route, async (request: IdRequest, reply) => {
        const p = await scimPrincipal(db, config, request);
        return send(reply, await toScimGroup(db, await oneGroup(p.tenantId, request.params.id), base));
      });
      scim.post('/Groups', route, async (request, reply) => {
        const p = await scimPrincipal(db, config, request);
        const row = (await createGroup(db, p.tenantId, p.userId, (request.body ?? {}) as Json)) as GroupRow;
        const view = await toScimGroup(db, row, base);
        await audit(actorOf(p, request), 'scim.group.create', 'app_group', row.id, view);
        return send(reply, view, 201);
      });
      const groupChange = async (
        request: IdRequest,
        reply: FastifyReply,
        apply: (p: { tenantId: string; userId: string }, g: GroupRow) => Promise<void>,
      ) => {
        const p = await scimPrincipal(db, config, request);
        const g = await oneGroup(p.tenantId, request.params.id);
        const before = await toScimGroup(db, g, base);
        await apply(p, g);
        const after = await toScimGroup(db, await oneGroup(p.tenantId, g.id), base);
        await insertAudit(db, actorOf(p, request), {
          action: 'scim.group.update',
          entityType: 'app_group',
          entityId: g.id,
          before,
          after,
        });
        return send(reply, after);
      };
      scim.put('/Groups/:id', route, async (request: IdRequest, reply) =>
        groupChange(request, reply, (p, g) =>
          replaceGroup(db, p.tenantId, p.userId, g, (request.body ?? {}) as Json),
        ),
      );
      scim.patch('/Groups/:id', route, async (request: IdRequest, reply) =>
        groupChange(request, reply, (p, g) =>
          patchGroup(db, p.tenantId, p.userId, g, ((request.body ?? {}) as Json).Operations),
        ),
      );
      scim.delete('/Groups/:id', route, async (request: IdRequest, reply) => {
        const p = await scimPrincipal(db, config, request);
        const g = await oneGroup(p.tenantId, request.params.id);
        await db.updateTable('app_group').set({ deleted_at: new Date() }).where('id', '=', g.id).execute();
        await db
          .updateTable('group_member')
          .set({ deleted_at: new Date() })
          .where('group_id', '=', g.id)
          .where('deleted_at', 'is', null)
          .execute();
        await audit(actorOf(p, request), 'scim.group.delete', 'app_group', g.id);
        return reply.code(204).send();
      });
    },
    { prefix: '/scim/v2' },
  );
}
