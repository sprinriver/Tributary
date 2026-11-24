// Usage analytics (Phase 36, USE-01…03): system admins only; the CSV download is audited as an export.
import { UsageQuerySchema, UsageSchema, USAGE_MEASURES } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requireSystemAdmin } from '../auth/plugin.ts';
import { parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { computeUsage } from '../usage/compute.ts';
import { usageFigure } from '../usage/figure.ts';
import { csvField } from './trust.ts';

export function registerUsageRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/admin/usage', async (request) => {
    const admin = requireSystemAdmin(request);
    const { weeks } = parse(UsageQuerySchema, request.query);
    const usage = await computeUsage(db, admin.tenantId, weeks);
    return respond(UsageSchema, { ...usage, figure: usageFigure(usage.weekly) });
  });

  app.get('/v1/admin/usage/export', async (request, reply) => {
    const admin = requireSystemAdmin(request);
    const { weeks } = parse(UsageQuerySchema, request.query);
    const usage = await computeUsage(db, admin.tenantId, weeks);
    const columns = ['week_start', ...USAGE_MEASURES] as const;
    const lines = [
      columns.join(','),
      ...usage.weekly.map((w) => columns.map((c) => csvField(w[c])).join(',')),
    ];
    await insertAudit(db, requestActor(request), {
      action: 'usage.export',
      entityType: 'usage',
      entityId: admin.tenantId,
      after: { weeks },
    });
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="usage-${usage.generated_at.slice(0, 10)}.csv"`)
      .send(`${lines.join('\n')}\n`);
  });
}
