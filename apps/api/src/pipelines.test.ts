import { PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeRunner } from './pipelines/fake.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-05');
const manifest = () => {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
};
const CONTRAST = { numerator: 'CPD-000005@1 µM', denominator: 'DMSO', label: 'CPD-000005@1 µM vs DMSO' };
const OUTPUTS = { diann_pg_matrix: 'report.pg_matrix.tsv', limma_toptable: 'toptable.tsv' };

describe('pipeline runs', () => {
  let t: TestApi;
  let fake: FakeRunner;
  let program: string;
  let contributor: string;
  let approver: string;
  let admin: string;
  let definition: string;

  beforeAll(async () => {
    fake = new FakeRunner();
    t = await startTestApi({ s3: true, query: true, runners: { fake } });
    program = await t.program('PIP');
    contributor = (await t.user('pip-contributor', { [program]: 'contributor' })).token;
    approver = (await t.user('pip-approver', { [program]: 'approver' })).token;
    const adminUser = await t.user('pip-admin', {});
    const { tenant_id } = await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow();
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
    const res = await t.call(admin, {
      method: 'POST',
      url: '/v1/admin/pipelines',
      payload: {
        key: 'demo',
        name: 'Demo DIA pipeline',
        repo: 'pipelines/demo',
        revision: 'local',
        runner_types: ['fake', 'local'],
        assay_types: ['proteomics_dia'],
        params_schema: {},
        default_params: {
          pg_matrix: '/fixtures/experiments/ONC-DIA-05/report.pg_matrix.tsv',
          toptable: '/fixtures/experiments/ONC-DIA-05/toptable.tsv',
        },
        output_importers: OUTPUTS,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    definition = (res.json() as Json).id;
  }, 300_000);
  afterAll(() => t.close());

  /** A published version with the ONC-DIA-05 manifest and contrast. */
  async function publishedVersion(name: string): Promise<string> {
    const created = (
      await t.call(contributor, {
        method: 'POST',
        url: '/v1/experiments',
        payload: { program_id: program, assay_type: 'proteomics_dia', name },
      })
    ).json() as Json;
    const version = created.versions[0].id as string;
    expect(
      (
        await t.call(contributor, {
          method: 'PUT',
          url: `/v1/versions/${version}/samples`,
          payload: { rows: manifest() },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await t.call(contributor, {
          method: 'PUT',
          url: `/v1/versions/${version}/contrasts`,
          payload: { contrasts: [CONTRAST] },
        })
      ).statusCode,
    ).toBe(200);
    return version;
  }
  async function publish(version: string) {
    const res = await t.call(contributor, {
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      payload: { reason: 'ready to run' },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  const launch = (token: string, version: string, runner = 'fake') =>
    t.call(token, {
      method: 'POST',
      url: '/v1/runs',
      payload: { pipeline_definition_id: definition, experiment_version_id: version, runner, params: {} },
      headers: { 'x-change-reason': 'analysis' },
    });
  const run = async (id: string) =>
    (await t.call(contributor, { method: 'GET', url: `/v1/runs/${id}` })).json() as Json;

  async function uploadRaw(version: string, name: string, bytes: Uint8Array) {
    const started = (
      await t.call(contributor, {
        method: 'POST',
        url: '/v1/files/uploads',
        payload: { experiment_version_id: version, name, size_bytes: bytes.length },
      })
    ).json() as Json;
    const put = await fetch(started.parts[0].url, { method: 'PUT', body: bytes });
    await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/complete`,
      payload: { parts: [{ part_number: 1, etag: put.headers.get('etag') }] },
    });
    await t.drainIngest();
  }

  it('PIPE-01: launch requires a published version and is rejected (422) while QC failed until an approver overrides', async () => {
    const version = await publishedVersion('PIPE-01 gate');
    expect((await launch(contributor, version)).statusCode).toBe(422);
    // A failed raw file on the draft, then publish.
    await uploadRaw(version, 'broken.tsv', new Uint8Array(4000).fill(0));
    await publish(version);
    const blocked = await launch(contributor, version);
    expect(blocked.statusCode).toBe(422);
    expect((blocked.json() as Json).code).toBe('qc_gate');
    expect(
      (
        await t.call(approver, {
          method: 'POST',
          url: `/v1/versions/${version}/qc-override`,
          payload: { reason: 'Binary placeholder, not used by the pipeline' },
        })
      ).statusCode,
    ).toBe(201);
    const ok = await launch(contributor, version);
    expect(ok.statusCode, ok.body).toBe(201);
    const created = ok.json() as Json;
    expect(created).toMatchObject({ status: 'submitted', runner: 'fake', pipeline_key: 'demo' });
    expect(created.external_id).toBeTruthy();
    expect(created.output_uri).toMatch(/^s3:\/\/.+\/runs\/.+\/output\/$/);
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', created.id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('run.launch');
  });

  it('PIPE-02: status events are idempotent and out-of-order safe; the poller fills gaps', async () => {
    const version = await publishedVersion('PIPE-02 events');
    await publish(version);
    const created = (await launch(contributor, version)).json() as Json;
    const event = (status: string, time: string) => ({
      source: 'aws.batch',
      'detail-type': 'Batch Job State Change',
      time,
      detail: { jobId: created.external_id, status },
    });
    // The fake runner stands in for a Batch job here: events address it by external id.
    await t.pipelines.event(event('RUNNING', '2026-10-30T10:02:00Z'), 'fake');
    await t.pipelines.event(event('RUNNING', '2026-10-30T10:02:00Z'), 'fake'); // duplicate
    await t.pipelines.event(event('STARTING', '2026-10-30T10:01:00Z'), 'fake'); // late, older
    let current = await run(created.id);
    expect(current.status).toBe('running');
    expect(current.events.filter((e: Json) => e.external_status === 'RUNNING')).toHaveLength(1);
    expect(current.events.map((e: Json) => e.status)).toContain('starting');
    expect(current.started_at).toBeTruthy();

    // Terminal states never regress.
    await t.pipelines.event(event('FAILED', '2026-10-30T10:05:00Z'), 'fake');
    await t.pipelines.event(event('RUNNING', '2026-10-30T10:06:00Z'), 'fake');
    current = await run(created.id);
    expect(current.status).toBe('failed');
    expect(current.finished_at).toBeTruthy();

    // Poller: a missed event is picked up from the runner.
    const polled = (await launch(contributor, version)).json() as Json;
    fake.set(polled.external_id, 'running');
    await t.pipelines.poll();
    expect((await run(polled.id)).status).toBe('running');
    const sources = (await run(polled.id)).events.map((e: Json) => e.source);
    expect(sources).toContain('poll');
  });

  it('PIPE-03: log links and recent log lines per run; cancel', async () => {
    const version = await publishedVersion('PIPE-03 logs');
    await publish(version);
    const created = (await launch(contributor, version)).json() as Json;
    fake.log(created.external_id, ['N E X T F L O W  ~  version 25.10.0', 'executor >  local (1)']);
    const logs = (
      await t.call(contributor, { method: 'GET', url: `/v1/runs/${created.id}/logs` })
    ).json() as Json;
    expect(logs.lines).toEqual(['N E X T F L O W  ~  version 25.10.0', 'executor >  local (1)']);
    expect(logs.links[0]).toMatchObject({
      label: expect.any(String),
      url: expect.stringMatching(/^https?:\/\//),
    });
    const cancelled = await t.call(contributor, {
      method: 'POST',
      url: `/v1/runs/${created.id}/cancel`,
      headers: { 'x-change-reason': 'wrong params' },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(fake.cancelled).toContain(created.external_id);
    await t.pipelines.poll();
    expect((await run(created.id)).status).toBe('cancelled');
  });

  it('PIPE-04: outputs of a succeeded run become published releases with lineage edges', async () => {
    const version = await publishedVersion('PIPE-04 outputs');
    await publish(version);
    const created = (await launch(contributor, version)).json() as Json;
    const prefix = new URL(created.output_uri).pathname.slice(1);
    const bucket = new URL(created.output_uri).host;
    for (const name of Object.values(OUTPUTS)) {
      await t.s3.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${name}`,
          Body: readFileSync(`${FIXTURES}/${name}`),
        }),
      );
    }
    fake.set(created.external_id, 'succeeded');
    await t.pipelines.poll();
    const done = await run(created.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toHaveLength(2);
    for (const output of done.outputs as Json[]) expect(output.release_status).toBe('published');

    const releases = await t.db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .select(['d.kind', 'r.status'])
      .where('d.experiment_version_id', '=', version)
      .execute();
    expect(releases.map((r) => r.kind).sort()).toEqual(['differential_abundance', 'protein_quant']);
    const edges = await t.db
      .selectFrom('lineage_edge as e')
      .innerJoin('lineage_node as f', 'f.id', 'e.from_node_id')
      .innerJoin('lineage_node as to', 'to.id', 'e.to_node_id')
      .select(['f.kind as from_kind', 'to.kind as to_kind', 'e.relation'])
      .execute();
    const has = (from: string, relation: string, to: string) =>
      edges.some((e) => e.from_kind === from && e.relation === relation && e.to_kind === to);
    expect(has('experiment_version', 'input_to', 'pipeline_run')).toBe(true);
    expect(has('pipeline_run', 'produced', 'file')).toBe(true);
    expect(has('file', 'input_to', 'dataset_release')).toBe(true);

    // Processing outputs twice (a duplicate succeeded event) creates nothing new.
    await t.pipelines.event(
      {
        source: 'aws.batch',
        'detail-type': 'Batch Job State Change',
        time: '2099-01-01T00:00:00Z',
        detail: { jobId: created.external_id, status: 'SUCCEEDED' },
      },
      'fake',
    );
    expect((await run(created.id)).outputs).toHaveLength(2);
  });

  it('PIPE-04: local runner — the demo Nextflow pipeline in Docker succeeds and its outputs are published', async () => {
    const version = await publishedVersion('PIPE-04 local');
    await publish(version);
    const res = await launch(contributor, version, 'local');
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json() as Json;
    let current = created;
    for (let i = 0; i < 120 && !['succeeded', 'failed', 'cancelled'].includes(current.status); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await t.pipelines.poll();
      current = await run(created.id);
    }
    expect(current.status, JSON.stringify(current.events)).toBe('succeeded');
    expect(current.outputs.map((o: Json) => o.release_status)).toEqual(['published', 'published']);
    const logs = (
      await t.call(contributor, { method: 'GET', url: `/v1/runs/${created.id}/logs` })
    ).json() as Json;
    expect(logs.lines.join('\n')).toMatch(/N E X T F L O W/);
  }, 240_000);
});
