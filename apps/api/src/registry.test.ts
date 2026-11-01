import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const row = (key: string, extra: Record<string, string> = {}) => ({
  sample_key: key,
  source_name: `${key} source`,
  organism: 'Homo sapiens',
  compound_id: 'CPD-000001',
  dose: '1 µM',
  time: '24 h',
  well: 'A01',
  ...extra,
});

describe('registry API', () => {
  let t: TestApi;
  let P1: string;
  let P2: string;
  let contributor: string;
  let viewer: string;
  let p2Contributor: string;
  let p2Approver: string;

  beforeAll(async () => {
    t = await startTestApi();
    P1 = await t.program('P1');
    P2 = await t.program('P2', { requiresApproval: true });
    contributor = (await t.user('contributor', { [P1]: 'contributor' })).token;
    viewer = (await t.user('viewer', { [P1]: 'viewer' })).token;
    p2Contributor = (await t.user('p2contributor', { [P2]: 'contributor' })).token;
    p2Approver = (await t.user('p2approver', { [P2]: 'approver' })).token;
  });
  afterAll(() => t.close());

  const reason = (text: string) => ({ 'x-change-reason': text });
  async function create(token: string, body: Json): Promise<Json> {
    const res = await t.call(token, {
      method: 'POST',
      url: '/v1/experiments',
      payload: body,
      headers: reason('create'),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as Json;
  }
  const versionId = (experiment: Json) => experiment.versions[0].id as string;
  async function putSamples(token: string, version: string, rows: Json[]) {
    return t.call(token, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: { rows },
      headers: reason('samples'),
    });
  }
  async function publish(token: string, version: string, why = 'ready for analysis') {
    return t.call(token, {
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      payload: { reason: why },
    });
  }
  async function list(token: string, query: Record<string, string> = {}): Promise<Json> {
    const res = await t.call(token, { method: 'GET', url: '/v1/experiments', query });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Json;
  }

  it('REG-01: create an experiment with details, time points and custom fields (searchable flag)', async () => {
    const experiment = await create(contributor, {
      program_id: P1,
      assay_type: 'proteomics_dia',
      name: 'REG-01 dose series',
      experiment_date: '2026-09-01',
      species: { id: 'NCBITaxon:9606', label: 'Homo sapiens' },
      spectral_library: 'Human proteome library',
      time_points: ['6 h', '24 h'],
      description: 'Kinetics of response',
      custom_fields: [
        {
          scope: 'experiment',
          key: 'operator',
          label: 'Operator',
          type: 'text',
          required: false,
          searchable: true,
        },
        {
          scope: 'experiment',
          key: 'lc_gradient_min',
          label: 'LC gradient (min)',
          type: 'integer',
          required: false,
          searchable: false,
        },
      ],
      custom: { operator: 'Lab A', lc_gradient_min: '45' },
    });
    expect(experiment.urn).toBe(`urn:tributary:experiment:${experiment.id}`);
    const res = await t.call(contributor, { method: 'GET', url: `/v1/versions/${versionId(experiment)}` });
    expect(res.statusCode).toBe(200);
    const version = res.json() as Json;
    expect(version).toMatchObject({
      version_number: 1,
      status: 'draft',
      experiment_date: '2026-09-01',
      spectral_library: 'Human proteome library',
      species: { id: 'NCBITaxon:9606' },
      custom: { operator: 'Lab A', lc_gradient_min: 45 },
    });
    expect(version.time_points.map((q: Json) => q.canonical)).toEqual([6, 24]);
    expect(version.custom_fields.map((f: Json) => [f.key, f.searchable])).toEqual([
      ['operator', true],
      ['lc_gradient_min', false],
    ]);
  });

  it('REG-01: invalid custom values and unknown programs are rejected with field errors', async () => {
    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/experiments',
      payload: {
        program_id: P1,
        assay_type: 'proteomics_dia',
        name: 'bad',
        custom_fields: [
          { scope: 'experiment', key: 'n', label: 'N', type: 'integer', required: false, searchable: false },
        ],
        custom: { n: 'many' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ field: 'custom.n', code: 'invalid_integer' });
  });

  it('REG-02: list filters by type, program, dates, name and text; sorts; paginates with a cursor; scopes by program', async () => {
    const names = ['Alpha screen', 'Beta series', 'Gamma panel', 'Delta map', 'Epsilon run'];
    for (const [i, name] of names.entries()) {
      await create(contributor, {
        program_id: P1,
        assay_type: i % 2 ? 'rnaseq' : 'proteomics_tmt',
        name: `REG-02 ${name}`,
        experiment_date: `2026-0${i + 1}-15`,
        description: i === 3 ? 'contains the word sparrowhawk' : 'plain',
      });
    }
    await create(p2Contributor, { program_id: P2, assay_type: 'rnaseq', name: 'REG-02 hidden in P2' });

    const all = await list(contributor, { name: 'REG-02' });
    expect(all.items.map((e: Json) => e.name)).toHaveLength(5);

    const rnaseq = await list(contributor, { name: 'REG-02', assay_type: 'rnaseq' });
    expect(rnaseq.items.map((e: Json) => e.name).sort()).toEqual(['REG-02 Beta series', 'REG-02 Delta map']);

    const dated = await list(contributor, { name: 'REG-02', date_from: '2026-02-01', date_to: '2026-04-30' });
    expect(dated.items).toHaveLength(3);

    const text = await list(contributor, { q: 'sparrowhawk' });
    expect(text.items.map((e: Json) => e.name)).toEqual(['REG-02 Delta map']);

    const byProgram = await list(contributor, { name: 'REG-02', program_id: P1 });
    expect(byProgram.items).toHaveLength(5);

    const sorted = await list(contributor, { name: 'REG-02', sort: 'name', dir: 'desc' });
    expect(sorted.items.map((e: Json) => e.name)).toEqual(
      [...names]
        .sort()
        .reverse()
        .map((n) => `REG-02 ${n}`),
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(contributor, {
        name: 'REG-02',
        sort: 'name',
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((e: Json) => e.name as string));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([...names].sort().map((n) => `REG-02 ${n}`));

    const asViewer = await list(viewer, { name: 'REG-02' });
    expect(asViewer.items.map((e: Json) => e.name)).not.toContain('REG-02 hidden in P2');
    const outsider = await t.call(viewer, {
      method: 'GET',
      url: '/v1/experiments',
      query: { program_id: P2 },
    });
    expect((outsider.json() as Json).items).toEqual([]);
  });

  it('REG-03: publish requires a reason, samples and a clean manifest validated against the pinned template', async () => {
    const experiment = await create(contributor, {
      program_id: P1,
      assay_type: 'proteomics_dia',
      name: 'REG-03 publish',
    });
    const version = versionId(experiment);

    const noReason = await t.call(contributor, {
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json()).toMatchObject({ code: 'reason_required' });

    const empty = await publish(contributor, version);
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ code: 'no_samples' });

    const saved = await putSamples(contributor, version, [row('S1'), row('S2', { well: 'Z99' })]);
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as Json).errors).toEqual([
      expect.objectContaining({ field: 'rows.1.well', code: 'invalid_well' }),
    ]);

    const blocked = await publish(contributor, version);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({
      code: 'manifest_invalid',
      errors: [expect.objectContaining({ field: 'rows.1.well' })],
    });

    expect((await putSamples(contributor, version, [row('S2', { well: 'B01' })])).statusCode).toBe(200);
    const ok = await publish(contributor, version, 'QC reviewed');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'published', publish_reason: 'QC reviewed' });

    const audit = await t.db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_id', '=', version)
      .where('action', '=', 'experiment_version.publish')
      .executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ reason: 'QC reviewed' });
    expect(audit.after).toMatchObject({ status: 'published' });
  });

  it('REG-03: a program that requires approval needs an approver to publish', async () => {
    const experiment = await create(p2Contributor, {
      program_id: P2,
      assay_type: 'proteomics_dia',
      name: 'REG-03 approval',
    });
    const version = versionId(experiment);
    await putSamples(p2Contributor, version, [row('S1')]);
    expect((await publish(p2Contributor, version)).statusCode).toBe(403);
    const approved = await publish(p2Approver, version);
    expect(approved.statusCode, approved.body).toBe(200);
  });

  it('REG-04: published versions return 409 on edit; clone makes a linked draft; archive hides from default lists', async () => {
    const experiment = await create(contributor, {
      program_id: P1,
      assay_type: 'proteomics_dia',
      name: 'REG-04 lifecycle',
    });
    const v1 = versionId(experiment);
    await putSamples(contributor, v1, [row('S1'), row('S2', { well: 'A02' })]);
    expect((await publish(contributor, v1)).statusCode).toBe(200);

    const patch = await t.call(contributor, {
      method: 'PATCH',
      url: `/v1/versions/${v1}`,
      payload: { description: 'x' },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json()).toMatchObject({ code: 'immutable' });
    expect((await putSamples(contributor, v1, [row('S3')])).statusCode).toBe(409);

    const clone = await t.call(contributor, {
      method: 'POST',
      url: `/v1/versions/${v1}/clone`,
      headers: reason('v2'),
    });
    expect(clone.statusCode, clone.body).toBe(201);
    const v2 = clone.json() as Json;
    expect(v2).toMatchObject({ version_number: 2, status: 'draft', parent_version_id: v1 });
    const samples = await t.call(contributor, { method: 'GET', url: `/v1/versions/${v2.id}/samples` });
    expect((samples.json() as Json).items.map((s: Json) => s.sample_key)).toEqual(['S1', 'S2']);

    const archive = await t.call(contributor, {
      method: 'POST',
      url: `/v1/experiments/${experiment.id}/archive`,
      headers: reason('done'),
    });
    expect(archive.statusCode).toBe(200);
    expect((await list(contributor, { name: 'REG-04' })).items).toEqual([]);
    expect((await list(contributor, { name: 'REG-04', include_archived: 'true' })).items).toHaveLength(1);
    expect(
      (await t.call(contributor, { method: 'GET', url: `/v1/experiments/${experiment.id}` })).statusCode,
    ).toBe(200);
  });

  it('REG-05: diff reports exactly the changed fields and sample rows', async () => {
    const experiment = await create(contributor, {
      program_id: P1,
      assay_type: 'proteomics_dia',
      name: 'REG-05 diff',
      description: 'first',
    });
    const v1 = versionId(experiment);
    await putSamples(contributor, v1, [
      row('S1'),
      row('S2', { well: 'A02' }),
      row('S3', { well: 'A03' }),
      row('S4', { well: 'A04' }),
    ]);
    await publish(contributor, v1);
    const v2 = (
      (await t.call(contributor, { method: 'POST', url: `/v1/versions/${v1}/clone` })).json() as Json
    ).id as string;

    await t.call(contributor, {
      method: 'PATCH',
      url: `/v1/versions/${v2}`,
      payload: { description: 'second' },
    });
    await putSamples(contributor, v2, [
      row('S1', { dose: '10 µM' }),
      row('S2', { well: 'B02' }),
      row('S5', { well: 'A05' }),
    ]);
    await t.call(contributor, {
      method: 'DELETE',
      url: `/v1/versions/${v2}/samples`,
      payload: { sample_keys: ['S4'] },
    });

    const res = await t.call(contributor, { method: 'GET', url: `/v1/versions/${v1}/diff/${v2}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      fields: [{ field: 'description', before: 'first', after: 'second' }],
      custom: [],
      custom_fields: { added: [], removed: [] },
      samples: {
        added: ['S5'],
        removed: ['S4'],
        changed: [
          { sample_key: 'S1', fields: [{ field: 'dose', before: '1 µM', after: '10 µM' }] },
          { sample_key: 'S2', fields: [{ field: 'well', before: 'A02', after: 'B02' }] },
        ],
      },
      contrasts: { added: [], removed: [] },
    });
  });

  it('REG-06: URNs for experiments and versions; latest-published flag follows the newest published version', async () => {
    const experiment = await create(contributor, {
      program_id: P1,
      assay_type: 'proteomics_dia',
      name: 'REG-06 urns',
    });
    const v1 = versionId(experiment);
    await putSamples(contributor, v1, [row('S1')]);
    await publish(contributor, v1);
    const v2 = (
      (await t.call(contributor, { method: 'POST', url: `/v1/versions/${v1}/clone` })).json() as Json
    ).id as string;

    const versions = async () =>
      (
        (
          await t.call(contributor, { method: 'GET', url: `/v1/experiments/${experiment.id}/versions` })
        ).json() as Json
      ).items as Json[];
    let current = await versions();
    expect(current.map((v) => v.urn)).toEqual([`${experiment.urn}:v1`, `${experiment.urn}:v2`]);
    expect(current.map((v) => v.is_latest_published)).toEqual([true, false]);

    await publish(contributor, v2);
    current = await versions();
    expect(current.map((v) => v.is_latest_published)).toEqual([false, true]);
    const listed = (await list(contributor, { name: 'REG-06' })).items[0] as Json;
    expect(listed).toMatchObject({
      latest_published_version: 2,
      current_version: { version_number: 2, status: 'published' },
    });
  });
});
