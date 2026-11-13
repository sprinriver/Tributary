// Triage board storage (Phase 25): items, evidence snapshots and the append-only event history.
import { QueryResultSchema, type TriageDetail, type TriageItem } from '@tributary/contracts';
import type { Database, DB } from '@tributary/db';
import type { Kysely, Transaction } from 'kysely';
import type { FastifyRequest } from 'fastify';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError, notFound } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';

type Db = Kysely<DB> | Transaction<DB>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

function items(db: Db) {
  return db
    .selectFrom('triage_item as i')
    .innerJoin('program as p', 'p.id', 'i.program_id')
    .leftJoin('app_user as o', 'o.id', 'i.owner_id')
    .select((eb) => [
      'i.id',
      'i.program_id',
      'p.code as program_code',
      'i.kind',
      'i.key',
      'i.label',
      'i.status',
      'i.owner_id',
      'o.name as owner_name',
      'i.created_at',
      'i.updated_at',
      eb
        .selectFrom('triage_evidence as e')
        .select((e) => e.fn.countAll<string>().as('n'))
        .whereRef('e.item_id', '=', 'i.id')
        .where('e.deleted_at', 'is', null)
        .as('evidence_count'),
      eb
        .selectFrom('triage_event as c')
        .select((e) => e.fn.countAll<string>().as('n'))
        .whereRef('c.item_id', '=', 'i.id')
        .where('c.type', '=', 'comment')
        .as('comment_count'),
    ])
    .where('i.deleted_at', 'is', null);
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof items>['executeTakeFirstOrThrow']>>;
const toItem = (r: ItemRow): TriageItem => ({
  ...r,
  kind: r.kind as TriageItem['kind'],
  status: r.status as TriageItem['status'],
  evidence_count: Number(r.evidence_count ?? 0),
  comment_count: Number(r.comment_count ?? 0),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});

/** Items in the caller's readable programs (system admins: all). */
export async function listItems(
  db: Database,
  request: FastifyRequest,
  filter: { program_id?: string | undefined; status?: string | undefined; kind?: string | undefined },
): Promise<TriageItem[]> {
  const readable = readablePrograms(requirePrincipal(request));
  if (readable?.length === 0) return [];
  let q = items(db);
  if (readable) q = q.where('i.program_id', 'in', readable);
  if (filter.program_id) q = q.where('i.program_id', '=', filter.program_id);
  if (filter.status) q = q.where('i.status', '=', filter.status);
  if (filter.kind) q = q.where('i.kind', '=', filter.kind);
  return (await q.orderBy('i.updated_at', 'desc').limit(1000).execute()).map(toItem);
}

/** One item the caller can read (others are "not found", so links never reveal an item exists). */
export async function readableItem(db: Db, request: FastifyRequest, id: string): Promise<TriageItem> {
  const readable = readablePrograms(requirePrincipal(request));
  if (readable?.length === 0) throw notFound('Triage item');
  let q = items(db).where('i.id', '=', id);
  if (readable) q = q.where('i.program_id', 'in', readable);
  const row = await q.executeTakeFirst();
  if (!row) throw notFound('Triage item');
  return toItem(row);
}

export async function detail(db: Db, request: FastifyRequest, id: string): Promise<TriageDetail> {
  const item = await readableItem(db, request, id);
  const evidence = await db
    .selectFrom('triage_evidence as e')
    .innerJoin('dataset_release as r', 'r.id', 'e.release_id')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .leftJoin('app_user as u', 'u.id', 'e.created_by')
    .select([
      'e.id',
      'e.release_id',
      'd.name as dataset_name',
      'd.kind',
      'e.contrast_label',
      'e.log2_fc',
      'e.adj_p_value',
      'u.name as added_by',
      'e.created_at',
    ])
    .where('e.item_id', '=', id)
    .where('e.deleted_at', 'is', null)
    .orderBy('e.id')
    .execute();
  const events = await db
    .selectFrom('triage_event as v')
    .leftJoin('app_user as u', 'u.id', 'v.created_by')
    .select(['v.id', 'v.type', 'u.name as actor', 'v.created_at', 'v.from_value', 'v.to_value', 'v.text'])
    .where('v.item_id', '=', id)
    .orderBy('v.id')
    .execute();
  return {
    ...item,
    evidence: evidence.map(({ created_at, ...e }) => ({ ...e, added_at: iso(created_at) })),
    events: events.map((v) => ({
      id: v.id,
      type: v.type as TriageDetail['events'][number]['type'],
      actor: v.actor,
      at: iso(v.created_at),
      from: v.from_value,
      to: v.to_value,
      text: v.text,
    })),
  };
}

export async function addEvent(
  db: Db,
  actor: { tenantId: string; userId: string },
  itemId: string,
  type: TriageDetail['events'][number]['type'],
  values: { from?: string | null; to?: string | null; text?: string | null } = {},
): Promise<void> {
  await db
    .insertInto('triage_event')
    .values({
      tenant_id: actor.tenantId,
      created_by: actor.userId,
      item_id: itemId,
      type,
      from_value: values.from ?? null,
      to_value: values.to ?? null,
      text: values.text ?? null,
    })
    .execute();
}

/**
 * A snapshot of the item's row in a release the caller can read: for a protein, its row in a differential-abundance
 * release (log2 fold change and adjusted p of the contrast); for a compound, its presence in a dose-response release.
 */
export async function evidenceSnapshot(
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
  request: FastifyRequest,
  item: { kind: string; key: string },
  ref: { release_id: string; contrast_label?: string | undefined },
  field: string,
): Promise<{ contrast_label: string | null; log2_fc: number | null; adj_p_value: number | null }> {
  const source = await resolveSource(
    deps.db,
    { releaseIds: [ref.release_id] },
    readablePrograms(requirePrincipal(request)),
  );
  if (!source) throw notFound('Release');
  const protein = item.kind === 'protein';
  const expected = protein ? 'differential_abundance' : 'dose_response';
  if (source.kind !== expected)
    throw new HttpError(
      422,
      'wrong_kind',
      `Evidence for a ${item.kind} is a ${expected.replace('_', '-')} release.`,
      field,
    );
  const rules: Record<string, unknown>[] = protein
    ? [{ field: 'protein_ids', operator: 'contains', value: item.key }]
    : [{ field: 'compound_id', operator: '=', value: item.key }];
  if (protein && ref.contrast_label)
    rules.push({ field: 'contrast_label', operator: '=', value: ref.contrast_label });
  const internal = {
    spec: {
      source: { releaseIds: [ref.release_id] },
      select: protein ? ['contrast_label', 'log2_fc', 'adj_p_value'] : ['compound_id'],
      where: { combinator: 'and', rules },
    },
    source,
    joins: [],
    all_rows: 1000,
  };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', internal),
  );
  if (result.rows.length === 0)
    throw new HttpError(422, 'not_in_release', `${item.key} is not in this release.`, field);
  if (!protein) return { contrast_label: null, log2_fc: null, adj_p_value: null };
  const labels = new Set(result.rows.map((r) => String(r.contrast_label ?? '')));
  if (labels.size > 1)
    throw new HttpError(
      422,
      'contrast_required',
      `This release has ${labels.size} contrasts for ${item.key}: choose one.`,
      field,
    );
  const row = result.rows[0]!;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    contrast_label:
      row.contrast_label === null || row.contrast_label === undefined ? null : String(row.contrast_label),
    log2_fc: num(row.log2_fc),
    adj_p_value: num(row.adj_p_value),
  };
}
