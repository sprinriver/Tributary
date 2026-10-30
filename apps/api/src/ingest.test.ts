import { GetObjectTaggingCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canLaunch } from './ingest/gate.ts';
import { serviceActor, transitionFile } from './ingest/state.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MiB = 1024 * 1024;
const FASTQ = '@read1\nACGTACGT\n+\nIIIIIIII\n'.repeat(2000);

describe('files and ingest API', () => {
  let t: TestApi;
  let program: string;
  let contributor: string;
  let approver: string;
  let viewer: string;
  let admin: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true });
    program = await t.program('ING');
    contributor = (await t.user('ing-contributor', { [program]: 'contributor' })).token;
    approver = (await t.user('ing-approver', { [program]: 'approver' })).token;
    viewer = (await t.user('ing-viewer', { [program]: 'viewer' })).token;
    const adminUser = await t.user('ing-admin', {});
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
  }, 300_000);
  afterAll(() => t.close());

  async function draft(name: string): Promise<string> {
    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/experiments',
      payload: { program_id: program, assay_type: 'proteomics_dia', name },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as Json).versions[0].id as string;
  }

  async function initiate(token: string, body: Json) {
    return t.call(token, { method: 'POST', url: '/v1/files/uploads', payload: body });
  }

  /** Uploads through the presigned URLs exactly as a browser would. */
  async function putPart(url: string, bytes: Uint8Array): Promise<string> {
    const res = await fetch(url, { method: 'PUT', body: bytes });
    expect(res.status, await res.clone().text()).toBe(200);
    return res.headers.get('etag')!;
  }

  async function uploadWhole(version: string, name: string, bytes: Uint8Array, extra: Json = {}) {
    const res = await initiate(contributor, {
      experiment_version_id: version,
      name,
      size_bytes: bytes.length,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    const started = res.json() as Json;
    const parts = [];
    for (const part of started.parts as Json[]) {
      const start = (part.part_number - 1) * started.part_size;
      parts.push({
        part_number: part.part_number,
        etag: await putPart(part.url, bytes.subarray(start, start + started.part_size)),
      });
    }
    const done = await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/complete`,
      payload: { parts },
    });
    expect(done.statusCode, done.body).toBe(200);
    return done.json() as Json;
  }

  async function file(id: string): Promise<Json> {
    const res = await t.call(viewer, { method: 'GET', url: `/v1/files/${id}` });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Json;
  }

  async function transitions(fileId: string): Promise<string[]> {
    const rows = await t.db
      .selectFrom('audit_log')
      .select(['after', 'before'])
      .where('entity_id', '=', fileId)
      .where('action', '=', 'file.transition')
      .orderBy('at')
      .orderBy('id')
      .execute();
    return rows.map((r) => `${(r.before as Json).ingest_status}→${(r.after as Json).ingest_status}`);
  }

  it('ING-01: 200 MB presigned multipart upload, one part retried, resumable via ListParts', async () => {
    const version = await draft('ING-01 large upload');
    const bytes = new Uint8Array(randomBytes(200 * MiB));
    const res = await initiate(contributor, {
      experiment_version_id: version,
      name: 'large.bin',
      size_bytes: bytes.length,
      role: 'raw',
    });
    expect(res.statusCode, res.body).toBe(201);
    const started = res.json() as Json;
    expect(started.file.ingest_status).toBe('uploading');
    expect(started.part_count).toBe(Math.ceil(bytes.length / started.part_size));
    expect(started.parts).toHaveLength(started.part_count);
    expect(started.file.key).toMatch(/^programs\/ING\/experiments\/.+\/v1\/raw\/large\.bin$/);

    const slice = (n: number) => bytes.subarray((n - 1) * started.part_size, n * started.part_size);
    const etags = new Map<number, string>();
    // Upload every part except the last; part 3 first goes up corrupted (a failed attempt) and is retried below.
    for (const part of (started.parts as Json[]).slice(0, -1)) {
      const body = part.part_number === 3 ? new Uint8Array(slice(3).length).fill(0) : slice(part.part_number);
      etags.set(part.part_number, await putPart(part.url, body));
    }

    // Resume: the server lists stored parts; re-sign the missing part and the one to retry.
    const listed = await t.call(contributor, { method: 'GET', url: `/v1/files/${started.file.id}/parts` });
    expect(listed.statusCode, listed.body).toBe(200);
    expect((listed.json() as Json).parts).toHaveLength(started.part_count - 1);
    const resigned = await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/parts`,
      payload: { part_numbers: [3, started.part_count] },
    });
    expect(resigned.statusCode, resigned.body).toBe(200);
    for (const part of (resigned.json() as Json).parts as Json[]) {
      etags.set(part.part_number, await putPart(part.url, slice(part.part_number)));
    }

    const done = await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/complete`,
      payload: { parts: [...etags].map(([part_number, etag]) => ({ part_number, etag })) },
      headers: { 'x-change-reason': 'instrument export' },
    });
    expect(done.statusCode, done.body).toBe(200);
    expect((done.json() as Json).ingest_status).toBe('uploaded');

    // Checksum, detection and QC run asynchronously in the ingest job.
    expect(await t.drainIngest()).toBeGreaterThanOrEqual(1);
    const ingested = await file(started.file.id);
    expect(ingested.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(ingested.size_bytes).toBe(bytes.length);
    expect(ingested.ingest_status).toBe('qc_passed');
    expect(ingested.qc_report.format).toBe('binary');
  }, 300_000);

  it('ING-01: completing with a missing part, or as a viewer, or on a published version, fails', async () => {
    const version = await draft('ING-01 errors');
    expect(
      (await initiate(viewer, { experiment_version_id: version, name: 'x.csv', size_bytes: 10 })).statusCode,
    ).toBe(403);
    const bad = await initiate(contributor, {
      experiment_version_id: version,
      name: '../x.csv',
      size_bytes: 10,
    });
    expect(bad.statusCode).toBe(400);
    const started = (
      await initiate(contributor, {
        experiment_version_id: version,
        name: 'two-parts.bin',
        size_bytes: 20 * MiB,
      })
    ).json() as Json;
    const etag = await putPart(started.parts[0].url, new Uint8Array(started.part_size));
    const incomplete = await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/complete`,
      payload: { parts: [{ part_number: 1, etag }] },
    });
    expect(incomplete.statusCode).toBe(422);
    const aborted = await t.call(contributor, { method: 'POST', url: `/v1/files/${started.file.id}/abort` });
    expect(aborted.statusCode, aborted.body).toBe(200);
    expect((aborted.json() as Json).ingest_status).toBe('rejected');
    expect(await transitions(started.file.id)).toEqual(['registered→uploading', 'uploading→rejected']);
  });

  it('ING-02: link existing objects by prefix; checksums are computed asynchronously', async () => {
    const version = await draft('ING-02 link');
    const objects = { 'incoming/batch7/a.csv': 'x,y\n1,2\n', 'incoming/batch7/b.tsv': 'x\ty\n1\t2\n' };
    for (const [key, body] of Object.entries(objects)) {
      await t.s3.client.send(new PutObjectCommand({ Bucket: t.s3.bucket, Key: key, Body: body }));
    }
    await t.s3.client.send(
      new PutObjectCommand({ Bucket: t.s3.bucket, Key: 'incoming/other/c.csv', Body: 'z\n' }),
    );

    const outside = await t.call(contributor, {
      method: 'POST',
      url: '/v1/files/link',
      payload: { experiment_version_id: version, prefix: 'programs/' },
    });
    expect(outside.statusCode).toBe(422);

    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/files/link',
      payload: { experiment_version_id: version, prefix: 'incoming/batch7/', role: 'processed' },
      headers: { 'x-change-reason': 'migrate legacy batch' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const linked = res.json() as Json;
    expect(linked.items.map((f: Json) => f.name).sort()).toEqual(['a.csv', 'b.tsv']);
    for (const f of linked.items as Json[]) {
      expect(f.ingest_status).toBe('uploaded');
      expect(f.sha256).toBeNull();
    }

    // Linking the same prefix again registers nothing new.
    const again = await t.call(contributor, {
      method: 'POST',
      url: '/v1/files/link',
      payload: { experiment_version_id: version, prefix: 'incoming/batch7/' },
    });
    expect((again.json() as Json).skipped).toBe(2);

    await t.drainIngest();
    for (const f of linked.items as Json[]) {
      const done = await file(f.id);
      const body = objects[f.key as keyof typeof objects];
      expect(done.sha256).toBe(createHash('sha256').update(body).digest('hex'));
      expect(done.ingest_status).toBe('qc_passed');
    }
  });

  it('ING-04: legal transitions are audited, illegal ones rejected, the QC report stored', async () => {
    const version = await draft('ING-04 state machine');
    const uploaded = await uploadWhole(version, 'reads.fastq.gz', gzipSync(FASTQ), {
      declared_format: 'fastq',
    });
    await t.drainIngest();
    const done = await file(uploaded.id);
    expect(done.ingest_status).toBe('qc_passed');
    expect(done.qc_report).toMatchObject({ format: 'fastq', compression: 'gzip', passed: true });
    expect(await transitions(uploaded.id)).toEqual([
      'registered→uploading',
      'uploading→uploaded',
      'uploaded→type_detected',
      'type_detected→contract_validated',
      'contract_validated→qc_passed',
    ]);
    const actors = await t.db
      .selectFrom('audit_log')
      .innerJoin('app_user', 'app_user.id', 'audit_log.actor_id')
      .select(['audit_log.actor_type', 'app_user.kind'])
      .where('entity_id', '=', uploaded.id)
      .where('action', '=', 'file.transition')
      .execute();
    expect(new Set(actors.map((a) => a.actor_type))).toEqual(new Set(['user', 'service']));

    // Completing twice is an illegal transition (uploaded → uploaded).
    const twice = await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${uploaded.id}/complete`,
      payload: { parts: [{ part_number: 1, etag: 'x' }] },
    });
    expect(twice.statusCode).toBe(409);
    const actor = await serviceActor(t.db, await tenant(), 'test');
    await expect(transitionFile(t.db, actor, uploaded.id, 'uploading')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await transitions(uploaded.id)).toHaveLength(5);
  });

  async function tenant(): Promise<string> {
    return (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id;
  }

  it('ING-04: a declared format that contradicts the content fails QC with a reason', async () => {
    const version = await draft('ING-04 declared');
    const uploaded = await uploadWhole(version, 'calls.vcf', new TextEncoder().encode('a,b\n1,2\n'), {
      declared_format: 'vcf',
    });
    await t.drainIngest();
    const done = await file(uploaded.id);
    expect(done.ingest_status).toBe('qc_failed');
    expect(done.qc_reason).toMatch(/declared vcf.*csv/i);
    expect(await transitions(uploaded.id)).toContain('type_detected→qc_failed');
  });

  it('ING-04: the QC gate blocks on qc_failed; an approver override with a reason unblocks', async () => {
    const version = await draft('ING-04 gate');
    await uploadWhole(version, 'good.fastq.gz', gzipSync(FASTQ));
    const corrupted = new Uint8Array(gzipSync(FASTQ.repeat(20)));
    for (let i = 500; i < 600; i++) corrupted[i] = corrupted[i]! ^ 0xff;
    const bad = await uploadWhole(version, 'bad.fastq.gz', corrupted);

    // Still ingesting: blocked, with the pending file as the reason.
    let gate = await canLaunch(t.db, version);
    expect(gate.can_launch).toBe(false);
    expect(gate.blockers.map((b) => b.status)).toContain('uploaded');

    await t.drainIngest();
    expect((await file(bad.id)).ingest_status).toBe('qc_failed');
    gate = await canLaunch(t.db, version);
    expect(gate.can_launch).toBe(false);
    expect(gate.blockers).toEqual([
      expect.objectContaining({
        file_id: bad.id,
        status: 'qc_failed',
        reason: expect.stringMatching(/gzip/i),
      }),
    ]);
    const viaApi = await t.call(viewer, { method: 'GET', url: `/v1/versions/${version}/qc-gate` });
    expect((viaApi.json() as Json).can_launch).toBe(false);

    // Contributors cannot override; approvers must give a reason.
    const denied = await t.call(contributor, {
      method: 'POST',
      url: `/v1/versions/${version}/qc-override`,
      payload: { reason: 'Known benign truncation in vendor export' },
    });
    expect(denied.statusCode).toBe(403);
    const noReason = await t.call(approver, {
      method: 'POST',
      url: `/v1/versions/${version}/qc-override`,
      payload: { reason: 'ok' },
    });
    expect(noReason.statusCode).toBe(400);
    const override = await t.call(approver, {
      method: 'POST',
      url: `/v1/versions/${version}/qc-override`,
      payload: { reason: 'Known benign truncation in vendor export' },
    });
    expect(override.statusCode, override.body).toBe(201);
    expect((override.json() as Json).file_ids).toEqual([bad.id]);

    gate = await canLaunch(t.db, version);
    expect(gate.can_launch).toBe(true);
    expect(gate.overridden).toEqual([bad.id]);
    expect(gate.override?.reason).toBe('Known benign truncation in vendor export');
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['reason', 'entity_type'])
      .where('action', '=', 'qc.override')
      .where('entity_id', '=', version)
      .executeTakeFirstOrThrow();
    expect(audit.reason).toBe('Known benign truncation in vendor export');

    // A file that fails after the override blocks again.
    await uploadWhole(version, 'bad2.fastq.gz', corrupted);
    await t.drainIngest();
    expect((await canLaunch(t.db, version)).can_launch).toBe(false);
  });

  it('ING-05: files get lifecycle tags by role; admins edit the policies (audited)', async () => {
    const forbidden = await t.call(contributor, { method: 'GET', url: '/v1/admin/lifecycle-policies' });
    expect(forbidden.statusCode).toBe(403);
    const defaults = (
      await t.call(admin, { method: 'GET', url: '/v1/admin/lifecycle-policies' })
    ).json() as Json;
    const raw = defaults.items.find((p: Json) => p.role === 'raw');
    expect(raw).toMatchObject({ tag: 'raw', storage_class: 'STANDARD_IA' });
    expect(defaults.s3_rules.length).toBeGreaterThan(0);

    const invalid = await t.call(admin, {
      method: 'PUT',
      url: '/v1/admin/lifecycle-policies',
      payload: {
        items: [{ role: 'raw', tag: 'raw', transition_days: 30, storage_class: null, expiration_days: null }],
      },
    });
    expect(invalid.statusCode).toBe(400);

    const put = await t.call(admin, {
      method: 'PUT',
      url: '/v1/admin/lifecycle-policies',
      headers: { 'x-change-reason': 'archive raw data sooner' },
      payload: {
        items: [
          {
            role: 'raw',
            tag: 'raw-archive',
            transition_days: 14,
            storage_class: 'GLACIER_IR',
            expiration_days: null,
          },
          { role: 'work', tag: 'work', transition_days: null, storage_class: null, expiration_days: 21 },
        ],
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect((put.json() as Json).s3_rules).toContainEqual({
      ID: 'tributary-raw',
      Status: 'Enabled',
      Filter: { Tag: { Key: 'tributary-lifecycle', Value: 'raw-archive' } },
      Transitions: [{ Days: 14, StorageClass: 'GLACIER_IR' }],
    });
    const audited = await t.db
      .selectFrom('audit_log')
      .select('reason')
      .where('action', '=', 'lifecycle_policy.update')
      .executeTakeFirstOrThrow();
    expect(audited.reason).toBe('archive raw data sooner');

    const version = await draft('ING-05 tags');
    const uploaded = await uploadWhole(version, 'table.csv', new TextEncoder().encode('a,b\n1,2\n'));
    await t.drainIngest();
    expect((await file(uploaded.id)).lifecycle_tag).toBe('raw-archive');
    const tags = await t.s3.client.send(
      new GetObjectTaggingCommand({ Bucket: t.s3.bucket, Key: uploaded.key as string }),
    );
    expect(tags.TagSet).toEqual(
      expect.arrayContaining([
        { Key: 'tributary-lifecycle', Value: 'raw-archive' },
        { Key: 'tributary-role', Value: 'raw' },
      ]),
    );
  });
});
