import {
  AuditExportQuerySchema,
  AuditListSchema,
  AuditQuerySchema,
  HistoryParamsSchema,
  LineageGraphSchema,
  LineageQuerySchema,
  type AuditEntry,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { readablePrograms, requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { lineageGraph } from '../lineage/graph.ts';
import { respond } from '../respond.ts';

const EXPORT_LIMIT = 100_000;
const CSV_COLUMNS = [
  'at',
  'actor',
  'actor_type',
  'action',
  'entity_type',
  'entity_id',
  'reason',
  'request_id',
];

type Filters = ReturnType<typeof AuditExportQuerySchema.parse>;

function auditQuery(db: Database, tenantId: string, f: Filters) {
  let q = db
    .selectFrom('audit_log as a')
    .leftJoin('app_user as u', 'u.id', 'a.actor_id')
    .select([
      'a.id',
      'a.at',
      'a.actor_id',
      'u.name as actor_name',
      'a.actor_type',
      'a.action',
      'a.entity_type',
      'a.entity_id',
      'a.reason',
      'a.request_id',
      'a.before',
      'a.after',
    ])
    .where('a.tenant_id', '=', tenantId);
  if (f.action) q = q.where('a.action', '=', f.action);
  if (f.entity_type) q = q.where('a.entity_type', '=', f.entity_type);
  if (f.entity_id) q = q.where('a.entity_id', '=', f.entity_id);
  if (f.actor_id) q = q.where('a.actor_id', '=', f.actor_id);
  if (f.from) q = q.where('a.at', '>=', new Date(f.from));
  if (f.to) q = q.where('a.at', '<', new Date(f.to));
  return q.orderBy('a.at', 'desc').orderBy('a.id', 'desc');
}
type Row = Awaited<ReturnType<ReturnType<typeof auditQuery>['execute']>>[number];

const toEntry = (r: Row): AuditEntry => ({
  ...r,
  at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  before: r.before ?? null,
  after: r.after ?? null,
});

const encodeCursor = (r: AuditEntry) =>
  Buffer.from(JSON.stringify({ at: r.at, id: r.id })).toString('base64url');
function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { at?: unknown; id?: unknown };
    if (typeof c.at === 'string' && typeof c.id === 'string' && !Number.isNaN(Date.parse(c.at)))
      return { at: c.at, id: c.id };
  } catch {
    // fall through
  }
  throw new HttpError(400, 'invalid_cursor', 'The cursor is not valid.', 'cursor');
}

/**
 * RFC 4180 field. A leading = + - @ (or tab/CR) is prefixed with ' so spreadsheet apps show text, not a
 * formula (OWASP "CSV Injection").
 */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Program and audit entity ids behind a history tab. */
async function historyScope(
  db: Database,
  type: (typeof HistoryParamsSchema.shape.type.options)[number],
  id: string,
): Promise<{ programId: string; entities: { type: string; id: string }[] } | undefined> {
  if (type === 'experiment') {
    const e = await db
      .selectFrom('experiment')
      .select(['id', 'program_id'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!e) return undefined;
    const versions = await db
      .selectFrom('experiment_version')
      .select('id')
      .where('experiment_id', '=', id)
      .execute();
    return {
      programId: e.program_id,
      entities: [
        { type: 'experiment', id },
        ...versions.map((v) => ({ type: 'experiment_version', id: v.id })),
      ],
    };
  }
  const program =
    type === 'experiment_version'
      ? db
          .selectFrom('experiment_version as v')
          .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
          .select('e.program_id')
          .where('v.id', '=', id)
      : type === 'dataset_release'
        ? db
            .selectFrom('dataset_release as r')
            .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
            .select('d.program_id')
            .where('r.id', '=', id)
        : type === 'file'
          ? db
              .selectFrom('file_object as f')
              .innerJoin('experiment_version as v', 'v.id', 'f.experiment_version_id')
              .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
              .select('e.program_id')
              .where('f.id', '=', id)
          : db
              .selectFrom('pipeline_run as r')
              .innerJoin('experiment_version as v', 'v.id', 'r.experiment_version_id')
              .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
              .select('e.program_id')
              .where('r.id', '=', id);
  const row = await program.executeTakeFirst();
  // Audit entity types: releases are recorded as dataset_release, files as file_object.
  const auditType = type === 'file' ? 'file_object' : type;
  return row ? { programId: row.program_id, entities: [{ type: auditType, id }] } : undefined;
}

/** Lineage graph, audit log viewer and export, per-entity history (SPEC M10). */
export function registerTrustRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/lineage', async (request) => {
    const principal = requirePrincipal(request);
    const q = parse(LineageQuerySchema, request.query);
    const graph = await lineageGraph(
      db,
      { userId: principal.userId, programs: readablePrograms(principal) },
      { kind: q.kind, id: q.id },
      q.depth ?? 3,
      q.direction ?? 'both',
    );
    if (!graph) throw notFound('Entity');
    return respond(LineageGraphSchema, graph);
  });

  app.get('/v1/audit', async (request) => {
    const principal = requireSystemAdmin(request);
    const q = parse(AuditQuerySchema, request.query);
    const limit = q.limit ?? 50;
    let query = auditQuery(db, principal.tenantId, q);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      query = query.where((eb) =>
        eb.or([
          eb('a.at', '<', new Date(c.at)),
          eb.and([eb('a.at', '=', new Date(c.at)), eb('a.id', '<', c.id)]),
        ]),
      );
    }
    const rows = (await query.limit(limit + 1).execute()).map(toEntry);
    const items = rows.slice(0, limit);
    return respond(AuditListSchema, {
      items,
      next_cursor: rows.length > limit ? encodeCursor(items.at(-1)!) : null,
    });
  });

  app.get('/v1/audit/export', async (request, reply) => {
    const principal = requireSystemAdmin(request);
    const q = parse(AuditExportQuerySchema, request.query);
    const rows = (await auditQuery(db, principal.tenantId, q).limit(EXPORT_LIMIT).execute()).map(toEntry);
    const lines = [
      CSV_COLUMNS.join(','),
      ...rows.map((r) =>
        [
          r.at,
          r.actor_name ?? r.actor_id,
          r.actor_type,
          r.action,
          r.entity_type,
          r.entity_id,
          r.reason,
          r.request_id,
        ]
          .map(csvField)
          .join(','),
      ),
    ];
    // Exports are audited like any other export (CLAUDE.md).
    await insertAudit(db, requestActor(request), {
      action: 'audit.export',
      entityType: 'audit_log',
      entityId: principal.tenantId,
      after: { filters: q, rows: rows.length, truncated: rows.length === EXPORT_LIMIT },
    });
    const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-${stamp}.csv"`)
      .send(`${lines.join('\n')}\n`);
  });

  app.get('/v1/history/:type/:id', async (request) => {
    const principal = requirePrincipal(request);
    const params = parse(HistoryParamsSchema, request.params);
    const scope = await historyScope(db, params.type, params.id);
    const programs = readablePrograms(principal);
    if (!scope || (programs !== null && !programs.includes(scope.programId))) throw notFound('Entity');
    const rows = await auditQuery(db, principal.tenantId, {})
      .where((eb) =>
        eb.or(
          scope.entities.map((e) => eb.and([eb('a.entity_type', '=', e.type), eb('a.entity_id', '=', e.id)])),
        ),
      )
      .limit(500)
      .execute();
    return respond(AuditListSchema, { items: rows.map(toEntry), next_cursor: null });
  });
}
