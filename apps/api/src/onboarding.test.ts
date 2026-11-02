import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { THERMO_MAGIC } from './ingest/sniff.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 23 (ING-06): bulk onboarding of a legacy folder layout. The synthetic layout mimics a shared drive:
//   incoming/legacy/<experiment>/raw/<run>.raw            (Thermo RAW, one per sample)
//   incoming/legacy/<experiment>/processed/report.pg_matrix.tsv   (DIA-NN output, imported in batch)
//   incoming/legacy/<experiment>/notes/*                  (not matched by any pattern: reported, never guessed)
const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-01');
const MATRIX = readFileSync(`${FIXTURES}/report.pg_matrix.tsv`);
const RUNS = Array.from({ length: 12 }, (_, i) => `ONC-DIA-01_run${String(i + 1).padStart(2, '0')}`);
const PREFIX = 'incoming/legacy/';

const raw = () => Buffer.concat([Buffer.from(THERMO_MAGIC), randomBytes(64)]);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const PATTERNS = [
  { path: '{experiment}/raw/{sample}.raw', role: 'raw' },
  { path: '{experiment}/processed/report.pg_matrix.tsv', role: 'processed', importer: 'diann_pg_matrix' },
];

describe('legacy onboarding (ING-06)', () => {
  let t: TestApi;
  let program: string;
  let contributor: string;
  let viewer: string;
  const objects = new Map<string, Buffer>();

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('LEG');
    contributor = (await t.user('leg-contributor', { [program]: 'contributor' })).token;
    viewer = (await t.user('leg-viewer', { [program]: 'viewer' })).token;
    for (const run of RUNS) objects.set(`${PREFIX}LEG-A/raw/${run}.raw`, raw());
    objects.set(`${PREFIX}LEG-A/processed/report.pg_matrix.tsv`, MATRIX);
    objects.set(`${PREFIX}LEG-A/notes/readme.txt`, Buffer.from('lab notes\n'));
    for (const run of ['B_run01', 'B_run02']) objects.set(`${PREFIX}LEG-B/raw/${run}.raw`, raw());
    // A broken export: the importer must fail on it, and the report must say so.
    objects.set(
      `${PREFIX}LEG-B/processed/report.pg_matrix.tsv`,
      Buffer.from('not\ta\tDIA-NN\tmatrix\n1\t2\t3\t4\n'),
    );
    for (const [key, body] of objects) {
      await t.s3.client.send(new PutObjectCommand({ Bucket: t.s3.bucket, Key: key, Body: body }));
    }
  }, 300_000);
  afterAll(() => t.close());

  const spec = (extra: Json = {}) => ({
    program_id: program,
    prefix: PREFIX,
    assay_type: 'proteomics_dia',
    patterns: PATTERNS,
    sample_defaults: { organism: 'Homo sapiens' },
    ...extra,
  });
  const reason = { 'x-change-reason': 'onboard legacy shared drive' };
  const experimentsNamed = (name: string) =>
    t.db
      .selectFrom('experiment')
      .select('id')
      .where('program_id', '=', program)
      .where('name', '=', name)
      .where('deleted_at', 'is', null)
      .execute();

  it('ING-06: the plan infers experiments, sample manifests and file roles from the names, and writes nothing', async () => {
    const res = await t.call(contributor, { method: 'POST', url: '/v1/onboarding/plan', payload: spec() });
    expect(res.statusCode, res.body).toBe(200);
    const plan = res.json() as Json;
    expect(plan.object_count).toBe(objects.size);
    expect(plan.experiments.map((e: Json) => e.name)).toEqual(['LEG-A', 'LEG-B']);
    const a = plan.experiments[0];
    expect(a.samples).toHaveLength(12);
    // Sample keys, raw file names and runs come from the file names; defaults fill the rest, nothing else is guessed.
    expect(a.samples[0]).toEqual({
      sample_key: 'ONC-DIA-01_run01',
      raw_file: 'ONC-DIA-01_run01.raw',
      instrument_run: 'ONC-DIA-01_run01',
      organism: 'Homo sapiens',
    });
    expect(a.files).toHaveLength(13);
    expect(a.files.find((f: Json) => f.key.endsWith('.tsv'))).toMatchObject({
      role: 'processed',
      importer: 'diann_pg_matrix',
      sample_key: null,
    });
    expect(plan.unmatched).toEqual([`${PREFIX}LEG-A/notes/readme.txt`]);
    expect(await experimentsNamed('LEG-A')).toHaveLength(0);
  });

  it('ING-06: a viewer cannot onboard, and only linkable prefixes are accepted', async () => {
    expect(
      (await t.call(viewer, { method: 'POST', url: '/v1/onboarding/runs', payload: spec() })).statusCode,
    ).toBe(403);
    const outside = await t.call(contributor, {
      method: 'POST',
      url: '/v1/onboarding/plan',
      payload: spec({ prefix: 'programs/' }),
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json()).toMatchObject({ code: 'prefix_not_linkable', field: 'prefix' });
    const noExperiment = await t.call(contributor, {
      method: 'POST',
      url: '/v1/onboarding/plan',
      payload: spec({ patterns: [{ path: 'raw/{sample}.raw', role: 'raw' }] }),
    });
    expect(noExperiment.statusCode).toBe(400);
  });

  let runId: string;

  it('ING-06: a run registers experiments, manifests and files in batches, waits for QC, and resumes', async () => {
    // One experiment per batch: the run stops after LEG-A and says it is incomplete.
    const first = await t.call(contributor, {
      method: 'POST',
      url: '/v1/onboarding/runs',
      payload: spec({ max_experiments: 1 }),
      headers: reason,
    });
    expect(first.statusCode, first.body).toBe(201);
    const run = first.json() as Json;
    runId = run.id;
    expect(run.status).toBe('incomplete');
    expect(run.counts.experiments).toEqual({ done: 1, pending: 1, failed: 0 });
    // Imports wait until their file has passed QC (checksums are computed asynchronously).
    expect(run.counts.imports.pending).toBe(2);

    const [a] = await experimentsNamed('LEG-A');
    expect(a).toBeDefined();
    const detail = (
      await t.call(contributor, { method: 'GET', url: `/v1/experiments/${a!.id}` })
    ).json() as Json;
    const version = detail.versions[0].id as string;
    const samples = (
      await t.call(contributor, { method: 'GET', url: `/v1/versions/${version}/samples` })
    ).json() as Json;
    expect(samples.items).toHaveLength(12);
    const files = (
      await t.call(contributor, { method: 'GET', url: `/v1/versions/${version}/files` })
    ).json() as Json;
    expect(files.items).toHaveLength(13);
    expect(files.items.filter((f: Json) => f.role === 'raw')).toHaveLength(12);

    // Checksums run, then the run resumes: LEG-B is registered and the imports run.
    await t.drainIngest();
    const resumed = await t.call(contributor, {
      method: 'POST',
      url: `/v1/onboarding/runs/${runId}/resume`,
      headers: reason,
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    await t.drainIngest();
    const again = (
      await t.call(contributor, {
        method: 'POST',
        url: `/v1/onboarding/runs/${runId}/resume`,
        headers: reason,
      })
    ).json() as Json;
    expect(again.counts.experiments).toEqual({ done: 2, pending: 0, failed: 0 });
    expect(again.counts.files).toEqual({ done: 16, pending: 0, failed: 0 });
    expect(again.counts.imports).toEqual({ done: 1, pending: 0, failed: 1 });
    expect(again.status).toBe('completed_with_failures');

    const imported = again.items.find((i: Json) => i.kind === 'import' && i.key.includes('LEG-A/'));
    expect(imported).toMatchObject({ status: 'done', error: null });
    const release = await t.call(contributor, { method: 'GET', url: `/v1/releases/${imported.entity_id}` });
    expect(release.statusCode).toBe(200);
    expect((release.json() as Json).status).toBe('staged');

    const broken = again.items.find((i: Json) => i.kind === 'import' && i.key.includes('LEG-B/'));
    expect(broken.status).toBe('failed');
    expect(broken.error).toBeTruthy();
    expect(broken.attempts).toBe(1);

    // A further resume retries the failed import; it fails again and the attempt is counted.
    const retried = (
      await t.call(contributor, {
        method: 'POST',
        url: `/v1/onboarding/runs/${runId}/resume`,
        headers: reason,
      })
    ).json() as Json;
    const brokenAgain = retried.items.find((i: Json) => i.kind === 'import' && i.key.includes('LEG-B/'));
    expect(brokenAgain).toMatchObject({ status: 'failed' });
    expect(brokenAgain.attempts).toBe(2);
    expect(retried.counts.imports).toEqual({ done: 1, pending: 0, failed: 1 });
  });

  it('ING-06: the migration report has counts, failures and every checksum', async () => {
    const res = await t.call(contributor, { method: 'GET', url: `/v1/onboarding/runs/${runId}` });
    expect(res.statusCode).toBe(200);
    const report = res.json() as Json;
    expect(report.failures).toHaveLength(1);
    expect(report.unmatched).toEqual([`${PREFIX}LEG-A/notes/readme.txt`]);
    const files = (report.items as Json[]).filter((i) => i.kind === 'file');
    expect(files).toHaveLength(16);
    for (const f of files) {
      expect(f.sha256, f.key).toBe(sha(objects.get(f.key)!));
      expect(f.size_bytes).toBe(objects.get(f.key)!.length);
      expect(f.ingest_status).toBe('qc_passed');
    }
    expect(report.totals).toMatchObject({
      bytes: [...objects.entries()]
        .filter(([k]) => !k.includes('/notes/'))
        .reduce((n, [, b]) => n + b.length, 0),
    });
  });

  it('ING-06: running the same layout again creates nothing new', async () => {
    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/onboarding/runs',
      payload: spec(),
      headers: reason,
    });
    expect(res.statusCode, res.body).toBe(201);
    const run = res.json() as Json;
    expect(run.counts.experiments.done).toBe(2);
    expect(await experimentsNamed('LEG-A')).toHaveLength(1);
    const fileCount = await t.db
      .selectFrom('file_object')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('key', 'like', `${PREFIX}%`)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(Number(fileCount.n)).toBe(16);
  });

  it('ING-06: onboarding writes audit rows for the run and for everything it created', async () => {
    const actions = (
      await t.db
        .selectFrom('audit_log')
        .select('action')
        .where('reason', '=', reason['x-change-reason'])
        .execute()
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['onboarding.run', 'onboarding.resume', 'experiment.create']),
    );
  });
});
