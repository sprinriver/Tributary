// Alerts on publish (Phase 26, WAT-02): when a release is published, every watcher who can read its program gets an
// alert for each hit on what they watch. Best effort: a failure here is logged and never fails the publish.
import { ALERT_HIT_RULE, QueryResultSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyBaseLogger } from 'fastify';
import { insertAudit, type AuditActor } from '../audit.ts';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { resolveSource } from '../query/resolve.ts';

export interface NotifyDeps {
  db: Database;
  config: ApiConfig;
  fetch: typeof fetch;
}

const RULE = `adjusted p ≤ ${ALERT_HIT_RULE.adj_p_max} and |log2 FC| ≥ ${ALERT_HIT_RULE.abs_log2fc_min}`;
const COMPOUND_RULE = 'present in a dose-response release';
/** Hits read per release (a release with more significant rows than this is alerted on its first ones). */
const MAX_HIT_ROWS = 100_000;

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : [];
/** UniProt isoform suffixes match the canonical accession a scientist watches (P12345-2 → P12345). */
const canonical = (accession: string) => accession.replace(/-\d+$/, '');

export async function notifyWatchers(
  deps: NotifyDeps,
  releaseId: string,
  actor: AuditActor,
  log?: FastifyBaseLogger,
): Promise<number> {
  try {
    return await notify(deps, releaseId, actor);
  } catch (error) {
    log?.error({ err: error, releaseId }, 'watch alerts failed');
    return 0;
  }
}

async function notify(deps: NotifyDeps, releaseId: string, actor: AuditActor): Promise<number> {
  const { db } = deps;
  const release = await db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .select(['r.id', 'r.status', 'd.kind', 'd.program_id', 'd.tenant_id'])
    .where('r.id', '=', releaseId)
    .executeTakeFirst();
  if (!release || release.status !== 'published') return 0;
  const kinds =
    release.kind === 'differential_abundance'
      ? ['protein', 'gene']
      : release.kind === 'dose_response'
        ? ['compound']
        : [];
  if (kinds.length === 0) return 0;

  // Watches of people who can read the release's program (a binding to it, or system admin).
  const watches = await db
    .selectFrom('watch as w')
    .select(['w.id', 'w.user_id', 'w.kind', 'w.key'])
    .where('w.tenant_id', '=', release.tenant_id)
    .where('w.deleted_at', 'is', null)
    .where('w.kind', 'in', kinds)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('role_binding as b')
          .select('b.id')
          .whereRef('b.user_id', '=', 'w.user_id')
          .where('b.deleted_at', 'is', null)
          .where((x) => x.or([x('b.program_id', '=', release.program_id), x('b.role', '=', 'system_admin')])),
      ),
    )
    .execute();
  if (watches.length === 0) return 0;

  const source = await resolveSource(db, { releaseIds: [releaseId] }, null);
  if (!source) return 0;
  const da = release.kind === 'differential_abundance';
  const spec = da
    ? {
        source: { releaseIds: [releaseId] },
        select: ['contrast_label', 'protein_ids', 'gene_names', 'log2_fc', 'adj_p_value'],
        where: {
          combinator: 'and',
          rules: [
            { field: 'adj_p_value', operator: '<=', value: ALERT_HIT_RULE.adj_p_max },
            {
              combinator: 'or',
              rules: [
                { field: 'log2_fc', operator: '>=', value: ALERT_HIT_RULE.abs_log2fc_min },
                { field: 'log2_fc', operator: '<=', value: -ALERT_HIT_RULE.abs_log2fc_min },
              ],
            },
          ],
        },
      }
    : { source: { releaseIds: [releaseId] }, select: ['compound_id'] };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec,
      source,
      joins: [],
      all_rows: MAX_HIT_ROWS,
    }),
  );

  type Pending = {
    watch: (typeof watches)[number];
    contrast: string;
    log2_fc: number | null;
    adj_p: number | null;
  };
  const pending: Pending[] = [];
  const byKey = new Map<string, typeof watches>();
  for (const w of watches) byKey.set(`${w.kind}:${w.key}`, [...(byKey.get(`${w.kind}:${w.key}`) ?? []), w]);
  const seen = new Set<string>();
  for (const row of result.rows) {
    const keys = da
      ? [
          ...new Set(list(row.protein_ids).map((a) => `protein:${canonical(a)}`)),
          ...new Set(list(row.gene_names).map((g) => `gene:${g}`)),
        ]
      : [`compound:${String(row.compound_id ?? '')}`];
    for (const key of keys) {
      for (const w of byKey.get(key) ?? []) {
        const id = `${w.id}|${da ? String(row.contrast_label ?? '') : ''}`;
        if (seen.has(id)) continue; // one alert per watch and contrast, even if several rows match
        seen.add(id);
        pending.push({
          watch: w,
          contrast: da ? String(row.contrast_label ?? '') : '',
          log2_fc: da && typeof row.log2_fc === 'number' ? row.log2_fc : null,
          adj_p: da && typeof row.adj_p_value === 'number' ? row.adj_p_value : null,
        });
      }
    }
  }
  if (pending.length === 0) return 0;
  const inserted = await db.transaction().execute(async (trx) => {
    const rows = await trx
      .insertInto('alert')
      .values(
        pending.map((p) => ({
          tenant_id: release.tenant_id,
          created_by: actor.userId,
          user_id: p.watch.user_id,
          watch_id: p.watch.id,
          release_id: releaseId,
          contrast_label: p.contrast,
          log2_fc: p.log2_fc,
          adj_p_value: p.adj_p,
          rule: da ? RULE : COMPOUND_RULE,
        })),
      )
      // Once per watch, release and contrast (a publish never alerts twice).
      .onConflict((oc) => oc.columns(['watch_id', 'release_id', 'contrast_label']).doNothing())
      .returning('id')
      .execute();
    if (rows.length)
      await insertAudit(trx, actor, {
        action: 'alerts.create',
        entityType: 'dataset_release',
        entityId: releaseId,
        after: { alerts: rows.length, rule: da ? RULE : COMPOUND_RULE },
      });
    return rows.length;
  });
  return inserted;
}
