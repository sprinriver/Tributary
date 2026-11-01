import { SEED_PROTEOMICS_TEMPLATE } from '@tributary/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestRows } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PASSAGE = {
  scope: 'sample',
  key: 'passage',
  label: 'Passage',
  type: 'integer',
  required: true,
  searchable: false,
} as const;

/** SPEC M11 check: template v1.1 adds a required field → published versions stay valid → new drafts follow it. */
describe('template versioning (SPEC M11)', () => {
  let t: TestApi;
  let program: string;
  let contributor: string;
  let admin: string;
  let published: { experiment: string; version: string };

  const as = (token: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Json) =>
    t.call(token, { method, url, ...(payload ? { payload } : {}), headers: { 'x-change-reason': 'test' } });
  const experiment = async (name: string) => {
    const created = (
      await as(contributor, 'POST', '/v1/experiments', {
        program_id: program,
        assay_type: 'proteomics_dda',
        name,
      })
    ).json() as Json;
    const version = created.versions[0] as Json;
    await as(contributor, 'PUT', `/v1/versions/${version.id}/samples`, { rows: manifestRows() });
    const detail = (await as(contributor, 'GET', `/v1/versions/${version.id}`)).json() as Json;
    return {
      experiment: created.id as string,
      version: version.id as string,
      template: detail.template_version as string,
    };
  };

  beforeAll(async () => {
    t = await startTestApi();
    program = await t.program('TPL');
    contributor = (await t.user('tpl-contributor', { [program]: 'contributor' })).token;
    const adminUser = await t.user('tpl-admin', {});
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
    const made = await experiment('Published under 1.0.0');
    expect(made.template).toBe('1.0.0');
    const res = await as(contributor, 'POST', `/v1/versions/${made.version}/publish`, { reason: 'ready' });
    expect(res.statusCode, res.body).toBe(200);
    published = made;
  });
  afterAll(async () => t?.close());

  it('ADM-01: admins list template versions with how many experiment versions pin each; others get 403', async () => {
    const res = await as(admin, 'GET', '/v1/admin/templates?assay_type=proteomics_dda');
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as Json).items as Json[];
    expect(items[0]).toMatchObject({
      assay_type: 'proteomics_dda',
      version: '1.0.0',
      status: 'published',
      built_in: true,
      pinned: { draft: 0, published: 1, archived: 0 },
    });
    expect((await as(contributor, 'GET', '/v1/admin/templates?assay_type=proteomics_dda')).statusCode).toBe(
      403,
    );
  });

  it('ADM-01: a new version starts as a draft with a migration preview, and publishing it is audited', async () => {
    const created = await as(admin, 'POST', '/v1/admin/templates', {
      assay_type: 'proteomics_dda',
      bump: 'minor',
      fields: [...SEED_PROTEOMICS_TEMPLATE.fields, PASSAGE],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ version: '1.1.0', status: 'draft', built_in: false });

    const preview = (
      await as(admin, 'GET', '/v1/admin/templates/proteomics_dda/1.1.0/preview')
    ).json() as Json;
    expect(preview).toMatchObject({
      version: '1.1.0',
      base_version: '1.0.0',
      added: ['passage'],
      removed: [],
      newly_required: ['passage'],
      pinned: [{ version: '1.0.0', draft: 0, published: 1, archived: 0 }],
    });

    // While 1.1.0 is a draft, new experiments still pin 1.0.0.
    expect((await experiment('Created while 1.1.0 is a draft')).template).toBe('1.0.0');

    const pub = await as(admin, 'POST', '/v1/admin/templates/proteomics_dda/1.1.0/publish', {
      reason: 'Passage number is now required',
    });
    expect(pub.statusCode, pub.body).toBe(200);
    expect(pub.json()).toMatchObject({ version: '1.1.0', status: 'published' });
    expect(
      (await as(admin, 'POST', '/v1/admin/templates/proteomics_dda/1.1.0/publish', { reason: 'again' }))
        .statusCode,
    ).toBe(409);
    const actions = (
      await t.db
        .selectFrom('audit_log')
        .select('action')
        .where('entity_type', '=', 'metadata_template')
        .execute()
    ).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['template.create', 'template.publish']));
  });

  it('ADM-01: published versions stay valid under their pinned template; new drafts must satisfy the new one', async () => {
    // The published version keeps 1.0.0 and its samples.
    const old = (await as(contributor, 'GET', `/v1/versions/${published.version}`)).json() as Json;
    expect(old).toMatchObject({ status: 'published', template_version: '1.0.0' });

    // A new experiment and a new version of the old experiment both pin 1.1.0 and need the new field.
    const fresh = await experiment('Created after 1.1.0');
    expect(fresh.template).toBe('1.1.0');
    const blocked = await as(contributor, 'POST', `/v1/versions/${fresh.version}/publish`, {
      reason: 'ready',
    });
    expect(blocked.statusCode).toBe(422);
    expect(JSON.stringify(blocked.json())).toContain('passage');

    const clone = await as(contributor, 'POST', `/v1/versions/${published.version}/clone`);
    expect(clone.statusCode, clone.body).toBe(201);
    expect((clone.json() as Json).template_version).toBe('1.1.0');

    // Filling the field makes the draft publishable.
    const rows = manifestRows().map((r, i) => ({ ...r, passage: String(i + 3) }));
    await as(contributor, 'PUT', `/v1/versions/${fresh.version}/samples`, { rows });
    const ok = await as(contributor, 'POST', `/v1/versions/${fresh.version}/publish`, { reason: 'ready' });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('ADM-01: a new version must keep the key field and use unique keys', async () => {
    const noKey = await as(admin, 'POST', '/v1/admin/templates', {
      assay_type: 'proteomics_dda',
      bump: 'patch',
      fields: SEED_PROTEOMICS_TEMPLATE.fields.filter((f) => f.key !== 'sample_key'),
    });
    expect(noKey.statusCode).toBe(422);
    expect((noKey.json() as Json).code).toBe('key_field_missing');
    const dup = await as(admin, 'POST', '/v1/admin/templates', {
      assay_type: 'proteomics_dda',
      bump: 'patch',
      fields: [...SEED_PROTEOMICS_TEMPLATE.fields, { ...PASSAGE, key: 'organism' }],
    });
    expect(dup.statusCode).toBe(422);
    expect((dup.json() as Json).code).toBe('duplicate_field');
    const bad = await as(admin, 'POST', '/v1/admin/templates', {
      assay_type: 'proteomics_dda',
      bump: 'huge',
    });
    expect(bad.statusCode).toBe(400);
  });
});
