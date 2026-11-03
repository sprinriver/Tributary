import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease, topTable } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 26: watchlists and alerts. An alert is a newly published release, readable by the watcher, with a hit
// (adjusted p ≤ 0.05 and |log2 FC| ≥ 1) for something they watch.
describe('watchlists and alerts', () => {
  let t: TestApi;
  let program: string;
  let scientist: { id: string; token: string };
  let outsider: string;
  const rows = topTable();
  const hit = rows.find((r) => r.adjP <= 0.05 && Math.abs(r.logFC) >= 1)!;
  const quiet = rows.find((r) => r.adjP > 0.5)!; // measured, but not a hit

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('WAT');
    const other = await t.program('WAX');
    scientist = await t.user('wat-scientist', { [program]: 'contributor' });
    outsider = (await t.user('wat-outsider', { [other]: 'contributor' })).token;
  }, 300_000);
  afterAll(() => t.close());

  const watch = (token: string, payload: Json) =>
    t.call(token, { method: 'POST', url: '/v1/watches', payload });
  let watchId: string;

  it('WAT-01: watching is idempotent, listed, soft-deleted and audited', async () => {
    const res = await watch(scientist.token, { kind: 'protein', key: hit.id, label: 'top hit' });
    expect(res.statusCode, res.body).toBe(201);
    watchId = (res.json() as Json).id;
    expect((await watch(scientist.token, { kind: 'protein', key: hit.id })).statusCode).toBe(200);
    const temp = (await watch(scientist.token, { kind: 'compound', key: 'CPD-000001' })).json() as Json;
    const deleted = await t.call(scientist.token, { method: 'DELETE', url: `/v1/watches/${temp.id}` });
    expect(deleted.statusCode).toBe(204);
    const list = (await t.call(scientist.token, { method: 'GET', url: '/v1/watches' })).json() as Json;
    expect(list.items.map((w: Json) => w.key)).toEqual([hit.id]);
    const row = await t.db
      .selectFrom('watch')
      .select('deleted_at')
      .where('id', '=', temp.id)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
    const actions = (
      await t.db.selectFrom('audit_log').select('action').where('entity_type', '=', 'watch').execute()
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['watch.create', 'watch.delete']));
    // Other people's watches are not theirs to delete.
    expect((await t.call(outsider, { method: 'DELETE', url: `/v1/watches/${watchId}` })).statusCode).toBe(
      404,
    );
  });

  it('WAT-02: publishing a release alerts watchers of its hits — only readers, only hits, once', async () => {
    await watch(scientist.token, { kind: 'protein', key: quiet.id });
    await watch(outsider, { kind: 'protein', key: hit.id }); // cannot read program WAT
    const { release } = await publishedDaRelease(t, scientist.token, program, 'Watched DA');
    const alerts = (await t.call(scientist.token, { method: 'GET', url: '/v1/alerts' })).json() as Json;
    expect(alerts.unread).toBe(1);
    expect(alerts.items).toHaveLength(1);
    const [alert] = alerts.items;
    expect(alert).toMatchObject({
      release_id: release,
      program_code: 'WAT',
      watch: { kind: 'protein', key: hit.id },
      read_at: null,
    });
    expect(alert.log2_fc).toBeCloseTo(hit.logFC, 6);
    expect(alert.adj_p_value).toBeCloseTo(hit.adjP, 12);
    expect(alert.contrast_label).toContain(' vs ');
    expect(alert.rule).toMatch(/adjusted p ≤ 0\.05/);
    const theirs = (await t.call(outsider, { method: 'GET', url: '/v1/alerts' })).json() as Json;
    expect(theirs.items).toHaveLength(0);
    const stored = await t.db.selectFrom('alert').select('id').where('release_id', '=', release).execute();
    expect(stored).toHaveLength(1);
  });

  it('WAT-03: alerts are marked read one by one or all at once, by their owner only', async () => {
    const { items } = (await t.call(scientist.token, { method: 'GET', url: '/v1/alerts' })).json() as Json;
    expect(
      (await t.call(outsider, { method: 'POST', url: `/v1/alerts/${items[0].id}/read` })).statusCode,
    ).toBe(404);
    const read = await t.call(scientist.token, { method: 'POST', url: `/v1/alerts/${items[0].id}/read` });
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as Json).read_at).not.toBeNull();
    const unread = (
      await t.call(scientist.token, { method: 'GET', url: '/v1/alerts?unread_only=true' })
    ).json() as Json;
    expect(unread).toMatchObject({ items: [], unread: 0 });
    const all = await t.call(scientist.token, { method: 'POST', url: '/v1/alerts/read-all' });
    expect((all.json() as Json).unread).toBe(0);
  });
});
