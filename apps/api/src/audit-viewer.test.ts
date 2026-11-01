import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedDaRelease } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Minimal RFC 4180 parser for the export (quoted fields, doubled quotes, newlines inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

describe('audit viewer and per-entity history (SPEC M10)', () => {
  let t: TestApi;
  let P1: string;
  let approver: string;
  let viewer: string;
  let outsider: string;
  let admin: string;
  let experiment: string;
  let release: string;
  const TRICKY = '=HYPERLINK("x"), checked, "quoted"\nsecond line';

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    P1 = await t.program('AUD', { requiresApproval: true });
    const P2 = await t.program('AUD2');
    approver = (await t.user('Ada Approver', { [P1]: 'approver' })).token;
    viewer = (await t.user('aud-viewer', { [P1]: 'viewer' })).token;
    outsider = (await t.user('aud-outsider', { [P2]: 'viewer' })).token;
    const adminUser = await t.user('aud-admin', {});
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
    // The approver does the whole flow, so the release publish is an approval with a reason.
    ({ release } = await publishedDaRelease(t, approver, P1, 'Audited experiment'));
    experiment = (
      await t.db
        .selectFrom('experiment')
        .select('id')
        .where('name', '=', 'Audited experiment')
        .executeTakeFirstOrThrow()
    ).id;
    // An audit row whose reason needs CSV escaping and formula neutralising.
    await t.db
      .insertInto('audit_log')
      .values({
        tenant_id: (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id,
        actor_id: (
          await t.db
            .selectFrom('app_user')
            .select('id')
            .where('name', '=', 'Ada Approver')
            .executeTakeFirstOrThrow()
        ).id,
        actor_type: 'user',
        action: 'release.note',
        entity_type: 'dataset_release',
        entity_id: release,
        reason: TRICKY,
        request_id: 'test',
      })
      .execute();
  });
  afterAll(async () => t?.close());

  it('AUD-02: a system admin filters the audit log; others get 403', async () => {
    const res = await t.call(admin, { method: 'GET', url: '/v1/audit?action=release.publish' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((r: Json) => r.action === 'release.publish')).toBe(true);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity_id: release, actor_name: 'Ada Approver', reason: 'checked' }),
      ]),
    );
    expect((await t.call(approver, { method: 'GET', url: '/v1/audit' })).statusCode).toBe(403);
    const byEntity = (
      await t.call(admin, {
        method: 'GET',
        url: `/v1/audit?entity_type=dataset_release&entity_id=${release}`,
      })
    ).json() as Json;
    expect(new Set((byEntity.items as Json[]).map((r) => r.entity_id))).toEqual(new Set([release]));
  });

  it('AUD-02: the audit list pages newest first with a cursor', async () => {
    const first = (await t.call(admin, { method: 'GET', url: '/v1/audit?limit=2' })).json() as Json;
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = (
      await t.call(admin, { method: 'GET', url: `/v1/audit?limit=2&cursor=${first.next_cursor}` })
    ).json() as Json;
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.items[0].at <= first.items[1].at).toBe(true);
  });

  it('AUD-02: CSV export escapes fields, neutralises spreadsheet formulas and is itself audited', async () => {
    const res = await t.call(admin, {
      method: 'GET',
      url: `/v1/audit/export?entity_type=dataset_release&entity_id=${release}`,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-.*\.csv"/);
    const rows = parseCsv(res.body);
    expect(rows[0]).toEqual([
      'at',
      'actor',
      'actor_type',
      'action',
      'entity_type',
      'entity_id',
      'reason',
      'request_id',
    ]);
    const tricky = rows.find((r) => r[3] === 'release.note')!;
    // OWASP CSV injection: a leading = + - @ is prefixed with ' so spreadsheets show text, not a formula.
    expect(tricky[6]).toBe(`'${TRICKY}`);
    expect(rows.find((r) => r[3] === 'release.publish')).toEqual(
      expect.arrayContaining(['Ada Approver', 'checked']),
    );
    const exported = await t.db
      .selectFrom('audit_log')
      .select(['action', 'after'])
      .where('action', '=', 'audit.export')
      .execute();
    expect(exported).toHaveLength(1);
    expect(exported[0]!.after).toMatchObject({ rows: rows.length - 1 });
  });

  it('AUD-02: per-entity history is visible to readers of the program and shows reason and approver', async () => {
    const res = await t.call(viewer, { method: 'GET', url: `/v1/history/dataset_release/${release}` });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as Json).items as Json[];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'release.publish', actor_name: 'Ada Approver', reason: 'checked' }),
      ]),
    );
    expect(
      (await t.call(outsider, { method: 'GET', url: `/v1/history/dataset_release/${release}` })).statusCode,
    ).toBe(404);
    // An experiment's history includes its versions (publish with reason).
    const exp = (
      await t.call(viewer, { method: 'GET', url: `/v1/history/experiment/${experiment}` })
    ).json() as Json;
    const actions = (exp.items as Json[]).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['experiment.create', 'experiment_version.publish']));
    expect((exp.items as Json[]).find((r) => r.action === 'experiment_version.publish')).toMatchObject({
      reason: 'ready',
    });
    expect((await t.call(viewer, { method: 'GET', url: '/v1/history/sample/x' })).statusCode).toBe(400);
  });
});
