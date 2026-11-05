import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease, topTable } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 25: hit triage board. Decisions (advance / watch / drop) keep their reasons in an append-only history.
describe('hit triage board', () => {
  let t: TestApi;
  let program: string;
  let scientist: string;
  let colleague: { id: string; token: string };
  let viewer: string;
  let outsider: string;
  let release: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('TRI');
    const other = await t.program('TRX');
    scientist = (await t.user('tri-scientist', { [program]: 'contributor' })).token;
    colleague = await t.user('tri-colleague', { [program]: 'contributor' });
    viewer = (await t.user('tri-viewer', { [program]: 'viewer' })).token;
    outsider = (await t.user('tri-outsider', { [other]: 'contributor' })).token;
    ({ release } = await publishedDaRelease(t, scientist, program, 'Triage DA'));
  }, 300_000);
  afterAll(() => t.close());

  const top = topTable()[0]!; // the most significant row of the fixture
  const reason = { 'x-change-reason': 'triage' };
  const create = (token: string, extra: Json = {}) =>
    t.call(token, {
      method: 'POST',
      url: '/v1/triage',
      payload: { program_id: program, kind: 'protein', key: top.id, label: 'Top hit', ...extra },
      headers: reason,
    });
  let item: string;

  it('TRI-01: a contributor adds a protein with evidence; adding it again returns the same item', async () => {
    expect((await create(viewer)).statusCode).toBe(403);
    const res = await create(scientist, { evidence: { release_id: release } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Json;
    item = body.id;
    expect(body).toMatchObject({
      kind: 'protein',
      key: top.id,
      status: 'new',
      program_code: 'TRI',
      evidence_count: 1,
    });
    // The evidence is a snapshot of this protein's row in the (immutable) release.
    expect(body.evidence[0]).toMatchObject({ release_id: release, kind: 'differential_abundance' });
    expect(body.evidence[0].log2_fc).toBeCloseTo(top.logFC, 6);
    expect(body.evidence[0].adj_p_value).toBeCloseTo(top.adjP, 12);
    expect(body.events.map((e: Json) => e.type)).toEqual(['created', 'evidence']);

    const again = await create(colleague.token);
    expect(again.statusCode).toBe(200);
    expect((again.json() as Json).id).toBe(item);
  });

  it('TRI-01: the board lists items of readable programs only, filterable by status', async () => {
    const mine = (await t.call(viewer, { method: 'GET', url: '/v1/triage' })).json() as Json;
    expect(mine.items.map((i: Json) => i.id)).toContain(item);
    const theirs = (await t.call(outsider, { method: 'GET', url: '/v1/triage' })).json() as Json;
    expect(theirs.items.map((i: Json) => i.id)).not.toContain(item);
    expect((await t.call(outsider, { method: 'GET', url: `/v1/triage/${item}` })).statusCode).toBe(404);
    const advance = (
      await t.call(viewer, { method: 'GET', url: '/v1/triage?status=advance' })
    ).json() as Json;
    expect(advance.items.map((i: Json) => i.id)).not.toContain(item);
  });

  it('TRI-02: a status change needs a reason, is in the history, and writes an audit row', async () => {
    const patch = (payload: Json, token = scientist) =>
      t.call(token, { method: 'PATCH', url: `/v1/triage/${item}`, payload, headers: reason });
    const noReason = await patch({ status: 'advance' });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json()).toMatchObject({ field: 'reason' });
    expect((await patch({ status: 'advance', reason: 'Strong, consistent' }, viewer)).statusCode).toBe(403);
    const res = await patch({ status: 'advance', reason: 'Strong, consistent' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.status).toBe('advance');
    expect(body.events.at(-1)).toMatchObject({
      type: 'status',
      from: 'new',
      to: 'advance',
      text: 'Strong, consistent',
    });
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['action', 'reason'])
      .where('entity_id', '=', item)
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['triage.create', 'triage.evidence', 'triage.status']);
    expect(audit.at(-1)!.reason).toBe('Strong, consistent');
  });

  it('TRI-03: owners must be able to see the program; comments are kept in order', async () => {
    const outsiderId = (
      await t.db
        .selectFrom('app_user')
        .select('id')
        .where('sub', 'like', '%tri-outsider%')
        .executeTakeFirstOrThrow()
    ).id;
    const bad = await t.call(scientist, {
      method: 'PATCH',
      url: `/v1/triage/${item}`,
      payload: { owner_id: outsiderId },
      headers: reason,
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: 'owner_not_member', field: 'owner_id' });
    const owned = await t.call(scientist, {
      method: 'PATCH',
      url: `/v1/triage/${item}`,
      payload: { owner_id: colleague.id },
      headers: reason,
    });
    expect(owned.statusCode, owned.body).toBe(200);
    expect((owned.json() as Json).owner_id).toBe(colleague.id);

    for (const text of ['Check the dose series', 'Orthogonal assay booked']) {
      const c = await t.call(colleague.token, {
        method: 'POST',
        url: `/v1/triage/${item}/comments`,
        payload: { text },
      });
      expect(c.statusCode, c.body).toBe(201);
    }
    expect(
      (await t.call(viewer, { method: 'POST', url: `/v1/triage/${item}/comments`, payload: { text: 'no' } }))
        .statusCode,
    ).toBe(403);
    const detail = (await t.call(viewer, { method: 'GET', url: `/v1/triage/${item}` })).json() as Json;
    expect(detail.comment_count).toBe(2);
    expect(detail.events.filter((e: Json) => e.type === 'comment').map((e: Json) => e.text)).toEqual([
      'Check the dose series',
      'Orthogonal assay booked',
    ]);
    expect(detail.events.find((e: Json) => e.type === 'owner')).toMatchObject({ to: colleague.id });
  });

  it('TRI-03: evidence must be a release the caller can read, holding this protein', async () => {
    const missing = await t.call(scientist, {
      method: 'POST',
      url: `/v1/triage/${item}/evidence`,
      payload: { release_id: '01a19acc-804b-750b-a4df-b0582b0ff218' },
    });
    expect(missing.statusCode).toBe(404);
    const other = await create(scientist, { key: 'NOT_IN_ANY_RELEASE', evidence: { release_id: release } });
    expect(other.statusCode).toBe(422);
    expect(other.json()).toMatchObject({ code: 'not_in_release', field: 'evidence.release_id' });
  });
});
