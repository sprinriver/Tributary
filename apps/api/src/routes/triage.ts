// Hit triage board (Phase 25, TRI-01…03): every change is a history event and an audit row; decisions need reasons.
import {
  AddTriageEvidenceBodySchema,
  CreateTriageBodySchema,
  ListTriageQuerySchema,
  TriageCommentBodySchema,
  TriageDetailSchema,
  TriageListSchema,
  UpdateTriageBodySchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { addEvent, detail, evidenceSnapshot, listItems, readableItem } from '../triage/store.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

/** Owners must be able to see the program (a binding to it, or system admin). */
async function isMember(db: Database, userId: string, programId: string): Promise<boolean> {
  const row = await db
    .selectFrom('role_binding')
    .select('id')
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .where((eb) => eb.or([eb('program_id', '=', programId), eb('role', '=', 'system_admin')]))
    .executeTakeFirst();
  return row !== undefined;
}

export function registerTriageRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  const { db } = deps;

  app.get('/v1/triage', async (request) => {
    const query = parse(ListTriageQuerySchema, request.query);
    return respond(TriageListSchema, { items: await listItems(db, request, query) });
  });

  app.get('/v1/triage/:id', async (request: IdParams) =>
    respond(TriageDetailSchema, await detail(db, request, request.params.id)),
  );

  app.post('/v1/triage', async (request, reply) => {
    const body = parse(CreateTriageBodySchema, request.body);
    authorize(request, 'create', 'TriageItem', body.program_id);
    const actor = requestActor(request);
    const existing = await db
      .selectFrom('triage_item')
      .select('id')
      .where('program_id', '=', body.program_id)
      .where('kind', '=', body.kind)
      .where('key', '=', body.key)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    // Snapshot before writing anything: an unusable evidence reference creates nothing.
    const snapshot = body.evidence
      ? await evidenceSnapshot(deps, request, body, body.evidence, 'evidence.release_id')
      : null;
    const id = await db.transaction().execute(async (trx) => {
      let itemId = existing?.id;
      if (!itemId) {
        const row = await trx
          .insertInto('triage_item')
          .values({
            tenant_id: actor.tenantId,
            created_by: actor.userId,
            program_id: body.program_id,
            kind: body.kind,
            key: body.key,
            label: body.label ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        itemId = row.id;
        await addEvent(trx, actor, itemId, 'created', { to: 'new' });
        await insertAudit(trx, actor, {
          action: 'triage.create',
          entityType: 'triage_item',
          entityId: itemId,
          after: row,
        });
      }
      if (body.evidence && snapshot) {
        const evidence = await trx
          .insertInto('triage_evidence')
          .values({
            tenant_id: actor.tenantId,
            created_by: actor.userId,
            item_id: itemId,
            release_id: body.evidence.release_id,
            ...snapshot,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await addEvent(trx, actor, itemId, 'evidence', { to: body.evidence.release_id });
        await insertAudit(trx, actor, {
          action: 'triage.evidence',
          entityType: 'triage_item',
          entityId: itemId,
          after: evidence,
        });
      }
      return itemId;
    });
    reply.code(existing ? 200 : 201);
    return respond(TriageDetailSchema, await detail(db, request, id));
  });

  app.patch('/v1/triage/:id', async (request: IdParams) => {
    const body = parse(UpdateTriageBodySchema, request.body);
    const item = await readableItem(db, request, request.params.id);
    authorize(request, 'update', 'TriageItem', item.program_id);
    if (body.owner_id && !(await isMember(db, body.owner_id, item.program_id)))
      throw new HttpError(422, 'owner_not_member', 'The owner must be a member of this program.', 'owner_id');
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      const set: { status?: string; owner_id?: string | null } = {};
      if (body.status !== undefined && body.status !== item.status) set.status = body.status;
      if (body.owner_id !== undefined && body.owner_id !== item.owner_id) set.owner_id = body.owner_id;
      if (Object.keys(set).length === 0) return;
      await trx.updateTable('triage_item').set(set).where('id', '=', item.id).execute();
      if (set.status !== undefined)
        await addEvent(trx, actor, item.id, 'status', {
          from: item.status,
          to: set.status,
          text: body.reason ?? null,
        });
      if (set.owner_id !== undefined)
        await addEvent(trx, actor, item.id, 'owner', {
          from: item.owner_id,
          to: set.owner_id,
          text: body.reason ?? null,
        });
      await insertAudit(trx, actor, {
        action: set.status !== undefined ? 'triage.status' : 'triage.owner',
        entityType: 'triage_item',
        entityId: item.id,
        before: { status: item.status, owner_id: item.owner_id },
        after: {
          status: set.status ?? item.status,
          owner_id: set.owner_id === undefined ? item.owner_id : set.owner_id,
        },
        reason: body.reason ?? actor.reason,
      });
    });
    return respond(TriageDetailSchema, await detail(db, request, item.id));
  });

  app.post('/v1/triage/:id/comments', async (request: IdParams, reply) => {
    const body = parse(TriageCommentBodySchema, request.body);
    const item = await readableItem(db, request, request.params.id);
    authorize(request, 'update', 'TriageItem', item.program_id);
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      await addEvent(trx, actor, item.id, 'comment', { text: body.text });
      await insertAudit(trx, actor, {
        action: 'triage.comment',
        entityType: 'triage_item',
        entityId: item.id,
        after: { text: body.text },
      });
    });
    reply.code(201);
    return respond(TriageDetailSchema, await detail(db, request, item.id));
  });

  app.post('/v1/triage/:id/evidence', async (request: IdParams, reply) => {
    const body = parse(AddTriageEvidenceBodySchema, request.body);
    const item = await readableItem(db, request, request.params.id);
    authorize(request, 'update', 'TriageItem', item.program_id);
    const snapshot = await evidenceSnapshot(deps, request, item, body, 'release_id');
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      const evidence = await trx
        .insertInto('triage_evidence')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          item_id: item.id,
          release_id: body.release_id,
          ...snapshot,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await addEvent(trx, actor, item.id, 'evidence', { to: body.release_id });
      await insertAudit(trx, actor, {
        action: 'triage.evidence',
        entityType: 'triage_item',
        entityId: item.id,
        after: evidence,
      });
    });
    reply.code(201);
    return respond(TriageDetailSchema, await detail(db, request, item.id));
  });
}
