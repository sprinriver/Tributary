import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { QueryConfig } from './config.ts';

/** Object storage for the query service: download sources, upload release Parquet, cache immutable releases. */
export class Objects {
  readonly client: S3Client;
  readonly #dir: string;

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
    const partial = `${target}.partial`;
    await pipeline(res.Body as Readable, createWriteStream(partial));
    renameSync(partial, target);
  }

  /** Uploads a local file; returns its sha256 and size. Release keys are written once (immutable). */
  async upload(bucket: string, key: string, file: string): Promise<{ sha256: string; size_bytes: number }> {
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
        ContentType: 'application/vnd.apache.parquet',
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
    if (!existsSync(target)) await this.download(bucket, key, target);
    return target;
  }
}
