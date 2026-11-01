import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { QueryConfig } from './config.ts';

/** Object storage for the query service: download sources, upload release Parquet, cache immutable releases. */
export class Objects {
  readonly client: S3Client;
  readonly #dir: string;
  /** Downloads in flight, by cache path: concurrent readers of one release share one download. */
  readonly #pending = new Map<string, Promise<string>>();

  constructor(config: QueryConfig, workDir: string) {
    this.client = new S3Client({
      region: config.s3.region,
      ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
      ...(config.s3.credentials ? { credentials: config.s3.credentials } : {}),
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.#dir = workDir;
  }

  path(...parts: string[]): string {
    const path = join(this.#dir, ...parts);
    mkdirSync(dirname(path), { recursive: true });
    return path;
  }

  async download(bucket: string, key: string, target: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    // A unique temporary name, so an interrupted or parallel download never renames another's file.
    const partial = `${target}.${randomUUID()}.partial`;
    await pipeline(res.Body as Readable, createWriteStream(partial));
    renameSync(partial, target);
  }

  /** Uploads a local file; returns its sha256 and size. Release keys are written once (immutable). */
  async upload(
    bucket: string,
    key: string,
    file: string,
    contentType = 'application/vnd.apache.parquet',
  ): Promise<{ sha256: string; size_bytes: number }> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    const sha256 = hash.digest('hex');
    const size = statSync(file).size;
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(file),
        ContentLength: size,
        ContentType: contentType,
        Metadata: { sha256 },
      }),
    );
    return { sha256, size_bytes: size };
  }

  /**
   * Local copy of a release object. Releases never change (published rows are immutable and keys are written once),
   * so a cached file keyed by its sha256 stays valid.
   */
  async cached(bucket: string, key: string, sha256: string): Promise<string> {
    const target = this.path('cache', `${sha256}.parquet`);
    if (existsSync(target)) return target;
    let pending = this.#pending.get(target);
    if (!pending) {
      pending = this.download(bucket, key, target)
        .then(() => target)
        .finally(() => this.#pending.delete(target));
      this.#pending.set(target, pending);
    }
    return pending;
  }
}
