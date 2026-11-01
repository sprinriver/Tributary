import {
  CompleteUploadBodySchema,
  FileListSchema,
  FileSummarySchema,
  InitiateUploadBodySchema,
  InitiateUploadResponseSchema,
  LinkPrefixBodySchema,
  LinkPrefixResultSchema,
  SignedPartsSchema,
  SignPartsBodySchema,
  UploadedPartsSchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requestActor } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import { HttpError, parse } from '../errors.ts';
import { FILE_COLUMNS, fileSummary, loadFile, versionFiles, type LoadedFile } from '../ingest/files.ts';
import type { IngestQueue } from '../ingest/queue.ts';
import { transitionFile } from '../ingest/state.ts';
import { loadVersion, type LoadedVersion } from '../registry/load.ts';
import { respond } from '../respond.ts';
import type { Storage } from '../storage.ts';
import { requireDraft } from './versions.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

/** ARCHITECTURE §5: `programs/<program>/experiments/<exp>/v<n>/<role>/<file>` in the raw bucket. */
async function objectKey(db: Database, version: LoadedVersion, role: string, name: string): Promise<string> {
  const program = await db
    .selectFrom('program')
    .select('code')
    .where('id', '=', version.program_id)
    .executeTakeFirstOrThrow();
  return `programs/${program.code}/experiments/${version.experiment_id}/v${version.version_number}/${role}/${name}`;
}

const expiresAt = (storage: Storage) =>
  new Date(Date.now() + storage.config.presignTtlSeconds * 1000).toISOString();

function uploading(file: LoadedFile): string {
  if (file.ingest_status !== 'uploading' || !file.upload_id) {
    throw new HttpError(
      409,
      'not_uploading',
      `The file is ${file.ingest_status}, not uploading.`,
      'ingest_status',
    );
  }
  return file.upload_id;
}

const partCount = (size: number, partSize: number) => Math.max(1, Math.ceil(size / partSize));

export function registerFileRoutes(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
  queue: IngestQueue,
): void {
  const reload = async (id: string) => fileSummary(await loadFile(db, id));

  app.post('/v1/files/uploads', async (request, reply) => {
    const body = parse(InitiateUploadBodySchema, request.body);
    const version = await loadVersion(db, body.experiment_version_id);
    authorize(request, 'create', 'File', version.program_id);
    requireDraft(version);
    const key = await objectKey(db, version, body.role, body.name);
    const actor = requestActor(request);

    // A failed or abandoned file with the same name is replaced (it moves to `rejected`); a live one conflicts.
    const existing = await db
      .selectFrom('file_object as f')
      .select(['f.id', 'f.ingest_status'])
      .where('f.bucket', '=', storage.bucket)
      .where('f.key', '=', key)
      .where('f.deleted_at', 'is', null)
      .where('f.ingest_status', '!=', 'rejected')
      .execute();
    for (const old of existing) {
      if (old.ingest_status !== 'qc_failed') {
        throw new HttpError(409, 'duplicate_file', `${body.name} is already on this version.`, 'name');
      }
    }

    const uploadId = await storage.createUpload(key);
    const fileId = await db.transaction().execute(async (trx) => {
      for (const old of existing) {
        await transitionFile(trx, actor, old.id, 'rejected', {
          reason: `Replaced by a new upload of ${body.name}`,
        });
      }
      const row = await trx
        .insertInto('file_object')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          experiment_version_id: version.id,
          name: body.name,
          role: body.role,
          bucket: storage.bucket,
          key,
          size_bytes: body.size_bytes,
          declared_format: body.declared_format ?? null,
          ingest_status: 'registered',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transitionFile(trx, actor, row.id, 'uploading', {
        set: { upload_id: uploadId },
        details: { name: body.name, size_bytes: body.size_bytes, role: body.role },
      });
      return row.id;
    });

    const partSize = storage.config.partSizeBytes;
    const count = partCount(body.size_bytes, partSize);
    if (count > 10_000) {
      await storage.abortUpload(key, uploadId);
      throw new HttpError(422, 'too_many_parts', 'The file needs more than 10,000 parts.', 'size_bytes');
    }
    const parts = [];
    for (let n = 1; n <= count; n++)
      parts.push({ part_number: n, url: await storage.presignPart(key, uploadId, n) });
    reply.code(201);
    return respond(InitiateUploadResponseSchema, {
      file: await reload(fileId),
      upload_id: uploadId,
      part_size: partSize,
      part_count: count,
      parts,
      expires_at: expiresAt(storage),
    });
  });

  app.get('/v1/files/:id', async (request: IdParams) => {
    const file = await loadFile(db, request.params.id);
    authorize(request, 'read', 'File', file.program_id);
    return respond(FileSummarySchema, fileSummary(file));
  });

  app.get('/v1/files/:id/parts', async (request: IdParams) => {
    const file = await loadFile(db, request.params.id);
    authorize(request, 'update', 'File', file.program_id);
    const uploadId = uploading(file);
    const partSize = storage.config.partSizeBytes;
    return respond(UploadedPartsSchema, {
      upload_id: uploadId,
      part_size: partSize,
      part_count: partCount(Number(file.size_bytes), partSize),
      parts: await storage.listParts(file.key, uploadId),
    });
  });

  app.post('/v1/files/:id/parts', async (request: IdParams) => {
    const body = parse(SignPartsBodySchema, request.body);
    const file = await loadFile(db, request.params.id);
    authorize(request, 'update', 'File', file.program_id);
    const uploadId = uploading(file);
    const count = partCount(Number(file.size_bytes), storage.config.partSizeBytes);
    const parts = [];
    for (const n of new Set(body.part_numbers)) {
      if (n > count)
        throw new HttpError(422, 'no_such_part', `The upload has ${count} parts.`, 'part_numbers');
      parts.push({ part_number: n, url: await storage.presignPart(file.key, uploadId, n) });
    }
    return respond(SignedPartsSchema, { parts, expires_at: expiresAt(storage) });
  });

  app.post('/v1/files/:id/complete', async (request: IdParams) => {
    const body = parse(CompleteUploadBodySchema, request.body);
    const file = await loadFile(db, request.params.id);
    authorize(request, 'update', 'File', file.program_id);
    if (file.ingest_status !== 'uploading') {
      throw new HttpError(
        409,
        'illegal_transition',
        `A file cannot move from ${file.ingest_status} to uploaded.`,
      );
    }
    const uploadId = uploading(file);
    const expected = partCount(Number(file.size_bytes), storage.config.partSizeBytes);
    const numbers = new Set(body.parts.map((p) => p.part_number));
    const missing = [];
    for (let n = 1; n <= expected; n++) if (!numbers.has(n)) missing.push(n);
    if (missing.length || numbers.size !== body.parts.length) {
      throw new HttpError(
        422,
        'parts_missing',
        missing.length
          ? `Parts not uploaded yet: ${missing.slice(0, 10).join(', ')}.`
          : 'Each part once, please.',
        'parts',
      );
    }
    try {
      await storage.completeUpload(file.key, uploadId, body.parts);
    } catch (error) {
      throw new HttpError(
        422,
        'complete_failed',
        `Object storage refused the upload: ${(error as Error).message}`,
      );
    }
    const stored = await storage.size(file.key);
    await transitionFile(db, requestActor(request), file.id, 'uploaded', {
      set: { upload_id: null },
      details: { size_bytes: stored },
    });
    await queue.enqueue(file.id);
    return respond(FileSummarySchema, await reload(file.id));
  });

  app.post('/v1/files/:id/abort', async (request: IdParams) => {
    const file = await loadFile(db, request.params.id);
    authorize(request, 'update', 'File', file.program_id);
    const uploadId = uploading(file);
    await storage.abortUpload(file.key, uploadId).catch(() => undefined);
    await transitionFile(db, requestActor(request), file.id, 'rejected', { set: { upload_id: null } });
    return respond(FileSummarySchema, await reload(file.id));
  });

  app.post('/v1/files/link', async (request, reply) => {
    const body = parse(LinkPrefixBodySchema, request.body);
    const version = await loadVersion(db, body.experiment_version_id);
    authorize(request, 'create', 'File', version.program_id);
    requireDraft(version);
    if (!storage.config.linkablePrefixes.some((allowed) => body.prefix.startsWith(allowed))) {
      throw new HttpError(
        422,
        'prefix_not_linkable',
        `Only objects under ${storage.config.linkablePrefixes.join(', ')} can be linked.`,
        'prefix',
      );
    }
    const objects = await storage.list(body.prefix);
    if (!objects.length) throw new HttpError(422, 'prefix_empty', 'No objects under this prefix.', 'prefix');
    const known = new Set(
      (
        await db
          .selectFrom('file_object as f')
          .select('f.key')
          .where('f.bucket', '=', storage.bucket)
          .where(
            'f.key',
            'in',
            objects.map((o) => o.key),
          )
          .where('f.deleted_at', 'is', null)
          .where('f.ingest_status', '!=', 'rejected')
          .execute()
      ).map((r) => r.key),
    );
    const fresh = objects.filter((o) => !known.has(o.key));
    const actor = requestActor(request);
    const ids = await db.transaction().execute(async (trx) => {
      const created: string[] = [];
      for (const object of fresh) {
        const row = await trx
          .insertInto('file_object')
          .values({
            tenant_id: actor.tenantId,
            created_by: actor.userId,
            experiment_version_id: version.id,
            name: object.key.split('/').at(-1)!,
            role: body.role,
            bucket: storage.bucket,
            key: object.key,
            size_bytes: object.size,
            ingest_status: 'registered',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transitionFile(trx, actor, row.id, 'uploaded', {
          details: { linked: true, size_bytes: object.size },
        });
        created.push(row.id);
      }
      return created;
    });
    for (const id of ids) await queue.enqueue(id);
    const items = ids.length
      ? (
          await db
            .selectFrom('file_object as f')
            .select(FILE_COLUMNS)
            .where('f.id', 'in', ids)
            .orderBy('f.key')
            .execute()
        ).map(fileSummary)
      : [];
    reply.code(201);
    return respond(LinkPrefixResultSchema, { items, skipped: objects.length - fresh.length });
  });

  app.get('/v1/versions/:id/files', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'read', 'File', version.program_id);
    return respond(FileListSchema, { items: await versionFiles(db, version.id) });
  });
}
