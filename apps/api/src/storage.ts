import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3Config } from './config.ts';

export interface StoredPart {
  part_number: number;
  etag: string;
  size_bytes: number;
}

/** The object-storage operations the API needs. Large files never pass through the API (CLAUDE.md). */
export class Storage {
  readonly client: S3Client;
  readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      ...(config.credentials ? { credentials: config.credentials } : {}),
      // Presigned part URLs must not carry SDK checksum parameters the browser cannot compute.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  get bucket(): string {
    return this.config.rawBucket;
  }

  /** Local development: create the buckets and allow browser uploads from the SPA origin (S3 CORS). */
  async ensureBucket(corsOrigins: string[]): Promise<void> {
    for (const bucket of [this.bucket, this.config.warehouseBucket, this.config.workBucket]) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    }
    await this.client.send(
      new PutBucketCorsCommand({
        Bucket: this.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: corsOrigins,
              AllowedMethods: ['PUT', 'GET', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      }),
    );
  }

  async createUpload(key: string): Promise<string> {
    const res = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key }));
    if (!res.UploadId) throw new Error('Object storage returned no upload id');
    return res.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: this.config.presignTtlSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;
    do {
      const res = await this.client.send(
        new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
      );
      for (const p of res.Parts ?? []) {
        parts.push({ part_number: p.PartNumber!, etag: p.ETag!, size_bytes: p.Size ?? 0 });
      }
      marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeUpload(key: string, uploadId: string, parts: { part_number: number; etag: string }[]) {
    const res = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.part_number - b.part_number)
            .map((p) => ({ PartNumber: p.part_number, ETag: p.etag })),
        },
      }),
    );
    return { versionId: res.VersionId ?? null };
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
    );
  }

  async size(key: string, bucket = this.bucket): Promise<number> {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? 0;
  }

  async read(key: string, bucket = this.bucket): Promise<AsyncIterable<Uint8Array>> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return res.Body as AsyncIterable<Uint8Array>;
  }

  /** Uploads a local file (pipeline outputs of the local runner). */
  async putFile(
    bucket: string,
    key: string,
    body: Uint8Array | ReadableStream | import('node:stream').Readable,
    length: number,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: length }),
    );
  }

  async list(
    prefix: string,
    bucket = this.bucket,
  ): Promise<{ key: string; size: number; versionId: string | null }[]> {
    const objects: { key: string; size: number; versionId: string | null }[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) {
        if (o.Key && !o.Key.endsWith('/')) objects.push({ key: o.Key, size: o.Size ?? 0, versionId: null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return objects;
  }

  async tag(key: string, tags: Record<string, string>, bucket = this.bucket): Promise<void> {
    await this.client.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) },
      }),
    );
  }
}
