import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_ROLE, createDb, IMMUTABLE_SQLSTATE, migrateToLatest } from './index.ts';
import { startTestDatabase, type TestDatabase } from './testing/postgres.ts';

const TENANT = '019a2b3c-4d5e-7f00-8a00-000000000900';
const ACTOR = '019a2b3c-4d5e-7f00-8a00-000000000901';
const audit = `'${TENANT}', '${ACTOR}'`;

describe('immutability and append-only audit', () => {
  let testDb: TestDatabase;
  const q = (text: string, values: unknown[] = []) => testDb.pool.query(text, values);
  const one = async (text: string, values: unknown[] = []) =>
    (await q(text, values)).rows[0] as Record<string, string>;

  /** Runs statements as the application role, the way apps/api connects. */
  async function asApp<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await testDb.pool.connect();
    try {
      await client.query(`set role ${APP_ROLE}`);
      return await fn(client);
    } finally {
      await client.query('reset role');
      client.release();
    }
  }

  let versionId: string;
  let releaseId: string;

  beforeAll(async () => {
    testDb = await startTestDatabase();
    const db = createDb(testDb.url);
    await migrateToLatest(db);
    await db.destroy();
  });
  afterAll(() => testDb.stop());

  beforeEach(async () => {
    const program = await one(
      `insert into program (tenant_id, created_by, name, code, description) values (${audit}, 'P', $1, '') returning id`,
      [`P-${Math.random()}`],
    );
    const experiment = await one(
      `insert into experiment (tenant_id, created_by, program_id, assay_type, name, urn)
       values (${audit}, $1, 'proteomics_dia', 'Dose series', 'urn:pending') returning id`,
      [program.id],
    );
    const version = await one(
      `insert into experiment_version (tenant_id, created_by, experiment_id, version_number, template_version, urn)
       values (${audit}, $1, 1, '1.0.0', 'urn:pending:v1') returning id`,
      [experiment.id],
    );
    versionId = version.id;
    await q(
      `insert into sample (tenant_id, created_by, experiment_version_id, sample_key) values (${audit}, $1, 'S001')`,
      [versionId],
    );
    const dataset = await one(
      `insert into dataset (tenant_id, created_by, kind, experiment_version_id, program_id, name)
       values (${audit}, 'protein_quant', $1, $2, 'pg matrix') returning id`,
      [versionId, program.id],
    );
    const release = await one(
      `insert into dataset_release (tenant_id, created_by, dataset_id, release_number, contract_version, storage,
         row_count, source)
       values (${audit}, $1, 1, '1.0.0', '{"type":"parquet","prefix":"s3://x/"}', 10, '{}') returning id`,
      [dataset.id],
    );
    releaseId = release.id;
  });

  const publish = () =>
    q(
      `update experiment_version set status = 'published', publish_reason = 'first release',
         published_by = $2, published_at = now() where id = $1`,
      [versionId, ACTOR],
    );

  it('DB-02: a draft version and its samples can be edited', async () => {
    await q(`update experiment_version set description = 'edited' where id = $1`, [versionId]);
    await q(`update sample set source_name = 'src' where experiment_version_id = $1`, [versionId]);
    expect(
      (await one('select description from experiment_version where id = $1', [versionId])).description,
    ).toBe('edited');
  });

  it('DB-02: publishing needs a reason', async () => {
    await expect(
      q(`update experiment_version set status = 'published' where id = $1`, [versionId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('DB-02: updating or deleting a published experiment version raises', async () => {
    await publish();
    await expect(
      q(`update experiment_version set description = 'x' where id = $1`, [versionId]),
    ).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
    await expect(
      q(`update experiment_version set deleted_at = now() where id = $1`, [versionId]),
    ).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
    await expect(q(`delete from experiment_version where id = $1`, [versionId])).rejects.toMatchObject({
      code: IMMUTABLE_SQLSTATE,
    });
  });

  it('DB-02: samples of a published version cannot be added, changed or removed', async () => {
    await publish();
    await expect(
      q(
        `insert into sample (tenant_id, created_by, experiment_version_id, sample_key) values (${audit}, $1, 'S002')`,
        [versionId],
      ),
    ).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
    await expect(
      q(`update sample set source_name = 'x' where experiment_version_id = $1`, [versionId]),
    ).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
    await expect(q(`delete from sample where experiment_version_id = $1`, [versionId])).rejects.toMatchObject(
      {
        code: IMMUTABLE_SQLSTATE,
      },
    );
  });

  it('DB-02: a published version may only be archived, and an archived one is frozen', async () => {
    await publish();
    await q(`update experiment_version set status = 'archived' where id = $1`, [versionId]);
    await expect(
      q(`update experiment_version set status = 'published' where id = $1`, [versionId]),
    ).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
  });

  it('DB-02: updating or deleting a published dataset release raises', async () => {
    await q(`update dataset_release set status = 'published', published_at = now() where id = $1`, [
      releaseId,
    ]);
    await expect(
      q(`update dataset_release set row_count = 11 where id = $1`, [releaseId]),
    ).rejects.toMatchObject({
      code: IMMUTABLE_SQLSTATE,
    });
    await expect(q(`delete from dataset_release where id = $1`, [releaseId])).rejects.toMatchObject({
      code: IMMUTABLE_SQLSTATE,
    });
  });

  it('DB-02: a staged release can still change', async () => {
    await q(`update dataset_release set row_count = 12 where id = $1`, [releaseId]);
    expect((await one('select row_count from dataset_release where id = $1', [releaseId])).row_count).toBe(
      12,
    );
  });

  it('DB-02: the app role can insert and read audit_log but not update or delete it', async () => {
    await asApp(async (client) => {
      await client.query(
        `insert into audit_log (actor_id, actor_type, action, entity_type, entity_id, request_id)
         values ($1, 'user', 'experiment_version.update', 'experiment_version', $2, 'req-1')`,
        [ACTOR, versionId],
      );
      const { rowCount } = await client.query('select 1 from audit_log where entity_id = $1', [versionId]);
      expect(rowCount).toBe(1);
      await expect(client.query(`update audit_log set reason = 'x'`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(client.query(`delete from audit_log`)).rejects.toMatchObject({ code: '42501' });
      await expect(client.query(`truncate audit_log`)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('DB-02: audit_log rejects UPDATE and DELETE even for the owner', async () => {
    await q(
      `insert into audit_log (actor_id, actor_type, action, entity_type, entity_id, request_id)
       values ($1, 'service', 'test', 'test', $1, 'req-2')`,
      [ACTOR],
    );
    await expect(q(`update audit_log set reason = 'x'`)).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
    await expect(q(`delete from audit_log`)).rejects.toMatchObject({ code: IMMUTABLE_SQLSTATE });
  });

  it('DB-02: the app role soft-deletes only (no DELETE grant on entity tables)', async () => {
    await asApp(async (client) => {
      await client.query(`update experiment_version set deleted_at = now() where id = $1`, [versionId]);
      await expect(
        client.query(`delete from sample where experiment_version_id = $1`, [versionId]),
      ).rejects.toMatchObject({
        code: '42501',
      });
    });
  });
});
