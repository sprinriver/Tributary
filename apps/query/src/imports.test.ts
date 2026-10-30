import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { startTestS3, TEST_S3_CREDENTIALS, type TestS3 } from '@tributary/db/testing';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { loadQueryConfig } from './config.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-01');
const EV = '0190a000-0000-7000-8000-0000000000e1';
const PROGRAM = '0190a000-0000-7000-8000-0000000000a1';
const BUCKET = 'query-test';

function runs() {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => {
    const c = l.split('\t');
    return {
      sample_key: c[cols.indexOf('sample_key')]!,
      instrument_run: c[cols.indexOf('instrument_run')]!,
      raw_file: c[cols.indexOf('raw_file')]!,
    };
  });
}

describe('DS-01: importer executor (apps/query)', () => {
  let s3: TestS3;
  let client: S3Client;
  let app: FastifyInstance;
  const config = () =>
    loadQueryConfig({
      NODE_ENV: 'test',
      S3_ENDPOINT: s3.endpoint,
      S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
      S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
      QUERY_INTERNAL_TOKEN: 'test-token',
    });

  beforeAll(async () => {
    s3 = await startTestS3();
    client = new S3Client({
      endpoint: s3.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: TEST_S3_CREDENTIALS,
    });
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    for (const name of ['report.pg_matrix.tsv']) {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `in/${name}`,
          Body: readFileSync(`${FIXTURES}/${name}`),
        }),
      );
    }
    const broken = readFileSync(`${FIXTURES}/report.pg_matrix.tsv`, 'utf8').replace(
      '\t4026427.8\t',
      '\t-1\t',
    );
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'in/broken.pg_matrix.tsv', Body: broken }));
    app = await buildApp({ config: config() });
  }, 240_000);
  afterAll(async () => {
    await app?.close();
    await s3?.stop();
  });

  const post = (url: string, payload: unknown, token = 'test-token') =>
    app.inject({ method: 'POST', url, payload: payload as object, headers: { 'x-internal-token': token } });

  const request = (key: string, out: string) => ({
    importer: 'diann_pg_matrix',
    source: { bucket: BUCKET, key, name: key.split('/').at(-1) },
    context: { experiment_version_id: EV, program_id: PROGRAM, runs: runs() },
    output: { bucket: BUCKET, key: out },
  });

  it('DS-01: rejects calls without the internal token', async () => {
    const res = await post('/internal/imports', request('in/report.pg_matrix.tsv', 'x'), 'wrong');
    expect(res.statusCode).toBe(401);
  });

  it('DS-01: an import writes a staged Parquet release that DuckDB reads back', async () => {
    const res = await post(
      '/internal/imports',
      request('in/report.pg_matrix.tsv', 'releases/protein_quant/r1.parquet'),
    );
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json() as Json;
    expect(result.passed).toBe(true);
    expect(result.kind).toBe('protein_quant');
    expect(result.output).toMatchObject({
      bucket: BUCKET,
      key: 'releases/protein_quant/r1.parquet',
      format: 'parquet',
    });
    expect(result.output.sha256).toMatch(/^[0-9a-f]{64}$/);
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'releases/protein_quant/r1.parquet' }));

    const read = await post('/internal/releases/read', {
      storage: result.output,
      limit: 5,
      order_by: ['sample_key', 'protein_group'],
    });
    expect(read.statusCode, read.body).toBe(200);
    const body = read.json() as Json;
    expect(body.row_count).toBe(result.row_count);
    expect(body.rows).toHaveLength(5);
    expect(body.rows[0]).toMatchObject({ experiment_version_id: EV, sample_key: 'ONC-DIA-01-S01' });
  });

  it('DS-01: a failing quality rule rejects the import, names the rule, and writes nothing', async () => {
    const res = await post(
      '/internal/imports',
      request('in/broken.pg_matrix.tsv', 'releases/protein_quant/r2.parquet'),
    );
    expect(res.statusCode, res.body).toBe(200);
    const result = res.json() as Json;
    expect(result.passed).toBe(false);
    expect(result.output).toBeNull();
    expect(result.failures.map((f: Json) => f.rule_id)).toContain('intensity_non_negative');
    await expect(
      client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'releases/protein_quant/r2.parquet' })),
    ).rejects.toThrow();
  });
});
